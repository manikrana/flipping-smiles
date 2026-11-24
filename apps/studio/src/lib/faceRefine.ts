import sharp from "sharp";
import { getGemini, NANO_BANANA_2_MODEL, urlToInlineData, extractImageBuffer } from "@/lib/gemini";

// Second-pass face refinement for order fill-ins (duplicated per-app, same
// convention as fillInHeroIdentity: apps/studio and apps/store keep identical
// copies of this file).
//
// Why: the fill-in regenerates the whole spread, and on a full spread the
// hero's face is a small part of the image, so fine likeness details (hair
// shape, face roundness, apparent age) drift away from the cartoon portrait
// even when the portrait itself is spot on. This pass crops just the hero's
// head from the finished fill-in, has Gemini redraw only the face and hair at
// a large size with the portrait right beside it, then feathers the result
// back in. Every pixel outside the soft head mask stays exactly as the
// fill-in produced it.
//
// Fail-safe by design: any problem (no head found, odd box, Gemini refusal,
// bad output) returns the original fill-in unchanged, so this can never block
// or break an order.
//
// Post-refine guard (added after a real preview shipped a "floating head"):
// the redraw is a fresh generation, so Gemini sometimes moves or shrinks the
// head inside the square and redraws a collar under it. Pasted back, that
// leaves a second head-and-collar sitting on top of the body's own collar.
// The judges in the order pipeline run BEFORE this step, so nothing caught
// it. Every redraw is now checked against the original close-up (head still
// in the same place and size, still attached, no doubled neck/collar/chin)
// before it is pasted; a failed check retries once, then keeps the
// unrefined fill-in, which has already passed every judge. Set FACE_REFINE=off to disable it entirely.
// Rollback steps: docs/changelog/2026-11-18-face-refine.md.

export function faceRefineEnabled(): boolean {
  return (process.env.FACE_REFINE ?? "on").toLowerCase() !== "off";
}

// head = the detected head box inside the square crop, as 0-1 fractions of
// the crop, so the post-refine check knows where the head must stay.
type Box = { left: number; top: number; size: number; head: { x0: number; y0: number; x1: number; y1: number } };

// Head box from Gemini's detection output (box_2d = [ymin, xmin, ymax, xmax]
// on a 0-1000 grid), expanded into a square crop with room for hair and a
// little context so the redraw can match lighting and the blend has margin.
async function detectHeroHead(
  buffer: Buffer,
  width: number,
  height: number,
  mimeType: string
): Promise<Box | null> {
  // Same image model in text mode as the existing judges -- the plain text
  // model 404s with this key/SDK combo (see judgeIdentityMatch).
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });
  const result = await model.generateContent([
    { inlineData: { data: buffer.toString("base64"), mimeType } },
    `Find the head of the main child character in this children's book illustration (the story's hero). ` +
      `The box must cover the whole head: all of the hair, the face, ears and any glasses, but not the neck or shoulders.\n\n` +
      `Respond with ONLY this JSON and nothing else: {"box_2d": [ymin, xmin, ymax, xmax]} using integers on a 0-1000 scale ` +
      `relative to the image height (y) and width (x). If there is no child in the image, respond {"box_2d": null}.`,
  ]);
  const text = result.response.text();
  const match = text.match(/\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]/);
  if (!match) return null;
  const [ymin, xmin, ymax, xmax] = match.slice(1, 5).map(Number);
  if (!(ymax > ymin && xmax > xmin) || ymax > 1000 || xmax > 1000) return null;

  const boxW = ((xmax - xmin) / 1000) * width;
  const boxH = ((ymax - ymin) / 1000) * height;
  const areaFrac = (boxW * boxH) / (width * height);
  // A head covering more than a quarter of a spread, or a speck, means the
  // detection is wrong -- skip rather than redraw the wrong region.
  if (areaFrac > 0.25 || areaFrac < 0.0005) return null;

  const cx = ((xmin + xmax) / 2 / 1000) * width;
  const cy = ((ymin + ymax) / 2 / 1000) * height;
  let size = Math.round(Math.max(boxW, boxH) * 1.6);
  size = Math.min(size, width, height);
  const left = Math.round(Math.min(Math.max(cx - size / 2, 0), width - size));
  const top = Math.round(Math.min(Math.max(cy - size / 2, 0), height - size));
  const hx0 = (xmin / 1000) * width;
  const hy0 = (ymin / 1000) * height;
  const head = {
    x0: (hx0 - left) / size,
    y0: (hy0 - top) / size,
    x1: (hx0 + boxW - left) / size,
    y1: (hy0 + boxH - top) / size,
  };
  return { left, top, size, head };
}

