#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_DIR = path.resolve(SCRIPT_DIR, "../..");

const BUILTIN_VARIANTS = {
  production: {
    id: "production",
    referenceOrder: ["body", "portrait", "head"],
    promptStyle: "production",
  },
  "portrait-head-first": {
    id: "portrait-head-first",
    referenceOrder: ["portrait", "head", "body"],
    promptStyle: "concise",
    extraInstruction: "Resolve every facial detail from the portrait and head turnaround before considering body or clothing.",
  },
  "portrait-only": {
    id: "portrait-only",
    referenceOrder: ["portrait"],
    promptStyle: "concise",
    extraInstruction: "Do not redesign, beautify, round, soften, or genericize this face.",
  },
};

function usage() {
  console.log(`Identity persistence harness

Usage:
  pnpm --filter @kitabee/studio identity:harness -- --manifest FILE [options]

Options:
  --run                 Generate new candidates with Gemini (default is review/check only)
  --confirm-spend       Required together with --run
  --case ID             Run/review only one case
  --variant ID          Generate only one variant
  --candidates N        Override candidates per variant
  --help                Show this help
`);
}

function parseArgs(argv) {
  const out = { run: false, confirmSpend: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--run") out.run = true;
    else if (arg === "--confirm-spend") out.confirmSpend = true;
    else if (arg === "--manifest") out.manifest = argv[++i];
    else if (arg === "--case") out.caseId = argv[++i];
    else if (arg === "--variant") out.variantId = argv[++i];
    else if (arg === "--candidates") out.candidates = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function resolveFrom(base, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(base, value);
}

function assertFile(label, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} does not exist: ${file ?? "(missing)"}`);
}

function normalizeBox(label, box) {
  if (box == null) return null;
  if (!Array.isArray(box) || box.length !== 4 || box.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) {
    throw new Error(`${label} must be [ymin,xmin,ymax,xmax], each from 0 to 1000`);
  }
  if (box[0] >= box[2] || box[1] >= box[3]) throw new Error(`${label} has inverted or empty bounds`);
  return box;
}

function loadManifest(file) {
  const manifestFile = path.resolve(file);
  const base = path.dirname(manifestFile);
  const raw = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (!raw.character || !Array.isArray(raw.cases) || raw.cases.length === 0) throw new Error("Manifest requires character and at least one case");
  const character = {
    ...raw.character,
    portrait: resolveFrom(base, raw.character.portrait),
    headSheet: resolveFrom(base, raw.character.headSheet),
    bodySheet: resolveFrom(base, raw.character.bodySheet),
  };
  assertFile("character.portrait", character.portrait);
  if (character.headSheet) assertFile("character.headSheet", character.headSheet);
  if (character.bodySheet) assertFile("character.bodySheet", character.bodySheet);
  if (!['boy', 'girl'].includes(character.gender)) throw new Error('character.gender must be "boy" or "girl"');
  const cases = raw.cases.map((item, index) => {
    if (!item.id) throw new Error(`cases[${index}] requires id`);
    const template = resolveFrom(base, item.template);
    assertFile(`case ${item.id} template`, template);
    const existingCandidates = (item.existingCandidates ?? []).map((candidate, candidateIndex) => {
      const candidatePath = resolveFrom(base, candidate.path);
      assertFile(`case ${item.id} existingCandidates[${candidateIndex}]`, candidatePath);
      return { label: candidate.label ?? `existing-${candidateIndex + 1}`, path: candidatePath };
    });
    return {
      ...item,
      template,
      heroHeadBox: normalizeBox(`case ${item.id} heroHeadBox`, item.heroHeadBox),
      heroBodyBox: normalizeBox(`case ${item.id} heroBodyBox`, item.heroBodyBox),
      existingCandidates,
    };
  });
  const variants = (raw.variants ?? ["production"]).map((item) => {
    const variant = typeof item === "string" ? BUILTIN_VARIANTS[item] : item;
    if (!variant?.id || !Array.isArray(variant.referenceOrder)) throw new Error(`Unknown or invalid variant: ${JSON.stringify(item)}`);
    for (const ref of variant.referenceOrder) {
      if (!["portrait", "head", "body"].includes(ref)) throw new Error(`Variant ${variant.id} has unknown reference: ${ref}`);
      if (ref === "head" && !character.headSheet) throw new Error(`Variant ${variant.id} requires character.headSheet`);
      if (ref === "body" && !character.bodySheet) throw new Error(`Variant ${variant.id} requires character.bodySheet`);
    }
    return { promptStyle: "concise", ...variant };
  });
  return {
    ...raw,
    manifestFile,
    base,
    character,
    cases,
    variants,
    outputDir: resolveFrom(base, raw.outputDir ?? "./identity-runs"),
    model: raw.model ?? "gemini-3.1-flash-image",
    imageSize: raw.imageSize ?? "4K",
    candidatesPerVariant: raw.candidatesPerVariant ?? 1,
    estimatedCostPerImageUsd: raw.estimatedCostPerImageUsd ?? 0.15,
  };
}

function inlineFile(file) {
  const ext = path.extname(file).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return { inlineData: { data: fs.readFileSync(file).toString("base64"), mimeType } };
}

function referenceParts(character, order) {
  const refs = {
    portrait: [
      inlineFile(character.portrait),
      { text: `APPROVED IDENTITY PORTRAIT above. This is the primary authority for the child's face: preserve its exact face shape, feature proportions, skin tone, hairline, hair color, and recognizable identity.${character.bodySheetHasCostume ? " ZERO WARDROBE AUTHORITY: ignore every garment, colour, pattern, and accessory visible here; never copy or blend them into the scene." : ""}` },
    ],
    head: character.headSheet ? [
      inlineFile(character.headSheet),
      { text: `HEAD TURNAROUND above. Use only the view closest to the scene head angle. It supplies angle-specific geometry; it must not override the approved portrait's identity.${character.bodySheetHasCostume ? " ZERO WARDROBE AUTHORITY: ignore clothing fragments at the neck and shoulders." : ""}` },
    ] : [],
    body: character.bodySheet ? [
      inlineFile(character.bodySheet),
      { text: `BODY${character.bodySheetHasCostume ? " AND OUTFIT" : ""} SHEET above. Use it for body proportions${character.bodySheetHasCostume ? ". WARDROBE LOCK: this sheet is the SOLE authority for garment types, dominant colours, patterns/graphics, bottoms, shoes, and accessories" : ""}. Do not copy its small faces; they are not identity authority.` },
    ] : [],
  };
  return order.flatMap((key) => refs[key]);
}

