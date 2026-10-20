import sharp from "sharp";
import type { CoverLayout, TextStyle, TextPanelBg } from "@/lib/supabase/types";
import type { GelatoCoverDimensions } from "@/lib/gelato";
import { patternToSvgDefs } from "@/lib/patterns";
import { resolveFontPath, neutralizeBrokenLigatures } from "@/lib/composite";

export type RenderedPage = { buffer: Buffer; width: number; height: number };

// Gelato productUid photobooks-hardcover_pf_200x200-mm-8x8-inch_... (apps/studio/src/lib/gelato.ts)
// Verified against Gelato's own downloaded print template for this exact productUid:
// 200mm trim, 3mm bleed/side -> 206mm content page, at 300 DPI (Gelato's recommended resolution).
export const PRINT_DPI = 300;
const PAGE_TRIM_MM = 200;
const PAGE_BLEED_MM = 3;
export const PAGE_SIZE_PX = Math.round(((PAGE_TRIM_MM + PAGE_BLEED_MM * 2) / 25.4) * PRINT_DPI); // 2433

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function wrapParagraph(paragraph: string, charsPerLine: number): string[] {
  const words = paragraph.split(/[ \t]+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= charsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Respects explicit newlines (each \n starts a new line, \n\n adds a blank
// spacer line between paragraphs) before word-wrapping each paragraph --
// mirrors composite.ts's wrapLines exactly. The previous version
// (`text.split(/\s+/)`) collapsed ALL whitespace including newlines, so any
// deliberate paragraph break an author put in a page's text was silently
// destroyed in the actual printed PDF for every layout that renders through
// this file (spread/split/title/dedication) -- a real content bug, not just
// a preview-vs-PDF cosmetic mismatch.
function wrapWords(text: string, charsPerLine: number): string[] {
  const paragraphs = text.split(/\n/);
  const result: string[] = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      result.push("");
    } else {
      result.push(...wrapParagraph(trimmed, charsPerLine));
    }
  }
  return result;
}


async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// The wraparound cover image (back cover + spine + front cover, ~1.88:1) needs
// to show ONLY the front-cover content zone when used as a small square
// thumbnail (e.g. a featured-book cover on someone else's back cover). Same
// crop fraction as apps/store/src/lib/coverCrop.ts's FRONT_COVER_IMAGE_STYLE
// (right-anchored, ~47% of the image width) -- kept in sync by hand since the
// two apps don't share a lib, but both crop the same generated images.
const FRONT_ZONE_WIDTH_FRAC = 0.47;

async function cropFrontZoneToSquareRounded(imageUrl: string, size: number, cornerRadius: number): Promise<Buffer> {
  const buf = await fetchBuffer(imageUrl);
  const meta = await sharp(buf).metadata();
  const srcW = meta.width ?? 4800;
  const srcH = meta.height ?? 2550;
  const zoneW = Math.round(srcW * FRONT_ZONE_WIDTH_FRAC);
  const cropped = await sharp(buf)
    .extract({ left: srcW - zoneW, top: 0, width: zoneW, height: srcH })
    .resize(size, size, { fit: "cover", position: "centre" })
    .toBuffer();
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="100%" height="100%" rx="${cornerRadius}" fill="#fff"/></svg>`
  );
  return sharp(cropped).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

// Render SVG via resvg-js using fontFiles (disk path).
// fontBuffers does not visually apply the font in resvg-js 2.6 — fontFiles works.
// Dynamic import keeps the native .node binary out of webpack's static analysis.
async function svgToPng(
  svg: string,
  fontPaths: string | (string | null | undefined)[] | null | undefined
): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const fontFiles = (Array.isArray(fontPaths) ? fontPaths : [fontPaths]).filter((p): p is string => !!p);
  const opts = fontFiles.length > 0
    ? { font: { loadSystemFonts: false, fontFiles } }
    : { font: { loadSystemFonts: true } };
  console.log(`[layout] svgToPng fontFiles=${fontFiles.join(",")}`);
  const result = new Resvg(svg, opts).render();
  console.log(`[layout] rendered ${result.width}x${result.height}`);
  return Buffer.from(result.asPng());
}

async function svgToJpeg(svg: string, fontPaths: string | (string | null | undefined)[] | null | undefined): Promise<Buffer> {
  const png = await svgToPng(svg, fontPaths);
  const jpg = await sharp(png).jpeg({ quality: 92 }).toBuffer();
  const { writeFileSync } = await import("fs");
  const path = `/tmp/layout-debug-${Date.now()}.jpg`;
  writeFileSync(path, jpg);
  console.log(`[layout] saved debug JPEG → ${path}`);
  return jpg;
}

function svgText(
  lines: string[],
  x: number,
  startY: number,
  lineHeight: number,
  fontFamily: string,
  fontSize: number,
  color: string,
  anchor: "start" | "middle" | "end",
  italic = false,
  shadow = false
): string {
  const shadowFilter = shadow
    ? `filter="url(#shadow)"`
    : "";
  const style = italic ? `font-style="italic"` : "";
  return lines.map((line, i) =>
    `<text x="${x}" y="${Math.round(startY + i * lineHeight)}" ` +
    `font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" ` +
    `fill="${color}" text-anchor="${anchor}" ${style} ${shadowFilter}>${escapeXml(neutralizeBrokenLigatures(line))}</text>`
  ).join("\n");
}

