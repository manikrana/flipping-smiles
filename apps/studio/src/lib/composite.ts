import sharp from "sharp";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getGoogleFontName } from "@/lib/fonts";
import type { TextStyle } from "@/lib/supabase/types";

const FONT_DIR = "/tmp/kitabee-fonts";

// Cache font file paths — avoids re-downloading on every render
const fontPathCache = new Map<string, string>();

// Downloads a Google Font TTF to disk and returns the file path.
// resvg-js fontFiles (disk path) works; fontBuffers does not apply the font visually.
async function fetchFontPath(googleFontName: string): Promise<string | null> {
  if (fontPathCache.has(googleFontName)) return fontPathCache.get(googleFontName)!;
  try {
    // googleFontName is one of FONT_OPTIONS' hardcoded values (e.g.
    // "Amatic+SC:wght@700"), already in the literal syntax Google's CSS2 API
    // requires -- its own '+' (space), ':' and '@' (weight axis) are NOT
    // URL-escaping conventions here, they're the query format itself.
    // encodeURIComponent()'ing the whole string turns them into %2B/%3A/%40,
    // which Google's endpoint can't parse -- it silently returns a bot-check
    // HTML page instead of CSS, the regex below finds no match, and every
    // multi-word font (Amatic SC, Baloo 2, Playfair Display, EB Garamond)
    // falls back to a system font. Confirmed live: encoded request returns
    // Google's challenge page; the raw string below returns real @font-face CSS.
    const cssRes = await fetch(
      `https://fonts.googleapis.com/css2?family=${googleFontName}&display=swap`,
      { headers: { "User-Agent": "Mozilla/4.0 (compatible)" } }
    );
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    const fontBuf = Buffer.from(await fontRes.arrayBuffer());
    if (!existsSync(FONT_DIR)) mkdirSync(FONT_DIR, { recursive: true });
    const fontPath = join(FONT_DIR, `${googleFontName.replace(/\s+/g, "-")}.ttf`);
    writeFileSync(fontPath, fontBuf);
    fontPathCache.set(googleFontName, fontPath);
    return fontPath;
  } catch {
    return null;
  }
}

// Keep fetchFontBase64 for the SVG overlay compositing path (Sharp/librsvg — system fonts only)
const fontBase64Cache = new Map<string, string>();

export async function fetchFontBase64(googleFontName: string): Promise<string | null> {
  if (fontBase64Cache.has(googleFontName)) return fontBase64Cache.get(googleFontName)!;
  try {
    // See fetchFontPath's comment -- googleFontName must not be encoded here either.
    const cssRes = await fetch(
      `https://fonts.googleapis.com/css2?family=${googleFontName}&display=swap`,
      { headers: { "User-Agent": "Mozilla/4.0 (compatible)" } }
    );
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    const base64 = Buffer.from(await fontRes.arrayBuffer()).toString("base64");
    fontBase64Cache.set(googleFontName, base64);
    return base64;
  } catch {
    return null;
  }
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

function wrapLines(text: string, charsPerLine: number): string[] {
  // Respect explicit newlines — each \n starts a new line, \n\n adds a blank line between paragraphs
  const paragraphs = text.split(/\n/);
  const result: string[] = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      // Blank line between paragraphs — add an empty line as spacer
      result.push("");
    } else {
      result.push(...wrapParagraph(trimmed, charsPerLine));
    }
  }
  return result;
}