// Soft elliptical alpha mask: fully opaque over the head, fading out well
// before the crop edge so the seam is invisible. Nudged up and kept short at
// the bottom so it ends around the chin: the old mask reached ~12% of a head
// height below the chin, which is how a redrawn collar got pasted in over
// the body's own collar.
async function featherMask(size: number): Promise<Buffer> {
  const rx = size * 0.35;
  const ry = size * 0.365;
  const cy = size * 0.48;
  const blur = Math.max(2, Math.round(size * 0.05));
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="100%" height="100%" fill="black"/>` +
      `<ellipse cx="${size / 2}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/>` +
      `</svg>`
  );
  // Single channel (white = keep refined pixels), joined on as the alpha band.
  return sharp(svg).blur(blur).extractChannel(0).png().toBuffer();
}

const REFINE_ATTEMPTS = 2;
// How far the redrawn head may drift inside the crop before the redraw is
// thrown away: centre shift as a fraction of the crop, and head-height ratio.
const MAX_CENTER_SHIFT = 0.07;
const MIN_SIZE_RATIO = 0.85;
const MAX_SIZE_RATIO = 1.18;

// Compares the redrawn close-up with the original one. Two independent
// signals from one text-only call (same cost class as head detection):
// where the head now is (checked numerically against the original box), and
// a yes/no on anatomy (head attached, nothing doubled).
async function checkRefinedHead(
  beforeCrop: Buffer,
  afterCrop: Buffer,
  head: Box["head"]
): Promise<{ ok: boolean; reason: string }> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });
  const result = await model.generateContent([
    { inlineData: { data: beforeCrop.toString("base64"), mimeType: "image/png" } },
    `BEFORE (above): a close-up of a child from a storybook illustration.`,
    { inlineData: { data: afterCrop.toString("base64"), mimeType: "image/png" } },
    `AFTER (above): the same close-up after the child's face and hair were redrawn. Only the face and hair were supposed to change.\n\n` +
      `1. Give the box of the child's head in AFTER (all the hair, face and ears, not the neck).\n` +
      `2. Is the AFTER image anatomically broken in a way BEFORE is not? Count it as broken if the head looks detached or floating, sits on its own separate neck or collar, the neck is missing or stretched, there is a second chin, collar, bow or neckline stacked under the head, or any body part appears twice. Ordinary differences in the face itself do not count.\n\n` +
      `Respond with ONLY this JSON and nothing else: {"box_2d": [ymin, xmin, ymax, xmax], "broken": true|false, "reason": "<one short sentence>"} ` +
      `using integers on a 0-1000 scale relative to AFTER's height (y) and width (x).`,
  ]);
  const text = result.response.text();
  const reason = text.match(/"reason"\s*:\s*"([^"]*)"/)?.[1] ?? "";
  if (/"broken"\s*:\s*true/i.test(text)) return { ok: false, reason: `anatomy: ${reason || "broken"}` };
  if (!/"broken"\s*:\s*false/i.test(text)) return { ok: false, reason: "unreadable check response" };

  const m = text.match(/\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]/);
  if (!m) return { ok: false, reason: "no head box in redraw" };
  const [ymin, xmin, ymax, xmax] = m.slice(1, 5).map((n) => Number(n) / 1000);
  const shift = Math.hypot((xmin + xmax) / 2 - (head.x0 + head.x1) / 2, (ymin + ymax) / 2 - (head.y0 + head.y1) / 2);
  const ratio = (ymax - ymin) / (head.y1 - head.y0);
  if (shift > MAX_CENTER_SHIFT) return { ok: false, reason: `head moved ${(shift * 100).toFixed(0)}% of the crop` };
  if (ratio < MIN_SIZE_RATIO || ratio > MAX_SIZE_RATIO) return { ok: false, reason: `head resized x${ratio.toFixed(2)}` };
  return { ok: true, reason };
}