const SHADOW_FILTER = `<filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
  <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.5)"/>
</filter>`;

// ── Wraparound cover spread (back cover + spine + front cover) ─────────────────
// dims comes from Gelato's live cover-dimensions API for this order's real
// inner-page count -- spine width is not a formula (see gelato.ts), so this
// must always be resolved per-order, never hardcoded.

export type FeaturedBook = { title: string; coverUrl: string | null };

export type BackCoverContent = {
  websiteQrUrl: string | null;
  instagramQrUrl: string | null;
  companyName: string | null;
  leadingText: string | null;
  featuredBooks: FeaturedBook[];
};

const mmToPx = (mm: number) => Math.round((mm / 25.4) * PRINT_DPI);

export type SpineAppearance = { spineColor: string; spineTextColor: string };

// Pure -- operates on an already-resized wraparound buffer. Shared by
// renderCoverSpread below (which already has `resized` in hand from earlier
// in the pipeline) and computeSpineAppearance (the preview-only entry point
// right after this, which fetches+resizes for itself) -- one sampling
// implementation so the admin preview's spine can never drift from what
// actually prints, the same bug class as the off-center spine text fixed
// earlier this session.
function sampleSpineAppearance(
  resizedBuffer: Buffer,
  front: { left: number; top: number; width: number; height: number }
): Promise<SpineAppearance> {
  // Sample from the front panel only -- the back panel's dissolve-to-white
  // zone would otherwise wash out the average toward pale/near-white.
  return sharp(resizedBuffer)
    .extract(front)
    .stats()
    .then(({ dominant }) => {
      const spineColor = `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`;
      // Pick spine text color from the sampled color's own luminance -- this
      // was hardcoded white, which is nearly invisible on the light/cream
      // spine colors most cover art samples to (confirmed on a real order).
      const spineLuminance = (0.299 * dominant.r + 0.587 * dominant.g + 0.114 * dominant.b) / 255;
      const spineTextColor = spineLuminance > 0.6 ? "#1c1c1e" : "#ffffff";
      return { spineColor, spineTextColor };
    });
}

// Preview-only entry point -- called from a thin "use server" wrapper
// (stories/book/actions.ts's getSpineAppearance) by CoverEditor and
// OrderBookPreview, so their live spine preview shows the real sampled
// color + text color instead of a flat gray placeholder. No Gemini cost,
// pure image math, same geometry (dims.contentFrontSize) renderCoverSpread
// itself uses.
export async function computeSpineAppearance(imageUrl: string, dims: GelatoCoverDimensions): Promise<SpineAppearance> {
  const width = mmToPx(dims.wraparoundInsideSize.width);
  const height = mmToPx(dims.wraparoundInsideSize.height);
  const front = {
    left: mmToPx(dims.contentFrontSize.left), top: mmToPx(dims.contentFrontSize.top),
    width: mmToPx(dims.contentFrontSize.width), height: mmToPx(dims.contentFrontSize.height),
  };
  const buf = await fetchBuffer(imageUrl);
  const resized = await sharp(buf).resize(width, height, { fit: "cover", position: "centre" }).toBuffer();
  return sampleSpineAppearance(resized, front);
}

