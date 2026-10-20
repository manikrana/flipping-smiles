#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fal } from "@fal-ai/client";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_DIR = path.resolve(SCRIPT_DIR, "../..");
const ENDPOINT = "openai/gpt-image-2.5/sunburst/edit";

function parseArgs(argv) {
  const out = { quality: "medium", confirmSpend: false, prepareOnly: false, fullScene: false, wardrobeLock: false, headOnlyPortrait: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--manifest") out.manifest = argv[++i];
    else if (arg === "--case") out.caseId = argv[++i];
    else if (arg === "--quality") out.quality = argv[++i];
    else if (arg === "--confirm-spend") out.confirmSpend = true;
    else if (arg === "--prepare-only") out.prepareOnly = true;
    else if (arg === "--full-scene") out.fullScene = true;
    else if (arg === "--wardrobe-lock") out.wardrobeLock = true;
    else if (arg === "--head-only-portrait") out.headOnlyPortrait = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  console.log(`Sunburst identity crop experiment

Usage:
  pnpm --filter @kitabee/studio identity:sunburst -- \\
    --manifest FILE --case ID --quality medium --confirm-spend

Add --full-scene to edit the complete spread at 3840x1920 and then resize the
result deterministically to the template's original dimensions.

Add --wardrobe-lock to make the body/outfit sheet the sole clothing authority.
Add --head-only-portrait with it to remove visible portrait clothing before
the reference is sent to the model.

quality: low, medium, high, xhigh, or max
`);
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

function resolveFrom(base, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(base, value);
}

function assertFile(label, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} does not exist: ${file ?? "(missing)"}`);
}

function dataUrl(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function bufferDataUrl(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function normalizeBox(label, box) {
  if (!Array.isArray(box) || box.length !== 4 || box.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) {
    throw new Error(`${label} must be [ymin,xmin,ymax,xmax] from 0 to 1000`);
  }
  if (box[0] >= box[2] || box[1] >= box[3]) throw new Error(`${label} has inverted bounds`);
  return box;
}

function loadCase(manifestFile, caseId) {
  const absolute = path.resolve(manifestFile);
  const base = path.dirname(absolute);
  const manifest = JSON.parse(fs.readFileSync(absolute, "utf8"));
  const item = manifest.cases?.find((candidate) => candidate.id === caseId);
  if (!item) throw new Error(`No case matched: ${caseId}`);
  const character = {
    ...manifest.character,
    portrait: resolveFrom(base, manifest.character?.portrait),
    headSheet: resolveFrom(base, manifest.character?.headSheet),
    bodySheet: resolveFrom(base, manifest.character?.bodySheet),
  };
  assertFile("character.portrait", character.portrait);
  if (character.headSheet) assertFile("character.headSheet", character.headSheet);
  if (character.bodySheet) assertFile("character.bodySheet", character.bodySheet);
  const template = resolveFrom(base, item.template);
  assertFile(`case ${caseId} template`, template);
  return {
    manifest,
    character,
    testCase: {
      ...item,
      template,
      heroBodyBox: normalizeBox(`case ${caseId} heroBodyBox`, item.heroBodyBox),
      heroHeadBox: item.heroHeadBox ? normalizeBox(`case ${caseId} heroHeadBox`, item.heroHeadBox) : null,
    },
    outputDir: resolveFrom(base, manifest.outputDir ?? "./identity-runs"),
  };
}

function normalizedBoxToPixels(box, width, height) {
  return {
    left: Math.floor(box[1] / 1000 * width),
    top: Math.floor(box[0] / 1000 * height),
    right: Math.ceil(box[3] / 1000 * width),
    bottom: Math.ceil(box[2] / 1000 * height),
  };
}

function paddedCrop(box, width, height) {
  const raw = normalizedBoxToPixels(box, width, height);
  const padX = Math.round((raw.right - raw.left) * 0.35);
  const padY = Math.round((raw.bottom - raw.top) * 0.18);
  let left = Math.max(0, raw.left - padX);
  let top = Math.max(0, raw.top - padY);
  let right = Math.min(width, raw.right + padX);
  let bottom = Math.min(height, raw.bottom + padY);
  left = Math.floor(left / 16) * 16;
  top = Math.floor(top / 16) * 16;
  right = Math.min(width, Math.ceil(right / 16) * 16);
  bottom = Math.min(height, Math.ceil(bottom / 16) * 16);
  right -= (right - left) % 16;
  bottom -= (bottom - top) % 16;
  return { left, top, width: right - left, height: bottom - top };
}

async function connectedSilhouetteMask(template, bodyBox, luminanceMin = 70, channelSpread = 45, componentMode = "union", headEllipseBox = null) {
  const meta = await sharp(template).metadata();
  const width = meta.width;
  const height = meta.height;
  const scale = 4;
  const workWidth = Math.round(width / scale);
  const workHeight = Math.round(height / scale);
  const raw = await sharp(template).resize(workWidth, workHeight).removeAlpha().raw().toBuffer();
  const bounds = normalizedBoxToPixels(bodyBox, workWidth, workHeight);
  const padX = Math.round((bounds.right - bounds.left) * 0.15);
  const padY = Math.round((bounds.bottom - bounds.top) * 0.08);
  const x0 = Math.max(0, bounds.left - padX);
  const x1 = Math.min(workWidth - 1, bounds.right + padX);
  const y0 = Math.max(0, bounds.top - padY);
  const y1 = Math.min(workHeight - 1, bounds.bottom + padY);
  const candidate = new Uint8Array(workWidth * workHeight);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const offset = (y * workWidth + x) * 3;
      const r = raw[offset];
      const g = raw[offset + 1];
      const b = raw[offset + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // The mannequin is neutral white/gray under scene lighting. Its warm
      // shadows have a wider channel spread than the highlights, so use a
      // deliberately permissive threshold inside the already-known hero box.
      if (min >= luminanceMin && max - min <= channelSpread) candidate[y * workWidth + x] = 1;
    }
  }
  // The brochure and other foreground props can visually disconnect the
  // mannequin into several components (head/torso, hands, legs). Keep the
  // union of every near-white segment inside the already-known hero box,
  // then close small shading gaps. Selecting a single connected component
  // loses valid body regions in exactly these occluded poses.
  let selected = candidate;
  if (componentMode === "largest") {
    const seen = new Uint8Array(candidate.length);
    let best = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const start = y * workWidth + x;
        if (!candidate[start] || seen[start]) continue;
        const component = [];
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
          const current = stack.pop();
          component.push(current);
          const cx = current % workWidth;
          const cy = (current - cx) / workWidth;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
            const next = ny * workWidth + nx;
            if (candidate[next] && !seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
          }
        }
        if (component.length > best.length) best = component;
      }
    }
    if (!best.length) throw new Error("Could not isolate the white silhouette");
    selected = new Uint8Array(candidate.length);
    for (const index of best) selected[index] = 1;
  }
  if (headEllipseBox) {
    const head = normalizedBoxToPixels(headEllipseBox, workWidth, workHeight);
    const cx = (head.left + head.right) / 2;
    const cy = (head.top + head.bottom) / 2;
    const rx = (head.right - head.left) / 2;
    const ry = (head.bottom - head.top) / 2;
    const bodyCutoff = head.bottom;
    const clipped = new Uint8Array(selected.length);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const index = y * workWidth + x;
        const inHeadEllipse = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
        // Above the shoulders, use a solid geometric head matte. This avoids
        // a white window or picture frame merging into the white mannequin.
        if (y < bodyCutoff) {
          if (inHeadEllipse) clipped[index] = 1;
        } else if (selected[index]) clipped[index] = 1;
      }
    }
    selected = clipped;
  }
  const union = Buffer.from(selected.map((value) => value ? 255 : 0));
  return sharp(union, { raw: { width: workWidth, height: workHeight, channels: 1 } })
    .resize(width, height, { kernel: "nearest" })
    // In Sharp, erode expands white regions (it erodes the black background).
    // Four pixels cover the antialiased mannequin rim without swallowing props.
    .erode(4)
    .blur(4)
    .threshold(12)
    .png()
    .toBuffer();
}

async function compositePatch(template, generated, subjectMask, crop, destination) {
  const resized = await sharp(generated).resize(crop.width, crop.height, { fit: "fill" }).removeAlpha().png().toBuffer();
  const alpha = await sharp(subjectMask).extract(crop).extractChannel(0).blur(2).raw().toBuffer();
  const patch = await sharp(resized).joinChannel(alpha, { raw: { width: crop.width, height: crop.height, channels: 1 } }).png().toBuffer();
  await sharp(template).composite([{ input: patch, left: crop.left, top: crop.top }]).png().toFile(destination);
}

async function outsideMaskDrift(template, result, subjectMask) {
  const meta = await sharp(template).metadata();
  const [before, after, mask] = await Promise.all([
    sharp(template).removeAlpha().raw().toBuffer(),
    sharp(result).removeAlpha().raw().toBuffer(),
    sharp(subjectMask).extractChannel(0).raw().toBuffer(),
  ]);
  let changed = 0;
  let pixels = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0) continue;
    pixels++;
    const offset = i * 3;
    if (before[offset] !== after[offset] || before[offset + 1] !== after[offset + 1] || before[offset + 2] !== after[offset + 2]) changed++;
  }
  return { changedPixels: changed, comparedPixels: pixels, percent: Number((changed / pixels * 100).toFixed(6)), width: meta.width, height: meta.height };
}

async function headOnlyPortrait(file) {
  const metadata = await sharp(file).metadata();
  const width = metadata.width;
  const height = metadata.height;
  // Cartoon portraits are generated as centered head-and-shoulders images on
  // white. The top 64% retains the complete face and most hair while removing
  // the shirt/dress pixels that compete with the costumed sheet.
  const cropHeight = Math.max(1, Math.round(height * 0.64));
  const head = await sharp(file).extract({ left: 0, top: 0, width, height: cropHeight }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: "white" } })
    .composite([{ input: head, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function runFullScene({ args, loaded, templateMeta }) {
  const outputWidth = 3840;
  const outputHeight = 1920;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const modeSuffix = args.wardrobeLock
    ? `sunburst-full-wardrobe${args.headOnlyPortrait ? "-head-only" : ""}`
    : "sunburst-full-scene";
  const runDir = path.join(loaded.outputDir, `${stamp}-${modeSuffix}-${loaded.testCase.id}`);
  fs.mkdirSync(runDir, { recursive: true });
  const sceneInput = await sharp(loaded.testCase.template)
    .resize(outputWidth, outputHeight, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(runDir, "01-scene-input-3840x1920.png"), sceneInput);

  let portraitInput = null;
  if (args.headOnlyPortrait) {
    portraitInput = await headOnlyPortrait(loaded.character.portrait);
    fs.writeFileSync(path.join(runDir, "00-head-only-portrait.png"), portraitInput);
  }
  const refs = args.wardrobeLock
    ? [
        bufferDataUrl(sceneInput),
        dataUrl(loaded.character.bodySheet),
        portraitInput ? bufferDataUrl(portraitInput) : dataUrl(loaded.character.portrait),
        ...(loaded.character.headSheet ? [dataUrl(loaded.character.headSheet)] : []),
      ]
    : [bufferDataUrl(sceneInput), dataUrl(loaded.character.portrait)];
  if (!args.wardrobeLock && loaded.character.headSheet) refs.push(dataUrl(loaded.character.headSheet));
  if (!args.wardrobeLock && loaded.character.bodySheet) refs.push(dataUrl(loaded.character.bodySheet));
  const poseInstruction = loaded.testCase.sceneInstruction ?? "Keep the mannequin's exact body pose, scale, position, head direction, gaze direction, hands, and interaction with any scene props.";
  const prompt = args.wardrobeLock
    ? `TASK\nEdit Image 1. Replace only the single blank white child mannequin with the exact approved child defined by Images 2–${refs.length}. This is identity-preserving character insertion, not character redesign.\n\nSCENE LOCK — HIGHEST PRIORITY\nKeep the complete 2:1 composition and canvas unchanged. Preserve every other person, object, foreground prop, background element, camera position, lighting direction, color, and empty text area. Do not crop, reframe, zoom, move, add, remove, or redesign anything outside the white mannequin. Preserve any object the mannequin touches.\n\nWARDROBE LOCK — NON-NEGOTIABLE\nImage 2 is the BODY AND OUTFIT SHEET and is the sole authority for every garment and shoe. Reproduce its exact top, collar and sleeve construction, top color and pattern, bottoms, bottom color, socks, shoes, and accessories from the view closest to the scene pose. The outfit must remain the same book costume in every scene.\n\nImages 3${loaded.character.headSheet ? " and 4" : ""} have ZERO clothing authority. Use them only above the neck for identity. Completely ignore and do not copy any shirt, dress, neckline, sleeve, graphic, color, toy, or garment visible in Image 3. Portrait clothing is forbidden even if it is larger or more visually prominent than the outfit sheet. Never mix the portrait outfit with Image 2. Before returning the image, compare the rendered clothing against Image 2 and correct every mismatch.\n\nIDENTITY LOCK — NON-NEGOTIABLE\nImage 3 is the approved face reference and the sole authority for frontal facial geometry. ${loaded.character.headSheet ? "Image 4 is the head turnaround and supplies angle-specific head and hair geometry." : ""} Treat the referenced head as the same rigid 3D character model being reposed. Preserve the exact apparent age, face length and width, forehead, cheeks, jaw, chin, eye and iris size, eye spacing, eyelids, nose bridge and tip, mouth and lip shape, ears, skin tone and markings, hairline, part, volume and length, and glasses or jewelry.\n\nThe mannequin's skull, face, clothing, and expression are placeholders. Copy only its body pose, placement, scale, head direction, gaze direction, hands, and prop interaction. Do not enlarge the eyes or irises; do not make the face rounder, younger, cuter, or more generic.\n\nPOSE AND RENDERING\n${poseInstruction} Render the approved child natively in the exact same cinematic 3D style and scene lighting as Image 1. Return the complete spread at exactly ${outputWidth}x${outputHeight}.`
    : `TASK\nEdit Image 1. Replace only the single blank white child mannequin with the exact approved child from Image 2. This is identity-preserving character insertion, not character redesign.\n\nSCENE LOCK — HIGHEST PRIORITY\nKeep the complete 2:1 composition and canvas unchanged. Preserve every other person, object, foreground prop, background element, camera position, lighting direction, color, and empty text area. Do not crop, reframe, zoom, move, add, remove, or redesign anything outside the white mannequin. Preserve any object the mannequin touches.\n\nIDENTITY LOCK — NON-NEGOTIABLE\nImage 2 is the approved identity portrait and the sole authority for the face. Treat its head as the same rigid 3D character model being reposed, not as inspiration for a new child. Preserve its exact apparent age and distinctive facial geometry: face length and width, forehead, cheeks, jaw, chin, eye and iris size, eye spacing, eyelids, nose bridge and tip, mouth and lip shape, ears, skin tone and markings, hairline, part, volume and length, and any glasses or jewelry.\n\nThe mannequin's skull, eyes, mouth, ears, and expression are placeholders. IGNORE all mannequin facial proportions. Copy only its body pose, placement, scale, head direction, gaze direction, hands, and prop interaction. Do not blend the mannequin face with Image 2.\n\nFORBIDDEN IDENTITY DRIFT\nDo not enlarge the eyes or irises. Do not make the face shorter, wider, rounder, younger, cuter, chibi, or more generic. Do not shrink or flatten the nose. Do not inflate the cheeks, exaggerate the expression, or change distinctive accessories. The final face must still match Image 2 when compared side-by-side at the scene's required angle.\n\nREFERENCE ROLES\n${loaded.character.headSheet ? "Image 3 is a head turnaround derived from the same child. Use it only to understand rotation and depth. If any facial feature differs from Image 2, Image 2 always wins.\n" : ""}${loaded.character.bodySheet ? `Image ${loaded.character.headSheet ? 4 : 3} is a body and outfit reference. Use it only for proportions and clothing; it has zero authority over the face.\n` : ""}\nPOSE AND RENDERING\n${poseInstruction} Render the approved child natively in the exact same cinematic 3D style and scene lighting as Image 1. Return the complete spread at exactly ${outputWidth}x${outputHeight}.`;

  console.log(`Calling ${ENDPOINT} full-scene: ${outputWidth}x${outputHeight}, quality=${args.quality}, references=${refs.length}`);
  const response = await fal.subscribe(ENDPOINT, {
    input: {
      prompt,
      image_urls: refs,
      image_size: { width: outputWidth, height: outputHeight },
      quality: args.quality,
      num_images: 1,
      output_format: "png",
      sync_mode: true,
    },
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_PROGRESS") for (const entry of update.logs ?? []) console.log(`  ${entry.message}`);
    },
  });
  const image = response.data?.images?.[0];
  if (!image?.url) throw new Error("Sunburst returned no image URL");
  const generatedResponse = await fetch(image.url);
  if (!generatedResponse.ok) throw new Error(`Failed to fetch Sunburst output: ${generatedResponse.status}`);
  const generated = Buffer.from(await generatedResponse.arrayBuffer());
  const providerFile = path.join(runDir, "02-provider-3840x1920.png");
  fs.writeFileSync(providerFile, generated);
  const resultFile = path.join(runDir, "03-upscaled-full.png");
  await sharp(generated)
    .resize(templateMeta.width, templateMeta.height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toFile(resultFile);
  const report = {
    endpoint: ENDPOINT,
    mode: "full-scene",
    promptVersion: args.wardrobeLock ? `identity-wardrobe-lock-v1${args.headOnlyPortrait ? "-head-only" : ""}` : "identity-lock-v2",
    quality: args.quality,
    references: refs.length,
    requestId: response.requestId ?? null,
    providerDimensions: { width: image.width ?? outputWidth, height: image.height ?? outputHeight },
    finalDimensions: { width: templateMeta.width, height: templateMeta.height },
    scaleFactor: Number((templateMeta.width / outputWidth).toFixed(6)),
    providerFile,
    resultFile,
  };
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Provider result: ${providerFile}`);
  console.log(`Upscaled result: ${resultFile}`);
  console.log(`Report: ${path.join(runDir, "report.json")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!args.manifest || !args.caseId) throw new Error("--manifest and --case are required");
  if (!args.prepareOnly && !args.confirmSpend) throw new Error("The paid Sunburst call requires --confirm-spend");
  if (!["low", "medium", "high", "xhigh", "max"].includes(args.quality)) throw new Error("Invalid --quality");
  const loaded = loadCase(args.manifest, args.caseId);
  if (args.wardrobeLock && !args.fullScene) throw new Error("--wardrobe-lock currently requires --full-scene");
  if (args.wardrobeLock && !loaded.character.bodySheet) throw new Error("--wardrobe-lock requires character.bodySheet");
  if (args.headOnlyPortrait && !args.wardrobeLock) throw new Error("--head-only-portrait requires --wardrobe-lock");
  const env = { ...readEnvFile(path.join(STUDIO_DIR, ".env.local")), ...process.env };
  if (!env.FAL_KEY) throw new Error("FAL_KEY is not configured");
  fal.config({ credentials: env.FAL_KEY });

  const templateMeta = await sharp(loaded.testCase.template).metadata();
  if (args.fullScene) {
    if (args.prepareOnly) throw new Error("--prepare-only is only available for the masked-crop mode");
    return runFullScene({ args, loaded, templateMeta });
  }
  const crop = paddedCrop(loaded.testCase.heroBodyBox, templateMeta.width, templateMeta.height);
  if (crop.width * crop.height < 655360) throw new Error(`Crop ${crop.width}x${crop.height} is below the provider minimum pixel count`);
  if (Math.max(crop.width / crop.height, crop.height / crop.width) > 3) throw new Error(`Crop ${crop.width}x${crop.height} exceeds the provider 3:1 aspect limit`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(loaded.outputDir, `${stamp}-sunburst-${loaded.testCase.id}`);
  fs.mkdirSync(runDir, { recursive: true });

  const fullMask = await connectedSilhouetteMask(
    loaded.testCase.template,
    loaded.testCase.heroBodyBox,
    loaded.testCase.maskLuminanceMin ?? 70,
    loaded.testCase.maskChannelSpread ?? 45,
    loaded.testCase.maskComponentMode ?? "union",
    loaded.testCase.maskHeadEllipseBox ?? null,
  );
  // connectedSilhouetteMask already expands the segmented edge enough to
  // replace the white mannequin rim, so use that same matte for the API and
  // the deterministic safety composite.
  const grownMask = fullMask;
  const cropImage = await sharp(loaded.testCase.template).extract(crop).png().toBuffer();
  const cropSubjectMask = await sharp(grownMask).extract(crop).png().toBuffer();
  // fal's edit endpoint uses a black/white mask: white pixels may change and
  // black pixels must be preserved. An alpha-only mask is interpreted as an
  // all-white edit region because its RGB channels are white everywhere.
  const cropApiMask = cropSubjectMask;
  fs.writeFileSync(path.join(runDir, "01-scene-crop.png"), cropImage);
  fs.writeFileSync(path.join(runDir, "02-edit-mask.png"), cropApiMask);
  fs.writeFileSync(path.join(runDir, "00-silhouette-mask.png"), fullMask);
  fs.writeFileSync(path.join(runDir, "00-grown-mask.png"), grownMask);
  const maskStats = await sharp(grownMask).stats();
  console.log(`Prepared mask: min=${maskStats.channels[0].min}, max=${maskStats.channels[0].max}, mean=${maskStats.channels[0].mean.toFixed(2)}`);
  if (args.prepareOnly) {
    console.log(`Prepared artifacts: ${runDir}`);
    return;
  }

  const refs = [bufferDataUrl(cropImage), dataUrl(loaded.character.portrait)];
  if (loaded.character.headSheet) refs.push(dataUrl(loaded.character.headSheet));
  if (loaded.character.bodySheet) refs.push(dataUrl(loaded.character.bodySheet));
  const poseInstruction = loaded.testCase.sceneInstruction ?? "Keep the silhouette's exact pose, scale, head direction, gaze, hands, and interaction with any props.";
  const prompt = `Image 1 is a crop from a finished cinematic 3D children's-book scene. It contains one blank pure-white child silhouette. Edit ONLY the white masked silhouette.\n\nImage 2 is the approved identity portrait and the absolute authority for the child's face. Reproduce this same specific child, not a similar child: preserve apparent age, face length and width, forehead, jaw and chin, cheek fullness, eye and iris size and spacing, eyelids, nose bridge and tip, mouth and lip shape, ears, skin tone and markings, hairline, part, hair length and color, and any glasses or jewelry. Do not beautify, round, shorten, soften, enlarge the eyes, shrink the nose, exaggerate the expression, or substitute a generic animated child face. Ignore every facial proportion implied by the blank mannequin.\n\n${loaded.character.headSheet ? "Image 3 is a head turnaround of the same child. Use the closest angle only to understand 3D geometry; if it differs from Image 2, Image 2 wins for identity.\n\n" : ""}${loaded.character.bodySheet ? `Image ${loaded.character.headSheet ? 4 : 3} is the body and outfit reference. Use it for body proportions and the exact outfit only, never as face authority.\n\n` : ""}Fill the silhouette with this exact child. ${poseInstruction} Match the existing lighting direction and cinematic 3D scene style. Preserve every unmasked pixel exactly. Return the complete crop at exactly ${crop.width}x${crop.height}.`;

  console.log(`Calling ${ENDPOINT}: ${crop.width}x${crop.height}, quality=${args.quality}, references=${refs.length}`);
  const response = await fal.subscribe(ENDPOINT, {
    input: {
      prompt,
      image_urls: refs,
      mask_url: bufferDataUrl(cropApiMask),
      image_size: { width: crop.width, height: crop.height },
      quality: args.quality,
      num_images: 1,
      output_format: "png",
      sync_mode: true,
    },
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_PROGRESS") for (const entry of update.logs ?? []) console.log(`  ${entry.message}`);
    },
  });
  const image = response.data?.images?.[0];
  if (!image?.url) throw new Error("Sunburst returned no image URL");
  const generatedResponse = await fetch(image.url);
  if (!generatedResponse.ok) throw new Error(`Failed to fetch Sunburst output: ${generatedResponse.status}`);
  const generated = Buffer.from(await generatedResponse.arrayBuffer());
  fs.writeFileSync(path.join(runDir, "03-generated-crop.png"), generated);
  const resultFile = path.join(runDir, "04-composited-full.png");
  await compositePatch(loaded.testCase.template, generated, grownMask, crop, resultFile);
  const drift = await outsideMaskDrift(loaded.testCase.template, resultFile, grownMask);
  const report = {
    endpoint: ENDPOINT,
    quality: args.quality,
    crop,
    references: refs.length,
    requestId: response.requestId ?? null,
    outputProviderDimensions: { width: image.width ?? null, height: image.height ?? null },
    outsideMaskDrift: drift,
    resultFile,
  };
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Result: ${resultFile}`);
  console.log(`Outside-mask changed pixels: ${drift.changedPixels}/${drift.comparedPixels} (${drift.percent}%)`);
  console.log(`Report: ${path.join(runDir, "report.json")}`);
}

main().catch((error) => {
  console.error(`sunburst crop: ${error.message}`);
  process.exitCode = 1;
});