export async function refineHeroFace(params: {
  fillInBuffer: Buffer;
  portraitUrl: string | null | undefined;
  headSheetUrl?: string | null;
  onGeminiCall?: (kind: "detect" | "refine") => Promise<void>;
}): Promise<Buffer> {
  const { fillInBuffer, portraitUrl, headSheetUrl, onGeminiCall } = params;
  if (!faceRefineEnabled() || !portraitUrl) return fillInBuffer;

  try {
    const base = sharp(fillInBuffer);
    const meta = await base.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return fillInBuffer;

    const mimeType = meta.format === "jpeg" ? "image/jpeg" : meta.format === "webp" ? "image/webp" : "image/png";
    const box = await detectHeroHead(fillInBuffer, width, height, mimeType);
    if (onGeminiCall) await onGeminiCall("detect");
    if (!box || box.size < 48) {
      console.warn("[face-refine] no usable head box; keeping fill-in as is");
      return fillInBuffer;
    }

    const crop = await sharp(fillInBuffer)
      .extract({ left: box.left, top: box.top, width: box.size, height: box.size })
      .resize(1024, 1024, { kernel: "lanczos3" })
      .png()
      .toBuffer();

    const model = getGemini().getGenerativeModel({
      model: NANO_BANANA_2_MODEL,
      generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "1:1" } } as never,
    });
    const parts: Parameters<typeof model.generateContent>[0] = [];
    parts.push(await urlToInlineData(portraitUrl, "image/png"));
    parts.push(
      `PORTRAIT (above): the exact child this book is about. This is the likeness authority for the face and hair.`
    );
    if (headSheetUrl) {
      parts.push(await urlToInlineData(headSheetUrl, "image/png"));
      parts.push(
        `HEAD TURNAROUND (above): the same child's head from several angles. Use the view closest to the head angle in the close-up below.`
      );
    }
    parts.push({ inlineData: { data: crop.toString("base64"), mimeType: "image/png" } });
    parts.push(
      `CLOSE-UP (above): an enlarged crop of that child's head from a finished storybook illustration. The likeness has drifted from the portrait.\n\n` +
        `TASK: redraw ONLY the child's face and hair in this close-up so it is unmistakably the child in the PORTRAIT: same face shape and cheek fullness, same apparent age, same eyes, brows, nose, mouth and smile, same hairline, hair colour, hair shape, volume and fringe, same skin tone, and the same glasses (frame shape and colours) if the portrait has them.\n\n` +
        `KEEP EXACTLY: the head's position, size, tilt and turn within this square frame; the expression's mood; the lighting direction and colour on the face; the Pixar-style 3D render style. Everything that is not the face or hair (background, clothing, hands, objects) must stay identical. Output the same square framing at the same scale, with nothing added or cropped.`
    );

    let refinedRaw: Buffer | null = null;
    for (let attempt = 1; attempt <= REFINE_ATTEMPTS; attempt++) {
      const result = await model.generateContent(parts);
      if (onGeminiCall) await onGeminiCall("refine");
      const candidate = await sharp(extractImageBuffer(result.response))
        .resize(1024, 1024, { fit: "fill", kernel: "lanczos3" })
        .removeAlpha()
        .png()
        .toBuffer();
      const check = await checkRefinedHead(crop, candidate, box.head);
      // Text-only call in the same price class as detection, so it is logged
      // under the detect call type rather than adding a new one.
      if (onGeminiCall) await onGeminiCall("detect");
      if (check.ok) {
        refinedRaw = candidate;
        break;
      }
      console.warn(`[face-refine] attempt ${attempt}/${REFINE_ATTEMPTS} rejected: ${check.reason}`);
    }
    if (!refinedRaw) {
      console.warn("[face-refine] no redraw passed the check; keeping fill-in as is");
      return fillInBuffer;
    }

    // Two separate passes on purpose: sharp applies removeAlpha after
    // joinChannel within one pipeline, which would strip the new mask band.
    const refinedRgb = await sharp(refinedRaw)
      .resize(box.size, box.size, { fit: "fill", kernel: "lanczos3" })
      .removeAlpha()
      .png()
      .toBuffer();
    const refined = await sharp(refinedRgb).joinChannel(await featherMask(box.size)).png().toBuffer();

    const out = sharp(fillInBuffer).composite([{ input: refined, left: box.left, top: box.top }]);
    // Keep the fill-in's own encoding so callers' upload content types stay valid.
    const format = meta.format === "jpeg" ? "jpeg" : meta.format === "webp" ? "webp" : "png";
    return await out.toFormat(format, format === "png" ? {} : { quality: 95 }).toBuffer();
  } catch (err) {
    console.warn("[face-refine] skipped:", err instanceof Error ? err.message : err);
    return fillInBuffer;
  }
}