export async function renderCoverSpread(
  imageUrl: string,
  title: string,
  layout: CoverLayout,
  backCover: BackCoverContent,
  dims: GelatoCoverDimensions
): Promise<RenderedPage> {
  const width = mmToPx(dims.wraparoundInsideSize.width);
  const height = mmToPx(dims.wraparoundInsideSize.height);
  const front = {
    left: mmToPx(dims.contentFrontSize.left), top: mmToPx(dims.contentFrontSize.top),
    width: mmToPx(dims.contentFrontSize.width), height: mmToPx(dims.contentFrontSize.height),
  };
  const back = {
    left: mmToPx(dims.contentBackSize.left), top: mmToPx(dims.contentBackSize.top),
    width: mmToPx(dims.contentBackSize.width), height: mmToPx(dims.contentBackSize.height),
  };
  const spine = {
    left: mmToPx(dims.spineSize.left), top: mmToPx(dims.spineSize.top),
    width: mmToPx(dims.spineSize.width), height: mmToPx(dims.spineSize.height),
  };

  const buf = await fetchBuffer(imageUrl);
  const resized = await sharp(buf).resize(width, height, { fit: "cover", position: "centre" }).toBuffer();

  const fontPath = await resolveFontPath(layout.fontFamily);

  // ── Front panel: title/subtitle composited as real SVG text in the
  // story's actual font file, not baked into the generated art (see
  // lib/coverPrompt.ts's buildCoverPrompt -- the scene is pure, text-free
  // artwork now). Position follows layout.titlePosition's 9-zone grid; a
  // dark scrim across the front panel keeps it legible against the art,
  // sized by layout.overlayOpacity.
  const titleFontSize = Math.round(front.height * layout.titleSize / 100);
  const subFontSize = Math.round(front.height * layout.subtitleSize / 100);
  const titleLineHeight = Math.round(titleFontSize * 1.2);
  const subLineHeight = Math.round(subFontSize * 1.3);
  const frontGap = Math.round(front.height * 0.015);
  const frontPaddingX = Math.round(front.width * 0.06);
  const frontPaddingY = Math.round(front.height * 0.04);
  const frontCharsPerLine = Math.floor((front.width * 0.85) / (titleFontSize * 0.58));
  const subCharsPerLine = Math.floor((front.width * 0.85) / (subFontSize * 0.58));

  const titleLines = wrapWords(title, frontCharsPerLine);
  const subLines = wrapWords(layout.subtitle, subCharsPerLine);
  const frontTextHeight = titleLines.length * titleLineHeight + frontGap + subLines.length * subLineHeight;

  // Company name -- small, understated imprint pinned to the very bottom of
  // the front panel regardless of where the title block sits, like a real
  // publisher's imprint. Reserved space is subtracted from a bottom-anchored
  // title block so the two never collide.
  const companyFontSize = Math.round(front.height * 0.022);
  const companyBottomPad = Math.round(front.height * 0.025);
  const companyReserve = backCover.companyName ? Math.round(companyFontSize * 1.8) + companyBottomPad : 0;

  const [vPos, hPos] = layout.titlePosition.split("-") as ["top" | "middle" | "bottom", "left" | "center" | "right"];
  const blockTop = vPos === "top" ? front.top + frontPaddingY
    : vPos === "middle" ? front.top + (front.height - frontTextHeight) / 2
    : front.top + front.height - frontPaddingY - companyReserve - frontTextHeight;
  const titleStartY = blockTop + titleFontSize;
  const subStartY = titleStartY + titleLines.length * titleLineHeight + frontGap;
  const textAnchor = hPos === "left" ? "start" : hPos === "right" ? "end" : "middle";
  const textX = hPos === "left" ? front.left + frontPaddingX
    : hPos === "right" ? front.left + front.width - frontPaddingX
    : front.left + front.width / 2;

  // A flat scrim across the whole front panel read as dull -- darkening the
  // entire image just to keep text over one corner of it legible. A radial
  // glow centered on wherever the title block actually sits keeps the rest
  // of the art at full brightness instead.
  const frontOverlayAlpha = layout.overlayOpacity.toFixed(3);
  const gradCx = hPos === "left" ? 0.28 : hPos === "right" ? 0.72 : 0.5;
  const gradCy = vPos === "top" ? 0.28 : vPos === "bottom" ? 0.72 : 0.5;
  const frontGradId = "frontScrim";
  const frontOverlaySvg =
    `<defs><radialGradient id="${frontGradId}" cx="${gradCx}" cy="${gradCy}" r="0.65">` +
    `<stop offset="0%" stop-color="black" stop-opacity="${frontOverlayAlpha}"/>` +
    `<stop offset="100%" stop-color="black" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<rect x="${front.left}" y="${front.top}" width="${front.width}" height="${front.height}" fill="url(#${frontGradId})"/>` +
    svgText(titleLines, textX, titleStartY, titleLineHeight, layout.fontFamily, titleFontSize, layout.titleColor, textAnchor, false, true) +
    svgText(subLines, textX, subStartY, subLineHeight, layout.fontFamily, subFontSize, layout.subtitleColor, textAnchor, false, true) +
    (backCover.companyName
      ? svgText([backCover.companyName], front.left + front.width / 2, front.top + front.height - companyBottomPad, Math.round(companyFontSize * 1.2), layout.fontFamily, companyFontSize, "#ffffff", "middle", false, true)
      : "");

  // ── Back panel: leading text + featured books (top group), QR codes +
  // company name (footer) ──
  // The back-cover art is now fully clean/uncluttered (see
  // buildCoverPrompt) -- every piece of back-cover content is a real,
  // precise overlay, not baked into the AI art. The leading text and
  // featured-books panel stack as one group anchored near the top (leaving
  // the very top of the art visible), so the leading-text box sits directly
  // above the (also tight-fit) thumbnails panel. QR codes and the company
  // name sit in the footer -- Instagram bottom-left, website bottom-right,
  // company name centered between them.
  const contentMargin = Math.round(back.width * 0.08);

  // Shared card/pill sizing, used by the leading-text box up top and the
  // QR/company-name row in the footer, so all of this content reads as one
  // consistent design language.
  const qrSize = Math.round(back.height * 0.15);
  const qrPad = Math.round(qrSize * 0.12);
  const qrLabelSize = Math.round(back.height * 0.024);
  const cellWidth = qrSize + qrPad * 2;
  const labelAreaHeight = Math.round(qrLabelSize * 1.8);
  const cellHeight = cellWidth + labelAreaHeight;
  const cardRadius = Math.round(qrPad * 0.7);

  let backOverlaySvg = "";
  const backImages: { input: Buffer; left: number; top: number }[] = [];
  let panelImage: { input: Buffer; left: number; top: number } | null = null;

  const groupCenterX = back.left + back.width / 2;
  let groupCursorY = back.top + Math.round(back.height * 0.22);

  // Leading text -- decoupled from the generated art; a real, tight pill in
  // the story's own cover font, positioned directly above the featured-books
  // panel. Same treatment as the QR labels/company name below, for the same
  // legibility reason.
  if (backCover.leadingText) {
    const leadFontSize = Math.round(back.height * 0.032);
    const leadPadX = Math.round(leadFontSize * 0.9);
    const leadPadY = Math.round(leadFontSize * 0.5);
    const leadWidth = Math.round(backCover.leadingText.length * leadFontSize * 0.52) + leadPadX * 2;
    const leadHeight = Math.round(leadFontSize * 1.2) + leadPadY * 2;
    const leadTop = groupCursorY;
    const textBaselineY = Math.round(leadTop + leadHeight / 2 + leadFontSize * 0.35);
    backOverlaySvg += `<rect x="${Math.round(groupCenterX - leadWidth / 2)}" y="${leadTop}" width="${leadWidth}" height="${leadHeight}" rx="${cardRadius}" fill="rgba(255,255,255,0.85)"/>`;
    backOverlaySvg += svgText([backCover.leadingText], groupCenterX, textBaselineY, Math.round(leadFontSize * 1.3), layout.fontFamily, leadFontSize, "#1c1c1e", "middle");
    groupCursorY = leadTop + leadHeight + Math.round(back.height * 0.02);
  }

  // Featured books -- tight-fit frosted backing around the thumbnails only,
  // sized to the actual row width (not a fixed fraction of the back cover),
  // so it hugs 2 books as closely as it hugs 4.
  if (backCover.featuredBooks.length > 0) {
    const books = backCover.featuredBooks.slice(0, 4);
    const n = books.length;
    const maxThumbSize = Math.round(back.height * 0.2);
    const maxPanelWidth = Math.round(back.width * 0.9); // safety bound for up to 4 books
    const thumbGap = Math.round(maxThumbSize * 0.25);
    const thumbSize = Math.min(maxThumbSize, Math.floor((maxPanelWidth - thumbGap * (n - 1)) / n));
    const thumbRadius = Math.round(thumbSize * 0.08);

    const panelInnerPad = Math.round(back.height * 0.045);
    const panelPaddingX = Math.round(thumbSize * 0.3);
    const rowWidth = thumbSize * n + thumbGap * (n - 1);
    const panelWidth = rowWidth + panelPaddingX * 2;
    const panelCenterX = groupCenterX;
    // Rounded: back.width (from Gelato's live per-order API) isn't guaranteed
    // even, so panelCenterX - panelWidth/2 can land on a half pixel -- sharp's
    // extract()/composite() below require integer left/top.
    const panelLeft = Math.round(panelCenterX - panelWidth / 2);
    const rowLeft = panelCenterX - rowWidth / 2;
    // Stacked directly below the leading-text box (or at the group's top
    // anchor if there's no leading text).
    const panelTop = groupCursorY;

    const cursorY = panelTop + panelInnerPad;

    const thumbBuffers = await Promise.all(
      books.map((b) => (b.coverUrl ? cropFrontZoneToSquareRounded(b.coverUrl, thumbSize, thumbRadius) : Promise.resolve(null)))
    );

    const thumbTop = cursorY;
    books.forEach((_, i) => {
      const thumbLeft = Math.round(rowLeft + i * (thumbSize + thumbGap));
      const thumbBuf = thumbBuffers[i];
      if (thumbBuf) {
        backImages.push({ input: thumbBuf, left: thumbLeft, top: thumbTop });
      } else {
        backOverlaySvg += `<rect x="${thumbLeft}" y="${thumbTop}" width="${thumbSize}" height="${thumbSize}" rx="${thumbRadius}" fill="rgba(255,255,255,0.35)"/>`;
      }
    });

    const panelBottom = thumbTop + thumbSize + panelInnerPad;
    const panelHeight = panelBottom - panelTop;
    const blurSigma = Math.max(15, Math.round(panelWidth * 0.012));
    const cornerRadius = Math.round(panelWidth * 0.04);

    const blurredRegion = await sharp(resized)
      .extract({ left: panelLeft, top: panelTop, width: panelWidth, height: panelHeight })
      .blur(blurSigma)
      .toBuffer();
    const roundedMask = Buffer.from(
      `<svg width="${panelWidth}" height="${panelHeight}"><rect width="100%" height="100%" rx="${cornerRadius}" fill="#fff"/></svg>`
    );
    const tint = Buffer.from(
      `<svg width="${panelWidth}" height="${panelHeight}"><rect width="100%" height="100%" rx="${cornerRadius}" fill="rgba(255,255,255,0.55)"/></svg>`
    );
    const panelBuffer = await sharp(blurredRegion)
      .composite([{ input: tint, blend: "over" }, { input: roundedMask, blend: "dest-in" }])
      .png()
      .toBuffer();

    panelImage = { input: panelBuffer, left: panelLeft, top: panelTop };
  }

  // Footer -- up to two QR codes, Instagram bottom-left, website
  // bottom-right. Each is one solid white vertical card -- QR on top, label
  // below, single continuous background, not a floating label -- since a QR
  // needs a solid, high-contrast backing to stay scannable anyway. Both
  // targets are global (brand_settings), not per-story. The label uses the
  // story's own cover font (layout.fontFamily), matching the ingrained
  // front-cover typography, not a fixed brand font.
  const footerBottom = back.top + back.height - contentMargin;
  const qrTop = footerBottom - cellHeight;

  async function placeQr(url: string, label: string, cellLeft: number) {
    const { toBuffer: qrToBuffer } = await import("qrcode");
    const qrPng = await qrToBuffer(url, { type: "png", width: qrSize, margin: 0 });
    const cardBacking = Buffer.from(
      `<svg width="${cellWidth}" height="${cellHeight}"><rect width="100%" height="100%" rx="${cardRadius}" fill="#ffffff"/></svg>`
    );
    backImages.push({ input: await sharp(cardBacking).png().toBuffer(), left: cellLeft, top: qrTop });
    backImages.push({ input: qrPng, left: cellLeft + qrPad, top: qrTop + qrPad });

    const cellCenterX = cellLeft + cellWidth / 2;
    const labelBaselineY = qrTop + cellWidth + Math.round(labelAreaHeight / 2) + Math.round(qrLabelSize * 0.35);
    backOverlaySvg += svgText([label], cellCenterX, labelBaselineY, labelAreaHeight, layout.fontFamily, qrLabelSize, "#1c1c1e", "middle");
  }

  if (backCover.instagramQrUrl) {
    await placeQr(backCover.instagramQrUrl, "Follow us", back.left + contentMargin);
  }
  if (backCover.websiteQrUrl) {
    await placeQr(backCover.websiteQrUrl, "Website", back.left + back.width - contentMargin - cellWidth);
  }

  // Company name, centered between the two QR cards, vertically centered
  // against the QR cards' bottom edge, not their center, and with the same
  // modest corner radius as the QR cards -- not a full pill. Same tight
  // backing treatment (and the story's own cover font) as the QR labels, for
  // the same reason -- naked text over a photo isn't reliably legible.
  if (backCover.companyName) {
    const nameFontSize = Math.round(back.height * 0.026);
    const nameCenterX = back.left + back.width / 2;
    const pillBottom = qrTop + cellHeight;
    const padX = Math.round(nameFontSize * 0.9);
    const padY = Math.round(nameFontSize * 0.5);
    const pillWidth = Math.round(backCover.companyName.length * nameFontSize * 0.52) + padX * 2;
    const pillHeight = Math.round(nameFontSize * 1.2) + padY * 2;
    const pillTop = pillBottom - pillHeight;
    const textBaselineY = Math.round(pillTop + pillHeight / 2 + nameFontSize * 0.35);
    backOverlaySvg += `<rect x="${Math.round(nameCenterX - pillWidth / 2)}" y="${pillTop}" width="${pillWidth}" height="${pillHeight}" rx="${cardRadius}" fill="rgba(255,255,255,0.85)"/>`;
    backOverlaySvg += svgText([backCover.companyName], nameCenterX, textBaselineY, Math.round(nameFontSize * 1.3), layout.fontFamily, nameFontSize, "#1c1c1e", "middle");
  }

  // ── Spine: solid band sampled from the cover, with rotated title text if legible ──
  const { spineColor, spineTextColor } = await sampleSpineAppearance(resized, front);
  const spineCenterX = spine.left + spine.width / 2;
  const spineCenterY = spine.top + spine.height / 2;
  let spineOverlaySvg = `<rect x="${spine.left}" y="${spine.top}" width="${spine.width}" height="${spine.height}" fill="${spineColor}"/>`;
  // 3mm floor, not 10mm -- Gelato's own live-queried range for this product
  // (see getCoverDimensions's comment) never produces a spine narrower than
  // 6mm even at the lowest page count, so a 10mm gate silently skipped spine
  // text for every book in the lower half of the page-count range (a plain
  // color band, no title, confirmed on a real 28-page order). 6mm still
  // leaves plenty of room lengthwise for the title (spineFontSize scales
  // with spine.width, ~35px/8pt at 6mm, with 100+ characters of room along
  // the spine's length) -- 3mm is a defensive floor only, not a realistic
  // value for this product.
  if (dims.spineSize.width >= 3) {
    const spineFontSize = Math.round(spine.width * 0.5);
    const spineCharsPerLine = Math.floor((spine.height * 0.85) / (spineFontSize * 0.58));
    const spineText = layout.subtitle ? `${title}: ${layout.subtitle}` : title;
    const spineLines = wrapWords(spineText, spineCharsPerLine);
    // svgText's y is the text BASELINE, not the glyph's visual center -- and
    // ascent (above baseline) always exceeds descent (below), so using the
    // pivot's own Y as the baseline leaves the glyph's true visual center
    // above the pivot. After the -90deg rotation below, "above" becomes
    // "toward the back-cover side" of the spine, which is exactly the
    // off-center text confirmed on a real printed PDF. The same baseline
    // correction already used for the QR labels and back-cover company name
    // (+fontSize * 0.35 to go from vertical-center to baseline) fixes it here.
    const spineBaselineY = spineCenterY - ((spineLines.length - 1) * spineFontSize) / 2 + spineFontSize * 0.35;
    spineOverlaySvg += `<g transform="rotate(-90 ${spineCenterX} ${spineCenterY})">` +
      svgText(spineLines, spineCenterX, spineBaselineY, Math.round(spineFontSize * 1.2), layout.fontFamily, spineFontSize, spineTextColor, "middle", false, true) +
      `</g>`;
  }

  const overlaySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>${SHADOW_FILTER}</defs>
  ${spineOverlaySvg}
  ${frontOverlaySvg}
  ${backOverlaySvg}
</svg>`;

  const overlayPng = await svgToPng(overlaySvg, fontPath);

  // backImages (QR card backing + QR codes + featured-book thumbnails) must
  // composite BEFORE overlayPng, not after -- the QR card backing is sized
  // to include the label area underneath it (cellHeight = cellWidth +
  // labelAreaHeight), and compositing it on top of overlayPng was painting
  // that white card straight over the "Follow us"/"Website" labels baked
  // into overlayPng, hiding them completely despite rendering correctly.
  const buffer = await sharp(resized)
    .composite([
      ...(panelImage ? [panelImage] : []),
      ...backImages,
      { input: overlayPng, blend: "over" },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  return { buffer, width, height };
}

// ── Blank endpaper ───────────────────────────────────────────────────────────
// Solid page, no content -- matches the two blank leaves Gelato's own template
// places right after the cover and as the very last page.

export async function renderEndpaperPage(width: number, height: number): Promise<RenderedPage> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: "#f5f0e8" },
  }).jpeg({ quality: 92 }).toBuffer();
  return { buffer, width, height };
}

// ── Image-or-blank page ─────────────────────────────────────────────────────────
// Shared by the brand page (right-hand page of the first interior spread,
// opposite the always-blank front endpaper) and the end page (left-hand page
// of the last interior spread, opposite the always-blank back endpaper).
// Both are plain, prompt-generated square art with no text overlay -- plain
// white until an image is generated.

export async function renderImageOrBlankPage(width: number, height: number, imageUrl?: string | null): Promise<RenderedPage> {
  if (imageUrl) {
    const buf = await fetchBuffer(imageUrl);
    const jpeg = await sharp(buf)
      .resize(width, height, { fit: "cover", position: "centre" })
      .jpeg({ quality: 92 })
      .toBuffer();
    return { buffer: jpeg, width, height };
  }
  const buffer = await sharp({
    create: { width, height, channels: 3, background: "#ffffff" },
  }).jpeg({ quality: 92 }).toBuffer();
  return { buffer, width, height };
}

// ── Title page ─────────────────────────────────────────────────────────────────
// White background, story title in cover font at 7% of height, centered.
// Matches OrderBookPreview `pg.kind === "title"`.

export async function renderTitlePage(
  title: string,
  coverLayout: CoverLayout,
  width: number,
  height: number
): Promise<RenderedPage> {
  const fontPath = await resolveFontPath(coverLayout.fontFamily);
  const fontSize = Math.round(height * 0.07);
  const lineHeight = Math.round(fontSize * 1.3);
  const charsPerLine = Math.floor((width * 0.8) / (fontSize * 0.58));
  const lines = wrapWords(title, charsPerLine);
  const totalH = lines.length * lineHeight;
  const startY = (height - totalH) / 2 + fontSize;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  ${svgText(lines, width / 2, startY, lineHeight, coverLayout.fontFamily, fontSize, "#1c1c1e", "middle")}
</svg>`;

  const buffer = await svgToJpeg(svg, fontPath);
  return { buffer, width, height };
}