function taskPrompt(manifest, testCase, variant) {
  const costume = manifest.character.bodySheetHasCostume
    ? "WARDROBE LOCK: reproduce the complete outfit from the body sheet exactly. Never use, blend with, or borrow clothing from the portrait or head turnaround. Before finalizing, compare garment types, dominant colours, patterns/graphics, bottoms, shoes, and accessories item by item."
    : `Add simple scene-appropriate clothing for a ${manifest.character.gender}.`;
  const context = testCase.sceneContext ? `\nExpression/moment: ${testCase.sceneContext}` : "";
  const extra = variant.extraInstruction ? `\nExperimental instruction: ${variant.extraInstruction}` : "";
  if (variant.promptStyle === "production") {
    return `SCENE IMAGE above: it contains one blank, featureless, pure-white silhouette placeholder. Replace ONLY that silhouette with the exact child from the approved portrait and references. This is a strict likeness match, not a child who merely looks similar. Keep the silhouette's pose, position, scale, and head angle. Preserve every other character, the background, lighting, composition, and all pixels outside the silhouette. The filled character must match the scene's cinematic 3D rendering and lighting without changing the child's stable facial geometry. ${costume}${context}${extra}\nBefore finalizing, compare the face back to the approved portrait: face width, jaw and chin, cheek fullness, eye size and spacing, nose, mouth, skin tone, hairline, part, length, and color.`;
  }
  return `Replace only the blank white child silhouette in the scene with the same specific child shown in the approved portrait. Preserve the portrait's recognizable facial geometry exactly while rendering it in the scene's existing cinematic 3D style and lighting. Keep the pose, position, scale, and head angle. Preserve everything outside the silhouette. ${costume}${context}${extra}`;
}

