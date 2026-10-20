#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fal } from "@fal-ai/client";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_DIR = path.resolve(SCRIPT_DIR, "../..");
const SEGMENT_ENDPOINT = "fal-ai/sam-3/image";

function parseArgs(argv) {
  const result = { confirmSpend: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--manifest") result.manifest = argv[++index];
    else if (argument === "--case") result.caseId = argv[++index];
    else if (argument === "--generated") result.generated = argv[++index];
    else if (argument === "--mask") result.mask = argv[++index];
    else if (argument === "--confirm-spend") result.confirmSpend = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function usage() {
  console.log(`Hybrid identity composite

Extract the child from an existing full-scene generation with SAM 3, patch the
original mannequin only inside its mask, and place the extracted child over the
untouched original scene.

Usage:
  pnpm --filter @kitabee/studio identity:hybrid -- \\
    --manifest FILE --case ID --generated FILE --confirm-spend

Reuse an already-downloaded SAM mask without another API call:
  pnpm --filter @kitabee/studio identity:hybrid -- \\
    --manifest FILE --case ID --generated FILE --mask FILE
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

function normalizeBox(label, box) {
  if (!Array.isArray(box) || box.length !== 4 || box.some((value) => !Number.isFinite(value) || value < 0 || value > 1000)) {
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
  const template = resolveFrom(base, item.template);
  assertFile(`case ${caseId} template`, template);
  return {
    manifest,
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
  const padX = Math.max(120, Math.round((raw.right - raw.left) * 0.9));
  const padY = Math.max(80, Math.round((raw.bottom - raw.top) * 0.22));
  const left = Math.max(0, raw.left - padX);
  const top = Math.max(0, raw.top - padY);
  const right = Math.min(width, raw.right + padX);
  const bottom = Math.min(height, raw.bottom + padY);
  return { left, top, width: right - left, height: bottom - top };
}

async function connectedSilhouetteMask(template, bodyBox, luminanceMin = 70, channelSpread = 45, componentMode = "union", headEllipseBox = null) {
  const metadata = await sharp(template).metadata();
  const width = metadata.width;
  const height = metadata.height;
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
      const red = raw[offset];
      const green = raw[offset + 1];
      const blue = raw[offset + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      if (minimum >= luminanceMin && maximum - minimum <= channelSpread) candidate[y * workWidth + x] = 1;
    }
  }
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
          const currentX = current % workWidth;
          const currentY = (current - currentX) / workWidth;
          for (const [deltaX, deltaY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nextX = currentX + deltaX;
            const nextY = currentY + deltaY;
            if (nextX < x0 || nextX > x1 || nextY < y0 || nextY > y1) continue;
            const next = nextY * workWidth + nextX;
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
    const centerX = (head.left + head.right) / 2;
    const centerY = (head.top + head.bottom) / 2;
    const radiusX = (head.right - head.left) / 2;
    const radiusY = (head.bottom - head.top) / 2;
    const clipped = new Uint8Array(selected.length);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const index = y * workWidth + x;
        const inHead = ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2 <= 1;
        if (y < head.bottom) {
          if (inHead) clipped[index] = 1;
        } else if (selected[index]) clipped[index] = 1;
      }
    }
    selected = clipped;
  }
  const union = Buffer.from(selected.map((value) => value ? 255 : 0));
  return sharp(union, { raw: { width: workWidth, height: workHeight, channels: 1 } })
    .resize(width, height, { kernel: "nearest" })
    .erode(4)
    .blur(4)
    .threshold(12)
    .png()
    .toBuffer();
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch segmentation output: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function alphaFromMask(maskBuffer, width, height) {
  const metadata = await sharp(maskBuffer).metadata();
  const hasAlpha = metadata.hasAlpha;
  let pipeline = sharp(maskBuffer).resize(width, height, { fit: "fill", kernel: "lanczos3" });
  if (hasAlpha) pipeline = pipeline.extractChannel("alpha");
  else pipeline = pipeline.greyscale();
  const raw = await pipeline.raw().toBuffer();
  let total = 0;
  for (const value of raw) total += value;
  if (total / raw.length > 160) {
    for (let index = 0; index < raw.length; index++) raw[index] = 255 - raw[index];
  }
  return sharp(raw, { raw: { width, height, channels: 1 } })
    .median(3)
    .blur(0.6)
    .png()
    .toBuffer();
}

async function rgbaWithAlpha(imageBuffer, width, height, alphaRaw) {
  const rgb = await sharp(imageBuffer).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    rgba[index * 4] = rgb[index * 3];
    rgba[index * 4 + 1] = rgb[index * 3 + 1];
    rgba[index * 4 + 2] = rgb[index * 3 + 2];
    rgba[index * 4 + 3] = alphaRaw[index];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function outsideCompositeDrift(template, result, protectedMask) {
  const [before, after, mask] = await Promise.all([
    sharp(template).removeAlpha().raw().toBuffer(),
    sharp(result).removeAlpha().raw().toBuffer(),
    sharp(protectedMask).extractChannel(0).raw().toBuffer(),
  ]);
  let changed = 0;
  let compared = 0;
  for (let index = 0; index < mask.length; index++) {
    if (mask[index] > 0) continue;
    compared++;
    const offset = index * 3;
    if (before[offset] !== after[offset] || before[offset + 1] !== after[offset + 1] || before[offset + 2] !== after[offset + 2]) changed++;
  }
  return { changedPixels: changed, comparedPixels: compared, percent: Number((changed / compared * 100).toFixed(6)) };
}

function intersectionOverUnion(normalizedBox, prompt, crop) {
  if (!normalizedBox || normalizedBox.length !== 4) return 0;
  const [centerX, centerY, boxWidth, boxHeight] = normalizedBox;
  const candidate = {
    left: (centerX - boxWidth / 2) * crop.width,
    top: (centerY - boxHeight / 2) * crop.height,
    right: (centerX + boxWidth / 2) * crop.width,
    bottom: (centerY + boxHeight / 2) * crop.height,
  };
  const expected = { left: prompt.x_min, top: prompt.y_min, right: prompt.x_max, bottom: prompt.y_max };
  const intersectionWidth = Math.max(0, Math.min(candidate.right, expected.right) - Math.max(candidate.left, expected.left));
  const intersectionHeight = Math.max(0, Math.min(candidate.bottom, expected.bottom) - Math.max(candidate.top, expected.top));
  const intersection = intersectionWidth * intersectionHeight;
  const candidateArea = Math.max(0, candidate.right - candidate.left) * Math.max(0, candidate.bottom - candidate.top);
  const expectedArea = Math.max(0, expected.right - expected.left) * Math.max(0, expected.bottom - expected.top);
  const union = candidateArea + expectedArea - intersection;
  return union > 0 ? intersection / union : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!args.manifest || !args.caseId || !args.generated) throw new Error("--manifest, --case, and --generated are required");
  if (!args.mask && !args.confirmSpend) throw new Error("The paid segmentation call requires --confirm-spend");
  const loaded = loadCase(args.manifest, args.caseId);
  const generatedFile = path.resolve(args.generated);
  assertFile("generated full-scene image", generatedFile);
  if (args.mask) assertFile("SAM mask", path.resolve(args.mask));
  const environment = { ...readEnvFile(path.join(STUDIO_DIR, ".env.local")), ...process.env };
  if (!args.mask) {
    if (!environment.FAL_KEY) throw new Error("FAL_KEY is not configured");
    fal.config({ credentials: environment.FAL_KEY });
  }

  const templateMetadata = await sharp(loaded.testCase.template).metadata();
  const width = templateMetadata.width;
  const height = templateMetadata.height;
  const generated = await sharp(generatedFile).resize(width, height, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const crop = paddedCrop(loaded.testCase.heroBodyBox, width, height);
  const generatedCrop = await sharp(generated).extract(crop).png().toBuffer();
  const body = normalizedBoxToPixels(loaded.testCase.heroBodyBox, width, height);
  const boxPrompt = {
    x_min: Math.max(0, body.left - crop.left),
    y_min: Math.max(0, body.top - crop.top),
    x_max: Math.min(crop.width - 1, body.right - crop.left),
    y_max: Math.min(crop.height - 1, body.bottom - crop.top),
    object_id: 1,
  };

  let response;
  if (args.mask) {
    const normalizedPromptBox = [
      (boxPrompt.x_min + boxPrompt.x_max) / 2 / crop.width,
      (boxPrompt.y_min + boxPrompt.y_max) / 2 / crop.height,
      (boxPrompt.x_max - boxPrompt.x_min) / crop.width,
      (boxPrompt.y_max - boxPrompt.y_min) / crop.height,
    ];
    response = { data: { masks: [{ localFile: path.resolve(args.mask) }], scores: [1], boxes: [normalizedPromptBox] }, requestId: null };
    console.log(`Reusing local SAM mask: ${path.resolve(args.mask)}`);
  } else {
    console.log(`Calling ${SEGMENT_ENDPOINT} for ${crop.width}x${crop.height} generated-character crop`);
    response = await fal.subscribe(SEGMENT_ENDPOINT, {
      input: {
        image_url: dataUrl(generatedCrop),
        prompt: "the complete child character in the foreground, including all hair, limbs, hands, feet, clothing, and accessories",
        box_prompts: [boxPrompt],
        point_prompts: [],
        apply_mask: false,
        output_format: "png",
        return_multiple_masks: true,
        max_masks: 3,
        include_scores: true,
        include_boxes: true,
        sync_mode: true,
      },
      logs: true,
      onQueueUpdate(update) {
        if (update.status === "IN_PROGRESS") for (const entry of update.logs ?? []) console.log(`  ${entry.message}`);
      },
    });
  }
  const masks = response.data?.masks ?? [];
  if (!masks.length) throw new Error("SAM 3 returned no masks");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(loaded.outputDir, `${stamp}-hybrid-${loaded.testCase.id}`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "01-generated-crop.png"), generatedCrop);
  const originalMask = await connectedSilhouetteMask(
    loaded.testCase.template,
    loaded.testCase.heroBodyBox,
    loaded.testCase.maskLuminanceMin ?? 70,
    loaded.testCase.maskChannelSpread ?? 45,
    loaded.testCase.maskComponentMode ?? "union",
    loaded.testCase.maskHeadEllipseBox ?? null,
  );
  fs.writeFileSync(path.join(runDir, "02-original-silhouette-mask.png"), originalMask);

  const originalAlpha = await sharp(originalMask).extractChannel(0).blur(1).raw().toBuffer();
  const originalMaskRaw = await sharp(originalMask).extractChannel(0).raw().toBuffer();
  const fullScenePatch = await rgbaWithAlpha(generated, width, height, originalAlpha);
  const repairedBase = await sharp(loaded.testCase.template).composite([{ input: fullScenePatch }]).png().toBuffer();
  fs.writeFileSync(path.join(runDir, "03-repaired-base.png"), repairedBase);

  const results = [];
  for (let index = 0; index < masks.length; index++) {
    const rawMask = masks[index].localFile ? fs.readFileSync(masks[index].localFile) : await download(masks[index].url);
    fs.writeFileSync(path.join(runDir, `04-sam-mask-${index + 1}.png`), rawMask);
    const alpha = await alphaFromMask(rawMask, crop.width, crop.height);
    fs.writeFileSync(path.join(runDir, `05-alpha-${index + 1}.png`), alpha);
    const alphaRaw = await sharp(alpha).extractChannel(0).raw().toBuffer();
    const subject = await rgbaWithAlpha(generatedCrop, crop.width, crop.height, alphaRaw);
    const destination = path.join(runDir, `06-hybrid-${index + 1}.png`);
    await sharp(repairedBase).composite([{ input: subject, left: crop.left, top: crop.top }]).png().toFile(destination);

    const protectedRaw = Buffer.from(originalMaskRaw);
    for (let cropY = 0; cropY < crop.height; cropY++) {
      const globalY = crop.top + cropY;
      for (let cropX = 0; cropX < crop.width; cropX++) {
        const globalX = crop.left + cropX;
        const cropIndex = cropY * crop.width + cropX;
        const globalIndex = globalY * width + globalX;
        protectedRaw[globalIndex] = Math.max(protectedRaw[globalIndex], alphaRaw[cropIndex]);
      }
    }
    const protectedMask = await sharp(protectedRaw, { raw: { width, height, channels: 1 } }).png().toBuffer();
    const drift = await outsideCompositeDrift(loaded.testCase.template, destination, protectedMask);
    const providerBox = response.data?.boxes?.[index] ?? response.data?.metadata?.[index]?.box ?? null;
    results.push({
      candidate: index + 1,
      score: response.data?.scores?.[index] ?? response.data?.metadata?.[index]?.score ?? null,
      providerBox,
      promptBoxIou: Number(intersectionOverUnion(providerBox, boxPrompt, crop).toFixed(6)),
      resultFile: destination,
      outsideProtectedDrift: drift,
    });
    console.log(`Candidate ${index + 1}: ${destination}`);
  }

  const selected = results.toSorted((left, right) => right.promptBoxIou - left.promptBoxIou || (right.score ?? 0) - (left.score ?? 0))[0];
  const selectedFile = path.join(runDir, "07-hybrid-selected.png");
  fs.copyFileSync(selected.resultFile, selectedFile);

  const report = {
    endpoint: SEGMENT_ENDPOINT,
    requestId: response.requestId ?? null,
    sourceFullScene: generatedFile,
    template: loaded.testCase.template,
    crop,
    boxPrompt,
    selectedCandidate: selected.candidate,
    selectedFile,
    results,
  };
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Selected candidate ${selected.candidate}: ${selectedFile}`);
  console.log(`Report: ${path.join(runDir, "report.json")}`);
}

main().catch((error) => {
  console.error(`hybrid composite: ${error.message}`);
  process.exitCode = 1;
});