// ── Dedication page ────────────────────────────────────────────────────────────
// bg-amber-50 (#fffbeb), italic gray-600 (#4b5563) text at 2.8% of height, centered.
// Matches OrderBookPreview `pg.kind === "dedication"`.

export async function renderDedicationPage(
  text: string,
  coverLayout: CoverLayout,
  width: number,
  height: number
): Promise<RenderedPage> {
  const fontPath = await resolveFontPath(coverLayout.fontFamily);
  const fontSize = Math.round(height * 0.028);
  const lineHeight = Math.round(fontSize * 1.6);
  const charsPerLine = Math.floor((width * 0.8) / (fontSize * 0.50));
  const lines = wrapWords(text, charsPerLine);
  const totalH = lines.length * lineHeight;
  const startY = (height - totalH) / 2 + fontSize;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#fffbeb"/>
  ${svgText(lines, width / 2, startY, lineHeight, coverLayout.fontFamily, fontSize, "#4b5563", "middle", true)}
</svg>`;

  const buffer = await svgToJpeg(svg, fontPath);
  return { buffer, width, height };
}

// ── Overlay page (overlay_bottom) ─────────────────────────────────────────────
// Embeds the pre-composited text_image_url at native dimensions — no crop, no resize.

export async function renderOverlayPage(imageUrl: string): Promise<RenderedPage> {
  const buf = await fetchBuffer(imageUrl);
  const width = PAGE_SIZE_PX;
  const height = PAGE_SIZE_PX;
  const jpeg = await sharp(buf)
    .resize(width, height, { fit: "cover", position: "centre" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer: jpeg, width, height };
}

// ── Image page (split_horizontal) ─────────────────────────────────────────────

export async function renderImagePage(
  imageUrl: string,
  width = PAGE_SIZE_PX,
  height = PAGE_SIZE_PX
): Promise<RenderedPage> {
  const buf = await fetchBuffer(imageUrl);
  const jpeg = await sharp(buf)
    .resize(width, height, { fit: "cover", position: "centre" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer: jpeg, width, height };
}

// ── Text split page (split_horizontal right side) ─────────────────────────────
// Matches the app preview: text centered vertically, bg from text_panel_bg.

export async function renderTextSplitPage(
  text: string,
  textStyle: TextStyle,
  textPanelBg: TextPanelBg,
  width: number,
  height: number,
  textBgUrl?: string | null,
  verticalAlign: "top" | "center" | "bottom" = "bottom",
): Promise<RenderedPage> {
  const fontPath = await resolveFontPath(textStyle.fontFamily);
  const fontSize = Math.round(height * (textStyle.fontSizePct / 100));
  const lineHeight = Math.round(fontSize * 1.55);
  const paddingX = Math.round(width * 0.1);
  const availableWidth = width - paddingX * 2;
  const charsPerLine = Math.floor(availableWidth / (fontSize * 0.58));
  const lines = wrapWords(text, charsPerLine);
  const totalH = lines.length * lineHeight;
  // Same verticalAlign fix as renderSpreadTextPage -- see its comment.
  const vMargin = Math.round(height * 0.06);
  const blockTop = verticalAlign === "top" ? vMargin
    : verticalAlign === "center" ? Math.round((height - totalH) / 2)
    : height - vMargin - totalH;
  const startY = blockTop + fontSize;

  let bgElement: string;
  if (textPanelBg.type === "none") {
    bgElement = `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  } else if (textPanelBg.type === "scene_bleed" && textBgUrl) {
    const res = await fetch(textBgUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    const mime = textBgUrl.endsWith(".png") ? "image/png" : "image/jpeg";
    bgElement = `<image href="data:${mime};base64,${b64}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`;
  } else if (textPanelBg.type === "gradient") {
    const isVertical = textPanelBg.direction === "to-bottom";
    const x2 = isVertical ? 0 : 1;
    const y2 = isVertical ? 1 : 0;
    bgElement = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${x2}" y2="${y2}" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="${textPanelBg.from}"/>
      <stop offset="100%" stop-color="${textPanelBg.to}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>`;
  } else if (textPanelBg.type === "pattern") {
    bgElement = patternToSvgDefs(textPanelBg.patternId, textPanelBg.color, textPanelBg.bgColor, width, height);
  } else if (textPanelBg.type === "solid") {
    bgElement = `<rect width="${width}" height="${height}" fill="${textPanelBg.color}"/>`;
  } else {
    bgElement = `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  }

  const textAnchor = textStyle.alignment === "left" ? "start" : textStyle.alignment === "right" ? "end" : "middle";
  const textX = textStyle.alignment === "left" ? paddingX : textStyle.alignment === "right" ? width - paddingX : width / 2;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${bgElement}
  ${svgText(lines, textX, startY, lineHeight, textStyle.fontFamily, fontSize, textStyle.color, textAnchor)}
</svg>`;

  const buffer = await svgToJpeg(svg, fontPath);
  return { buffer, width, height };
}

// ── Review image page ─────────────────────────────────────────────────────────
// Full-bleed image with a small label strip at the bottom for character review.

export async function renderReviewImagePage(imageUrl: string, label: string): Promise<RenderedPage> {
  const buf = await fetchBuffer(imageUrl);
  const meta = await sharp(buf).metadata();
  const width = meta.width!;
  const height = meta.height!;

  const labelH = Math.round(height * 0.06);
  const fontSize = Math.round(labelH * 0.5);

  const labelSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="${height - labelH}" width="${width}" height="${labelH}" fill="rgba(0,0,0,0.55)"/>
  <text x="${width / 2}" y="${height - Math.round(labelH * 0.28)}" font-family="sans-serif" font-size="${fontSize}" fill="#ffffff" text-anchor="middle">${escapeXml(label)}</text>
</svg>`;

  const { Resvg } = await import("@resvg/resvg-js");
  const overlayPng = Buffer.from(new Resvg(labelSvg, { font: { loadSystemFonts: true } }).render().asPng());

  const jpeg = await sharp(buf)
    .composite([{ input: overlayPng, blend: "over" }])
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer: jpeg, width, height };
}

// ── Review divider page ───────────────────────────────────────────────────────
// Signals the start of the actual story content.

export async function renderReviewDividerPage(title: string, width: number, height: number): Promise<RenderedPage> {
  const fontSize = Math.round(height * 0.05);
  const subSize = Math.round(height * 0.025);
  const lineY = Math.round(height * 0.48);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#111827"/>
  <line x1="${Math.round(width * 0.1)}" y1="${lineY}" x2="${Math.round(width * 0.9)}" y2="${lineY}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
  <text x="${width / 2}" y="${Math.round(height * 0.46)}" font-family="sans-serif" font-size="${subSize}" fill="rgba(255,255,255,0.4)" text-anchor="middle" letter-spacing="4">STORY BEGINS</text>
  <text x="${width / 2}" y="${Math.round(height * 0.54)}" font-family="sans-serif" font-size="${fontSize}" fill="#ffffff" text-anchor="middle">${escapeXml(title)}</text>
</svg>`;

  const buffer = await svgToJpeg(svg, null);
  return { buffer, width, height };
}

// ── Spread scene page (spread_left / spread_right) ────────────────────────────
// Crops the scene half from a 2:1 spread image. sceneDir = which half is the scene.

export async function renderSpreadScenePage(
  spreadUrl: string,
  sceneDir: "left" | "right",
  width = PAGE_SIZE_PX,
  height = PAGE_SIZE_PX,
): Promise<RenderedPage> {
  const buf = await fetchBuffer(spreadUrl);
  const meta = await sharp(buf).metadata();
  const fullW = meta.width ?? 5100;
  const fullH = meta.height ?? 2550;
  const halfW = Math.floor(fullW / 2);

  const jpeg = await sharp(buf)
    .extract({ left: sceneDir === "left" ? 0 : halfW, top: 0, width: halfW, height: fullH })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer: jpeg, width, height };
}