function extractImage(response) {
  const candidate = response.candidates?.[0];
  const part = candidate?.content?.parts?.find((value) => value.inlineData?.data);
  if (part) return { buffer: Buffer.from(part.inlineData.data, "base64"), mimeType: part.inlineData.mimeType ?? "image/png" };
  const reason = candidate?.finishReason ?? response.promptFeedback?.blockReason ?? "UNKNOWN";
  const error = new Error(`Gemini returned no image (${reason})`);
  error.finishReason = reason;
  throw error;
}

async function generateCandidate(client, manifest, testCase, variant) {
  const model = client.getGenerativeModel({
    model: manifest.model,
    systemInstruction: "You are a forensic character-identity compositor. Exact identity reproduction and scene preservation are the task. Do not redesign or genericize the child's face. The child must look native to the scene's existing 3D render style.",
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
      imageConfig: { imageSize: manifest.imageSize },
    },
  });
  const parts = [
    ...referenceParts(manifest.character, variant.referenceOrder),
    inlineFile(testCase.template),
    { text: taskPrompt(manifest, testCase, variant) },
  ];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { response } = await model.generateContent(parts);
      return extractImage(response);
    } catch (error) {
      if (error.finishReason !== "IMAGE_SAFETY" || attempt === 3) throw error;
      console.warn(`  IMAGE_SAFETY block; retrying (${attempt}/3)`);
    }
  }
  throw new Error("Generation failed");
}

