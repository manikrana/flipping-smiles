import { PDFDocument, PDFDict, PDFName, PDFString, PDFArray } from "pdf-lib";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  renderCoverSpread,
  renderEndpaperPage,
  renderImageOrBlankPage,
  renderTitlePage,
  renderDedicationPage,
  renderOverlayPage,
  renderImagePage,
  renderReviewImagePage,
  renderReviewDividerPage,
  renderTextSplitPage,
  renderSpreadScenePage,
  renderSpreadTextPage,
} from "@/lib/layout";
import type { BackCoverContent } from "@/lib/layout";
import { getCoverDimensions } from "@/lib/gelato";
import type { CoverLayout, TextStyle, TextPanelBg } from "@/lib/supabase/types";
import { DEFAULT_COVER_LAYOUT, DEFAULT_TEXT_STYLE, DEFAULT_TEXT_PANEL_BG } from "@/lib/supabase/types";
import { PRINT_DPI, PAGE_SIZE_PX } from "@/lib/layout";

export type BookPage =
  | { kind: "cover";          url: string; title: string; coverLayout: CoverLayout; backCover: BackCoverContent }
  | { kind: "endpaper" }
  | { kind: "brand";          imageUrl: string | null }
  | { kind: "title";          title: string; coverLayout: CoverLayout }
  | { kind: "dedication";     text: string; coverLayout: CoverLayout }
  | { kind: "overlay";        url: string }
  | { kind: "image";          url: string }
  | { kind: "text-split";     text: string; textStyle: TextStyle; textPanelBg: TextPanelBg; textBgUrl?: string | null; verticalAlign: "top" | "center" | "bottom" }
  | { kind: "spread-scene";   url: string; sceneDir: "left" | "right" }
  | { kind: "spread-text";    url: string; text: string; textStyle: TextStyle; sceneDir: "left" | "right"; verticalAlign: "top" | "center" | "bottom" }
  | { kind: "end";            imageUrl: string | null }
  | { kind: "review-image";   url: string; label: string }
  | { kind: "review-divider"; title: string };

export type BookSpec = {
  pages: BookPage[];
};

// Gelato's own extracted GRACoL2006 Coated1v2 CMYK profile -- byte-identical
// to the one embedded in their own downloaded print template for our exact
// productUid, so it matches what their RIP already expects.
//
// __dirname resolves inside .next/server at runtime. The production
// standalone build gets the profile copied next to it there by
// outputFileTracingIncludes (see next.config.ts) -- but `next dev` never
// runs that copy step, so fall back to reading straight from the source
// tree (process.cwd() is the app root in both `next dev` and `next start`).
const ICC_PROFILE_PATHS = [
  join(__dirname, "color-profiles", "GRACoL2006_Coated1v2.icc"),
  join(process.cwd(), "src", "lib", "color-profiles", "GRACoL2006_Coated1v2.icc"),
];
let cachedIccProfile: Buffer | null = null;
function getGracolIccProfile(): Buffer {
  if (cachedIccProfile) return cachedIccProfile;
  const path = ICC_PROFILE_PATHS.find(existsSync);
  if (!path) throw new Error(`GRACoL2006 ICC profile not found at any of: ${ICC_PROFILE_PATHS.join(", ")}`);
  cachedIccProfile = readFileSync(path);
  return cachedIccProfile;
}

// Marks the document PDF/X-4 compliant with a GRACoL2006 output intent --
// confirmed as a real per-file requirement (not just marketing copy) by
// inspecting Gelato's own template's raw PDF structure. Document-level
// (Catalog + Info), so this covers every page in the book automatically.
// Page content itself stays sRGB -- this only tells the RIP what CMYK space
// to convert into at print time, it doesn't require our JPEGs to be CMYK.
function addPdfXCompliance(doc: PDFDocument) {
  const context = doc.context;

  const iccStream = context.flateStream(getGracolIccProfile(), { N: 4, Range: [0, 1, 0, 1, 0, 1, 0, 1] });
  const iccRef = context.register(iccStream);

  const outputIntent = PDFDict.withContext(context);
  outputIntent.set(PDFName.of("Type"), PDFName.of("OutputIntent"));
  outputIntent.set(PDFName.of("S"), PDFName.of("GTS_PDFX"));
  outputIntent.set(PDFName.of("OutputConditionIdentifier"), PDFString.of("GRACoL2006_Coated1v2.icc"));
  outputIntent.set(PDFName.of("Info"), PDFString.of("GRACoL2006_Coated1v2.icc"));
  outputIntent.set(PDFName.of("DestOutputProfile"), iccRef);
  const outputIntentRef = context.register(outputIntent);

  const outputIntents = PDFArray.withContext(context);
  outputIntents.push(outputIntentRef);
  doc.catalog.set(PDFName.of("OutputIntents"), outputIntents);

  context.lookup(context.trailerInfo.Info, PDFDict).set(PDFName.of("GTS_PDFXVersion"), PDFString.of("PDF/X-4"));
}