// resvg-js's text shaper applies broken "fi"/"fl" ligature substitution for
// at least Fredoka's TTF (confirmed by direct testing: "flower" renders as
// "fbwer", "magnificent" as "magnifcent" -- both silently mangled on real
// order PDFs). font-feature-settings/font-variant-ligatures on the <text>
// element have NO effect in resvg (tested both as a presentation attribute
// and via style=, identical broken output either way) -- usvg doesn't wire
// them through to its shaper. A zero-width non-joiner between "f" and the
// following "i"/"l" blocks ligature formation at the Unicode level instead,
// which the shaper does respect, and is invisible/harmless for any font
// that doesn't have this bug (fonts without an fi/fl ligature glyph render
// identically with or without it).
export function neutralizeBrokenLigatures(text: string): string {
  return text.replace(/f(?=[il])/gi, (f) => f + "‌");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function buildSvgOverlay(
  width: number,
  height: number,
  text: string,
  style: TextStyle,
  verticalAlign: "top" | "center" | "bottom" = "bottom",
): string {
  const panelHeight = Math.round(height * 0.25);
  const paddingX = Math.round(width * 0.03);
  const paddingY = Math.round(panelHeight * 0.06);
  const availableWidth = width - paddingX * 2;

  const vAlign = verticalAlign;
  const margin = Math.round(height * 0.04);
  const panelTop = vAlign === "top"
    ? margin
    : vAlign === "center"
    ? Math.round((height - panelHeight) / 2)
    : height - panelHeight - margin;

  const fontSize = Math.round(panelHeight * (style.fontSizePct / 100));
  const lineHeight = Math.round(fontSize * 1.55);
  const charWidth = style.fontFamily.includes("serif") ? 0.50 : 0.58;
  const charsPerLine = Math.floor(availableWidth / (fontSize * charWidth));
  const lines = wrapLines(text, charsPerLine);

  const totalTextHeight = lines.length * lineHeight;
  const startY = panelTop + paddingY + Math.max(0, (panelHeight - paddingY * 2 - totalTextHeight) / 2) + fontSize;

  const textAnchor = style.alignment === "left" ? "start" : style.alignment === "right" ? "end" : "middle";
  const textX = style.alignment === "left" ? paddingX : style.alignment === "right" ? width - paddingX : width / 2;

  const { r, g, b } = hexToRgb(style.bgColor);
  const bgRgba = `rgba(${r},${g},${b},${style.bgOpacity})`;

  const textEls = lines
    .map((line, i) =>
      `<text x="${textX}" y="${Math.round(startY + i * lineHeight)}" ` +
      `font-family="${escapeXml(style.fontFamily)}" font-size="${fontSize}" ` +
      `fill="${style.color}" text-anchor="${textAnchor}">${escapeXml(neutralizeBrokenLigatures(line))}</text>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="${panelTop}" width="${width}" height="${panelHeight}" fill="${bgRgba}" />
  ${textEls}
</svg>`;
}

export async function compositeTextOntoImage(
  imageUrl: string,
  text: string,
  style: TextStyle,
  fontPath: string | null,
  verticalAlign: "top" | "center" | "bottom" = "bottom",
): Promise<Buffer> {
  console.log(`[composite] fontFamily="${style.fontFamily}" fontPath=${fontPath} text="${text.slice(0, 40)}"`);
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
  const imageBuffer = Buffer.from(await res.arrayBuffer());
  const { width = 1344, height = 1008 } = await sharp(imageBuffer).metadata();
  const svg = buildSvgOverlay(width, height, text, style, verticalAlign);
  console.log(`[composite] svg snippet: ${svg.slice(0, 200)}`);

  // Use resvg-js with fontFiles — Sharp's librsvg ignores @font-face data URIs
  const { Resvg } = await import("@resvg/resvg-js");
  const opts = fontPath
    ? { font: { loadSystemFonts: false, fontFiles: [fontPath] } }
    : { font: { loadSystemFonts: true } };
  const overlay = new Resvg(svg, opts).render();
  console.log(`[composite] overlay rendered ${overlay.width}x${overlay.height}`);
  const overlayPng = Buffer.from(overlay.asPng());

  const result = await sharp(imageBuffer)
    .composite([{ input: overlayPng, blend: "over" }])
    .webp({ quality: 90 })
    .toBuffer();

  // Save debug copy to disk
  const { writeFileSync } = await import("fs");
  writeFileSync(`/tmp/composite-debug-${Date.now()}.webp`, result);
  console.log(`[composite] saved debug image, result size=${result.length}`);

  return result;
}

export async function resolveFontBase64(fontFamily: string): Promise<string | null> {
  const googleFontName = getGoogleFontName(fontFamily);
  return googleFontName ? fetchFontBase64(googleFontName) : null;
}

export async function resolveFontPath(fontFamily: string): Promise<string | null> {
  const googleFontName = getGoogleFontName(fontFamily);
  console.log(`[composite] resolveFontPath("${fontFamily}") → googleFontName=${googleFontName}`);
  const path = googleFontName ? await fetchFontPath(googleFontName) : null;
  console.log(`[composite] fontPath=${path}`);
  return path;
}