function boxToPixels(box, width, height, padding = 0) {
  const [y0, x0, y1, x1] = box;
  const left0 = x0 / 1000 * width;
  const top0 = y0 / 1000 * height;
  const right0 = x1 / 1000 * width;
  const bottom0 = y1 / 1000 * height;
  const padX = (right0 - left0) * padding;
  const padY = (bottom0 - top0) * padding;
  const left = Math.max(0, Math.floor(left0 - padX));
  const top = Math.max(0, Math.floor(top0 - padY));
  const right = Math.min(width, Math.ceil(right0 + padX));
  const bottom = Math.min(height, Math.ceil(bottom0 + padY));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

async function faceCrop(file, box, destination) {
  const metadata = await sharp(file).metadata();
  const crop = boxToPixels(box, metadata.width, metadata.height, 0.35);
  await sharp(file).extract(crop).resize(700, 700, { fit: "contain", background: "#efefef" }).jpeg({ quality: 92 }).toFile(destination);
}

async function outsideHeroMae(templateFile, candidateFile, box) {
  if (!box) return null;
  const width = 600;
  const templateMeta = await sharp(templateFile).metadata();
  const height = Math.max(1, Math.round(width * templateMeta.height / templateMeta.width));
  const [before, after] = await Promise.all([
    sharp(templateFile).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer(),
    sharp(candidateFile).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer(),
  ]);
  const excluded = boxToPixels(box, width, height, 0.12);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= excluded.left && x < excluded.left + excluded.width && y >= excluded.top && y < excluded.top + excluded.height) continue;
      const offset = (y * width + x) * 3;
      sum += Math.abs(before[offset] - after[offset]) + Math.abs(before[offset + 1] - after[offset + 1]) + Math.abs(before[offset + 2] - after[offset + 2]);
      count += 3;
    }
  }
  return Number((sum / count / 255 * 100).toFixed(2));
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function labeledTile(file, label, width, height) {
  const imageHeight = height - 54;
  const image = await sharp(file).resize(width, imageHeight, { fit: "contain", background: "#eeeeee" }).jpeg({ quality: 90 }).toBuffer();
  const svg = Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111"/><text x="18" y="37" font-family="Arial,sans-serif" font-size="24" fill="white">${escapeXml(label)}</text></svg>`);
  return sharp(svg).composite([{ input: image, top: 54, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

async function buildContactSheet(portrait, records, caseDir, testCase) {
  if (!testCase.heroHeadBox || records.length === 0) return null;
  const tileW = 520;
  const tileH = 574;
  const portraitTile = await labeledTile(portrait, "APPROVED PORTRAIT", tileW, tileH);
  const candidateTiles = await Promise.all(records.map((record) => labeledTile(record.faceCrop, `${record.blindLabel}  drift:${record.outsideHeroMaePercent ?? "n/a"}%`, tileW, tileH)));
  const tiles = [portraitTile, ...candidateTiles];
  const columns = Math.min(4, tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const blank = { input: { create: { width: columns * tileW, height: rows * tileH, channels: 3, background: "#222" } } };
  const composites = tiles.map((input, index) => ({ input, left: (index % columns) * tileW, top: Math.floor(index / columns) * tileH }));
  const destination = path.join(caseDir, "face-contact.jpg");
  await sharp(blank.input).composite(composites).jpeg({ quality: 92 }).toFile(destination);
  return destination;
}

function reviewHtml(runName, cases) {
  const sections = cases.map((entry) => {
    const cards = entry.records.map((record) => `
      <article data-case="${escapeXml(entry.id)}" data-candidate="${escapeXml(record.blindLabel)}">
        <h3>${escapeXml(record.blindLabel)}</h3>
        <img src="${escapeXml(record.relativeScene)}" alt="candidate scene">
        ${record.relativeFace ? `<img class="face" src="${escapeXml(record.relativeFace)}" alt="candidate face crop">` : ""}
        <label>Likeness <select><option value="">—</option>${[1,2,3,4,5].map((n) => `<option>${n}</option>`).join("")}</select></label>
        <textarea placeholder="What changed: face shape, eyes, nose/mouth, skin, hair..."></textarea>
      </article>`).join("");
    return `<section><h2>${escapeXml(entry.id)}</h2><div class="reference"><img src="${escapeXml(entry.relativePortrait)}"><strong>Approved portrait</strong></div><div class="grid">${cards}</div></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(runName)}</title><style>
body{font:16px system-ui;margin:24px;background:#f5f5f3;color:#171717}section{margin:36px 0;padding-top:12px;border-top:2px solid #bbb}.reference img,.face{width:260px;height:260px;object-fit:contain;background:#ddd}.reference{display:flex;gap:16px;align-items:center;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px}article{background:white;padding:14px;border-radius:10px;box-shadow:0 1px 5px #bbb}article>img:not(.face){width:100%;height:280px;object-fit:contain;background:#ddd}.face{display:block;margin:12px auto}label{display:block;font-weight:700}select{font-size:18px;margin-left:8px}textarea{box-sizing:border-box;width:100%;height:72px;margin-top:10px}button{position:fixed;right:24px;top:20px;padding:12px 18px;font-weight:700}
</style></head><body><h1>${escapeXml(runName)}</h1><p>Rate identity only. Compare stable facial geometry before style, expression, or pose. 5 = immediately the same exact child; 1 = a different child.</p><button onclick="save()">Export ratings</button>${sections}<script>
function save(){const ratings=[...document.querySelectorAll('article')].map(el=>({caseId:el.dataset.case,candidate:el.dataset.candidate,likeness:Number(el.querySelector('select').value)||null,notes:el.querySelector('textarea').value}));const blob=new Blob([JSON.stringify({createdAt:new Date().toISOString(),ratings},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ratings.json';a.click();URL.revokeObjectURL(a.href)}
</script></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!args.manifest) throw new Error("--manifest is required (see --help)");
  if (args.run && !args.confirmSpend) throw new Error("Paid generation requires --confirm-spend");
  if (args.candidates != null && (!Number.isInteger(args.candidates) || args.candidates < 1)) throw new Error("--candidates must be a positive integer");

  const manifest = loadManifest(args.manifest);
  const cases = manifest.cases.filter((item) => !args.caseId || item.id === args.caseId);
  const variants = manifest.variants.filter((item) => !args.variantId || item.id === args.variantId);
  if (cases.length === 0) throw new Error(`No case matched: ${args.caseId}`);
  if (variants.length === 0) throw new Error(`No variant matched: ${args.variantId}`);
  const candidateCount = args.candidates ?? manifest.candidatesPerVariant;
  const generationCount = args.run ? cases.length * variants.length * candidateCount : 0;
  const estimate = generationCount * manifest.estimatedCostPerImageUsd;
  console.log(`Manifest: ${manifest.manifestFile}`);
  console.log(`Cases: ${cases.map((item) => item.id).join(", ")}`);
  console.log(`Variants: ${variants.map((item) => item.id).join(", ")}`);
  console.log(`New image calls: ${generationCount}; estimated maximum: $${estimate.toFixed(2)}`);
  if (!args.run) console.log("Review/check mode: Gemini will not be called.");

  let client = null;
  if (args.run) {
    const env = { ...readEnvFile(path.join(STUDIO_DIR, ".env.local")), ...process.env };
    if (!env.GOOGLE_GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY is not set and was not found in apps/studio/.env.local");
    client = new GoogleGenerativeAI(env.GOOGLE_GEMINI_API_KEY);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(manifest.outputDir, `${stamp}-${safeId(manifest.name ?? "identity")}`);
  fs.mkdirSync(runDir, { recursive: true });
  const reviewCases = [];
  const mapping = {};

  for (const testCase of cases) {
    console.log(`\n[${testCase.id}]`);
    const caseDir = path.join(runDir, safeId(testCase.id));
    const facesDir = path.join(caseDir, "faces");
    const scenesDir = path.join(caseDir, "scenes");
    fs.mkdirSync(facesDir, { recursive: true });
    fs.mkdirSync(scenesDir, { recursive: true });
    const records = [];

    for (const existing of testCase.existingCandidates) {
      records.push({ source: "existing", variant: existing.label, sample: 1, scene: existing.path });
    }
    if (args.run) {
      for (const variant of variants) {
        for (let sample = 1; sample <= candidateCount; sample++) {
          console.log(`  generating ${variant.id} sample ${sample}/${candidateCount}`);
          const generated = await generateCandidate(client, manifest, testCase, variant);
          const extension = generated.mimeType === "image/jpeg" ? ".jpg" : generated.mimeType === "image/webp" ? ".webp" : ".png";
          const scene = path.join(scenesDir, `${safeId(variant.id)}-${sample}${extension}`);
          fs.writeFileSync(scene, generated.buffer);
          records.push({ source: "generated", variant: variant.id, sample, scene });
        }
      }
    }

    const shuffled = records.map((record) => ({ record, key: crypto.randomBytes(8).toString("hex") })).sort((a, b) => a.key.localeCompare(b.key));
    for (let index = 0; index < shuffled.length; index++) {
      const record = shuffled[index].record;
      record.blindLabel = String.fromCharCode(65 + index);
      const copiedScene = path.join(scenesDir, `${record.blindLabel}${path.extname(record.scene) || ".png"}`);
      if (path.resolve(record.scene) !== path.resolve(copiedScene)) fs.copyFileSync(record.scene, copiedScene);
      record.scene = copiedScene;
      record.outsideHeroMaePercent = await outsideHeroMae(testCase.template, record.scene, testCase.heroBodyBox);
      if (testCase.heroHeadBox) {
        record.faceCrop = path.join(facesDir, `${record.blindLabel}.jpg`);
        await faceCrop(record.scene, testCase.heroHeadBox, record.faceCrop);
      }
      mapping[`${testCase.id}:${record.blindLabel}`] = { variant: record.variant, sample: record.sample, source: record.source };
    }

    await buildContactSheet(manifest.character.portrait, records, caseDir, testCase);
    reviewCases.push({
      id: testCase.id,
      records: records.map((record) => ({
        ...record,
        relativeScene: path.relative(runDir, record.scene),
        relativeFace: record.faceCrop ? path.relative(runDir, record.faceCrop) : null,
      })),
      relativePortrait: path.relative(runDir, path.join(caseDir, "portrait.png")),
    });
    await sharp(manifest.character.portrait).png().toFile(path.join(caseDir, "portrait.png"));
  }

  const publicReport = {
    name: manifest.name ?? "identity test",
    createdAt: new Date().toISOString(),
    model: args.run ? manifest.model : null,
    imageSize: args.run ? manifest.imageSize : null,
    generationCount,
    estimatedCostUsd: estimate,
    cases: reviewCases.map((entry) => ({ id: entry.id, candidates: entry.records.map((record) => ({ blindLabel: record.blindLabel, outsideHeroMaePercent: record.outsideHeroMaePercent })) })),
  };
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(publicReport, null, 2));
  fs.writeFileSync(path.join(runDir, "blind-map.json"), JSON.stringify(mapping, null, 2));
  fs.writeFileSync(path.join(runDir, "review.html"), reviewHtml(publicReport.name, reviewCases));
  console.log(`\nRun written to ${runDir}`);
  console.log(`Review: ${path.join(runDir, "review.html")}`);
  console.log(`Blind mapping: ${path.join(runDir, "blind-map.json")}`);
}

main().catch((error) => {
  console.error(`identity harness: ${error.message}`);
  process.exitCode = 1;
});