export async function generatePdf(spec: BookSpec): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setCreator("Flipping Smiles");
  doc.setProducer("Flipping Smiles Studio");
  addPdfXCompliance(doc);

  // Map px → PDF points at PRINT_DPI
  const toPt = (px: number) => (px / PRINT_DPI) * 72;

  async function embedPage(rendered: { buffer: Buffer; width: number; height: number }) {
    const page = doc.addPage([toPt(rendered.width), toPt(rendered.height)]);
    const img = await doc.embedJpg(rendered.buffer);
    page.drawImage(img, { x: 0, y: 0, width: toPt(rendered.width), height: toPt(rendered.height) });
    return rendered;
  }

  // Gelato's cover geometry (spine width especially) depends on the real inner
  // page count and is never a formula -- resolved once, live, up front.
  const innerPageCount = spec.pages.filter((p) => p.kind !== "cover" && p.kind !== "endpaper").length;
  const coverPage = spec.pages.find((p): p is Extract<BookPage, { kind: "cover" }> => p.kind === "cover");
  const coverDims = coverPage ? await getCoverDimensions(innerPageCount) : null;

  for (const p of spec.pages) {
    if (p.kind === "cover") {
      await embedPage(await renderCoverSpread(p.url, p.title, p.coverLayout, p.backCover, coverDims!));

    } else if (p.kind === "endpaper") {
      await embedPage(await renderEndpaperPage(PAGE_SIZE_PX, PAGE_SIZE_PX));

    } else if (p.kind === "brand") {
      await embedPage(await renderImageOrBlankPage(PAGE_SIZE_PX, PAGE_SIZE_PX, p.imageUrl));

    } else if (p.kind === "title") {
      await embedPage(await renderTitlePage(p.title, p.coverLayout, PAGE_SIZE_PX, PAGE_SIZE_PX));

    } else if (p.kind === "dedication") {
      await embedPage(await renderDedicationPage(p.text, p.coverLayout, PAGE_SIZE_PX, PAGE_SIZE_PX));

    } else if (p.kind === "overlay") {
      await embedPage(await renderOverlayPage(p.url));

    } else if (p.kind === "image") {
      await embedPage(await renderImagePage(p.url, PAGE_SIZE_PX, PAGE_SIZE_PX));

    } else if (p.kind === "text-split") {
      await embedPage(await renderTextSplitPage(p.text, p.textStyle, p.textPanelBg, PAGE_SIZE_PX, PAGE_SIZE_PX, p.textBgUrl, p.verticalAlign));

    } else if (p.kind === "end") {
      await embedPage(await renderImageOrBlankPage(PAGE_SIZE_PX, PAGE_SIZE_PX, p.imageUrl));

    } else if (p.kind === "spread-scene") {
      await embedPage(await renderSpreadScenePage(p.url, p.sceneDir, PAGE_SIZE_PX, PAGE_SIZE_PX));

    } else if (p.kind === "spread-text") {
      await embedPage(await renderSpreadTextPage(p.url, p.text, p.textStyle, p.sceneDir, PAGE_SIZE_PX, PAGE_SIZE_PX, p.verticalAlign));

    } else if (p.kind === "review-image") {
      await embedPage(await renderReviewImagePage(p.url, p.label));

    } else if (p.kind === "review-divider") {
      await embedPage(await renderReviewDividerPage(p.title, PAGE_SIZE_PX, PAGE_SIZE_PX));
    }
  }

  return Buffer.from(await doc.save());
}

// ── Build ordered page list ────────────────────────────────────────────────────

export type StoryPageData = {
  imageUrl: string | null;
  textImageUrl: string | null;
  textBgUrl?: string | null;
  text: string;
  heroName: string;
  verticalAlign: "top" | "center" | "bottom";
};

export type BookData = {
  layoutType: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
  coverLayout: CoverLayout | null;
  textStyle: TextStyle | null;
  textPanelBg: TextPanelBg | null;
  coverImageUrl: string | null;
  backCover: BackCoverContent;
  title: string;
  dedicationText: string | null;
  endPageImageUrl: string | null;
  brandPageImageUrl: string | null;
  heroName: string;
  gender: "boy" | "girl";
  pages: StoryPageData[];
};

// Full placeholder personalization -- mirrors orders/generate/actions.ts's
// personalizeText exactly (duplicated rather than imported: that file has
// "use server", which requires every export to be an async function, so a
// plain sync helper can't be re-exported from it). buildPageList previously
// only replaced {{hero_name}} directly inline at each call site, missing
// {{hero_he}}/{{hero_him}}/{{hero_his}}/{{hero_himself}} entirely -- for any
// spread/split-layout story (where story-page text is rendered fresh here at
// PDF-assembly time, not reused from order_pages' already-personalized
// text_image_url), any pronoun placeholder in the story text rendered
// completely literally in the printed PDF, e.g. "Anika rolled {{hero_his}}
// eyes." This is the single source of truth for personalizing text inside
// buildPageList now -- every {{hero_name}}-only .replace() call here was a
// site of this same bug and has been switched to it.
function personalizeText(text: string, heroName: string, gender: "boy" | "girl"): string {
  const he = gender === "girl" ? "she" : "he";
  const him = gender === "girl" ? "her" : "him";
  const his = gender === "girl" ? "her" : "his";
  const himself = gender === "girl" ? "herself" : "himself";
  return text
    .replace(/{{hero_name}}/g, heroName)
    .replace(/{{hero_he}}/g, he)
    .replace(/{{hero_him}}/g, him)
    .replace(/{{hero_his}}/g, his)
    .replace(/{{hero_himself}}/g, himself);
}