// ── Spread text page (spread_left / spread_right) ─────────────────────────────
// Crops the bleed half, applies a scrim gradient for text legibility, then overlays text.

export async function renderSpreadTextPage(
  spreadUrl: string,
  text: string,
  textStyle: TextStyle,
  sceneDir: "left" | "right",
  width = PAGE_SIZE_PX,
  height = PAGE_SIZE_PX,
  verticalAlign: "top" | "center" | "bottom" = "bottom",
): Promise<RenderedPage> {
  const buf = await fetchBuffer(spreadUrl);
  const meta = await sharp(buf).metadata();
  const fullW = meta.width ?? 5100;
  const fullH = meta.height ?? 2550;
  const halfW = Math.floor(fullW / 2);

  // Crop the text half (opposite of scene)
  const bleedBuf = await sharp(buf)
    .extract({ left: sceneDir === "left" ? halfW : 0, top: 0, width: halfW, height: fullH })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .blur(0.4)
    .toBuffer();

  // Build scrim: gradient that fades from transparent (scene-adjacent edge) to white-ish (outer edge)
  // For spread_left: text half is on right → scrim fades left→right (transparent at left, white at right)
  // For spread_right: text half is on left → scrim fades right→left (transparent at right, white at left)

  // No full-page scrim — text legibility handled by frosted pill behind text block

  // Now overlay text
  const fontPath = await resolveFontPath(textStyle.fontFamily);
  const fontSize = Math.round(height * (textStyle.fontSizePct / 100));
  const lineHeight = Math.round(fontSize * 1.55);
  const paddingX = Math.round(width * 0.1);
  const availableWidth = width - paddingX * 2;
  const charsPerLine = Math.floor(availableWidth / (fontSize * 0.58));
  const lines = wrapWords(text, charsPerLine);
  const totalH = lines.length * lineHeight;
  // Block anchored per verticalAlign, mirroring buildSvgOverlay's panelTop
  // pattern -- this function previously always centered regardless of the
  // page's own vertical_align setting, so the admin's top/center/bottom
  // choice never had any effect on the actual printed PDF for spread layouts.
  const vMargin = Math.round(height * 0.06);
  const blockTop = verticalAlign === "top" ? vMargin
    : verticalAlign === "center" ? Math.round((height - totalH) / 2)
    : height - vMargin - totalH;
  const startY = blockTop + fontSize;
  const textAnchor = textStyle.alignment === "left" ? "start" : textStyle.alignment === "right" ? "end" : "middle";
  const textX = textStyle.alignment === "left" ? paddingX : textStyle.alignment === "right" ? width - paddingX : width / 2;

  // Frosted pill background behind the text block
  const pillPadX = Math.round(width * 0.04);
  const pillPadY = Math.round(height * 0.03);
  const pillX = textStyle.alignment === "left" ? paddingX - pillPadX
    : textStyle.alignment === "right" ? width - paddingX - Math.round(availableWidth * 0.9) - pillPadX
    : Math.round(width / 2 - availableWidth / 2) - pillPadX;
  const pillW = availableWidth + pillPadX * 2;
  const pillH = totalH + pillPadY * 2;
  const pillY = blockTop - pillPadY;
  const pillR = Math.round(width * 0.025);

  const showPill = textStyle.textBoxBg !== "none";
  const textSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${showPill ? `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillR}" ry="${pillR}" fill="rgba(255,255,255,0.55)"/>` : ""}
  ${svgText(lines, textX, startY, lineHeight, textStyle.fontFamily, fontSize, textStyle.color, textAnchor, textStyle.italic)}
</svg>`;

  const textPng = await svgToPng(textSvg, fontPath);

  const buffer = await sharp(bleedBuf)
    .composite([{ input: textPng, blend: "over" }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return { buffer, width, height };
}

export { resolveFontPath };