// Inner page count is fully determined by the story's own configuration
// (layout, page count, whether an end page image is set) -- never by
// order-specific data. So it can be estimated at the story level, before any
// order exists, for e.g. sizing the cover's spine at generation time.
// Mirrors buildPageList's per-kind page counts exactly.
export function estimateInnerPageCount(params: {
  layoutType: BookData["layoutType"];
  storyPageCount: number;
  hasEndPage: boolean;
}): number {
  const isSplitOrSpread = params.layoutType !== "overlay_bottom";
  const perStoryPage = isSplitOrSpread ? 2 : 1;
  return 1 // brand page
    + 1 // dedication -- always present now, blank if unset
    + 1 // title
    + params.storyPageCount * perStoryPage
    + (params.hasEndPage ? 1 : 0);
}

export function buildPageList(data: BookData): BookPage[] {
  const pages: BookPage[] = [];
  const coverLayout = data.coverLayout ?? DEFAULT_COVER_LAYOUT;
  const textStyle = data.textStyle ?? DEFAULT_TEXT_STYLE;
  const textPanelBg = data.textPanelBg ?? DEFAULT_TEXT_PANEL_BG;
  const isSplit = data.layoutType === "split_image_left" || data.layoutType === "split_image_right";
  const isSpread = data.layoutType === "spread_left" || data.layoutType === "spread_right" || data.layoutType === "spread_left_clean" || data.layoutType === "spread_right_clean";
  const sceneDir: "left" | "right" = (data.layoutType === "spread_left" || data.layoutType === "spread_left_clean") ? "left" : "right";
  const imageRight = data.layoutType === "split_image_right";

  // 1. Cover (+ the blank endpaper leaf right behind it). Subtitle is
  // composited as real text at render time (renderCoverSpread), not baked
  // into the art, so the {{hero_name}} placeholder is resolved here same as
  // every other text field on this page.
  if (data.coverImageUrl) {
    const coverLayoutForOrder = { ...coverLayout, subtitle: personalizeText(coverLayout.subtitle, data.heroName, data.gender) };
    pages.push({ kind: "cover", url: data.coverImageUrl, title: data.title, coverLayout: coverLayoutForOrder, backCover: data.backCover });
    pages.push({ kind: "endpaper" });
  }

  // 2. Brand page -- right-hand page of the first interior spread. Its
  // left-hand facing page is the front endpaper above, which must stay blank;
  // this one is available for content (e.g. Flipping Smiles branding/line
  // art), currently plain white until an image is generated for it.
  pages.push({ kind: "brand", imageUrl: data.brandPageImageUrl });

  // 3. Dedication -- left-hand page of the second interior spread. Always
  // present (a fixed page, blank if unset) so the following title page keeps
  // a stable position, rather than shifting depending on whether dedication
  // text happens to be set.
  {
    const text = personalizeText(data.dedicationText ?? "", data.heroName, data.gender);
    pages.push({ kind: "dedication", text, coverLayout });
  }

  // 4. Title page -- right-hand page of the second interior spread
  pages.push({ kind: "title", title: data.title, coverLayout });

  // 5. Story pages
  for (const p of data.pages) {
    const text = personalizeText(p.text, p.heroName, data.gender);
    if (isSpread) {
      // spread_left: scene page then text page; spread_right: text page then scene page
      if (p.imageUrl) {
        const scenePage: BookPage = { kind: "spread-scene", url: p.imageUrl, sceneDir };
        const textPage:  BookPage = { kind: "spread-text",  url: p.imageUrl, text, textStyle, sceneDir, verticalAlign: p.verticalAlign };
        if (data.layoutType === "spread_left" || data.layoutType === "spread_left_clean") {
          pages.push(scenePage, textPage);
        } else {
          pages.push(textPage, scenePage);
        }
      }
    } else if (isSplit) {
      if (p.imageUrl) pages.push({ kind: "image", url: p.imageUrl });
      pages.push({ kind: "text-split", text, textStyle, textPanelBg, textBgUrl: p.textBgUrl, verticalAlign: p.verticalAlign });
    } else {
      const url = p.textImageUrl ?? p.imageUrl;
      if (url) pages.push({ kind: "overlay", url });
    }
  }

  // 6. End page -- left-hand page of the last interior spread, only if an
  // image is set. Its facing page (right-hand) is the closing blank endpaper
  // below. Prompt-generated art only, same as the brand page -- no text
  // overlay.
  if (data.endPageImageUrl) {
    pages.push({ kind: "end", imageUrl: data.endPageImageUrl });
  }

  // 7. Closing blank endpaper leaf, only if there was a cover to pair it with
  if (data.coverImageUrl) {
    pages.push({ kind: "endpaper" });
  }

  return pages;
}

export { DEFAULT_COVER_LAYOUT };
