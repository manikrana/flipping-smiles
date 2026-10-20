"use client";

import { useState, useEffect, useCallback } from "react";
import { panelBgStyle } from "@/lib/textPanelBg";
import { computeCoverZones } from "@/lib/coverZones";
import { getCoverPreviewData, type CoverPreviewData } from "./book/actions";
import { BackCoverOverlay } from "./BackCoverOverlay";
import { FrontCoverOverlay } from "./FrontCoverOverlay";
import { DEFAULT_COVER_LAYOUT, type StoryRow, type StoryPageRow, type TextStyle, type TextPanelBg } from "@/lib/supabase/types";

const FALLBACK_SPREAD_ASPECT = "2 / 1"; // used until the live Gelato cover geometry loads

// Full placeholder personalization for this preview -- "Hero" is the
// existing stand-in name convention used elsewhere in this file (no real
// order/customer exists yet at story-editing time), but the story-text/
// story-overlay/story-spread-text cases previously did zero substitution at
// all, showing raw {{hero_name}}/{{hero_his}} etc. verbatim. That defeated
// the whole point of this panel's Boy/Girl toggle for any page whose text
// uses a pronoun placeholder -- toggling gender should visibly change
// "his"/"her" here, matching what the real order-time personalization
// (orders/generate/actions.ts's personalizeText) does for a real order.
// Maps a page's vertical_align to the flex-row cross-axis property that
// actually controls vertical position (alignItems, not justifyContent) --
// mirrors renderSpreadTextPage/renderTextSplitPage's blockTop logic so the
// preview matches what the real PDF now does for each setting.
function alignItemsFor(v: "top" | "center" | "bottom" | null | undefined): "flex-start" | "center" | "flex-end" {
  return v === "top" ? "flex-start" : v === "bottom" ? "flex-end" : "center";
}

function personalizeForPreview(text: string, gender: "boy" | "girl"): string {
  const he = gender === "girl" ? "she" : "he";
  const him = gender === "girl" ? "her" : "him";
  const his = gender === "girl" ? "her" : "his";
  const himself = gender === "girl" ? "herself" : "himself";
  return text
    .replace(/{{hero_name}}/g, "Hero")
    .replace(/{{hero_he}}/g, he)
    .replace(/{{hero_him}}/g, him)
    .replace(/{{hero_his}}/g, his)
    .replace(/{{hero_himself}}/g, himself);
}

interface Props {
  story: StoryRow;
  pages: StoryPageRow[];
  textStyle: TextStyle;
  panelBg: TextPanelBg;
  layoutType: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PreviewPage =
  | { kind: "front-cover" }
  | { kind: "front-endpaper" }
  | { kind: "brand" }
  | { kind: "title" }
  | { kind: "dedication" }
  | { kind: "story-image"; page: StoryPageRow }
  | { kind: "story-text"; page: StoryPageRow }
  | { kind: "story-overlay"; page: StoryPageRow }
  | { kind: "story-spread-scene"; page: StoryPageRow; sceneDir: "left" | "right" }
  | { kind: "story-spread-text"; page: StoryPageRow; sceneDir: "left" | "right" }
  | { kind: "end" }
  | { kind: "back-endpaper" }
  | { kind: "back-cover" }
  | { kind: "blank" };

type Spread = { left: PreviewPage; right: PreviewPage };

// ── Build reading order ───────────────────────────────────────────────────────

function buildSpreads(story: StoryRow, pages: StoryPageRow[], layoutType: Props["layoutType"]): Spread[] {
  const spreads: Spread[] = [];

  // Exterior — back cover left, front cover right (closed book)
  spreads.push({ left: { kind: "back-cover" }, right: { kind: "front-cover" } });

  // Interior flat list — mirrors buildPageList() in lib/pdf.ts exactly, including
  // which pages are conditionally included, so a page that won't actually print
  // doesn't show up here as a phantom spread either. First interior spread is
  // [front endpaper (blank), brand page]; second is [dedication (blank if
  // unset — a fixed page so title's position is stable), title].
  const interior: PreviewPage[] = [
    { kind: "front-endpaper" },
    { kind: "brand" },
    { kind: "dedication" },
    { kind: "title" },
  ];

  if (layoutType === "split_image_left") {
    for (const p of pages) {
      interior.push({ kind: "story-image", page: p });
      interior.push({ kind: "story-text", page: p });
    }
  } else if (layoutType === "split_image_right") {
    for (const p of pages) {
      interior.push({ kind: "story-text", page: p });
      interior.push({ kind: "story-image", page: p });
    }
  } else if (layoutType === "spread_left" || layoutType === "spread_left_clean") {
    for (const p of pages) {
      interior.push({ kind: "story-spread-scene", page: p, sceneDir: "left" });
      interior.push({ kind: "story-spread-text",  page: p, sceneDir: "left" });
    }
  } else if (layoutType === "spread_right" || layoutType === "spread_right_clean") {
    for (const p of pages) {
      interior.push({ kind: "story-spread-text",  page: p, sceneDir: "right" });
      interior.push({ kind: "story-spread-scene", page: p, sceneDir: "right" });
    }
  } else {
    for (const p of pages) {
      interior.push({ kind: "story-overlay", page: p });
    }
  }

  if (story.end_page_image_url) {
    interior.push({ kind: "end" });
  }

  interior.push({ kind: "back-endpaper" });

  for (let i = 0; i < interior.length; i += 2) {
    spreads.push({
      left: interior[i],
      right: interior[i + 1] ?? { kind: "blank" },
    });
  }


  return spreads;
}

// ── Page renderer ─────────────────────────────────────────────────────────────

function PageRenderer({
  pg, story, textStyle, panelBg, gender, coverPreviewData,
}: {
  pg: PreviewPage;
  story: StoryRow;
  textStyle: TextStyle;
  panelBg: TextPanelBg;
  gender: "boy" | "girl";
  coverPreviewData: CoverPreviewData | null;
}) {
  // Title/dedication page text always renders with these fixed styles in
  // the real PDF (renderTitlePage/renderDedicationPage in lib/layout.ts) --
  // story.title_page_text_style / dedication_text_style are stored but never
  // read by the print pipeline, so this preview intentionally ignores them
  // too rather than showing a look that won't print.
  const printFontFamily = story.cover_layout?.fontFamily ?? "Dancing Script, cursive";

  if (pg.kind === "blank") {
    return <div className="w-full h-full bg-gray-100" />;
  }

  if (pg.kind === "front-cover") {
    const url = gender === "girl" ? (story.cover_image_url_girl ?? story.cover_image_url) : story.cover_image_url;
    if (!url) {
      return (
        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
          <p className="text-gray-500 text-sm">No cover image</p>
        </div>
      );
    }
    // The AI art is a pure scene (no text) -- title/subtitle/company name are
    // composited here to mirror what renderCoverSpread bakes in at print time.
    const layout = { ...DEFAULT_COVER_LAYOUT, ...(story.cover_layout ?? {}) };
    return (
      <div className="w-full h-full relative overflow-hidden" style={{ containerType: "size" }}>
        <img src={url} alt="Cover" className="w-full h-full object-cover" style={{ objectPosition: "right center" }} />
        <FrontCoverOverlay
          title={story.title}
          subtitle={personalizeForPreview(layout.subtitle, gender)}
          companyName={coverPreviewData?.backCover.companyName ?? null}
          titlePosition={layout.titlePosition}
          titleColor={layout.titleColor}
          subtitleColor={layout.subtitleColor}
          titleSize={layout.titleSize}
          subtitleSize={layout.subtitleSize}
          overlayOpacity={layout.overlayOpacity}
          fontFamily={layout.fontFamily}
        />
      </div>
    );
  }

  if (pg.kind === "front-endpaper" || pg.kind === "back-endpaper") {
    // renderEndpaperPage() in lib/layout.ts takes no color/text parameters at all --
    // it always fills flat #f5f0e8. Gelato's own guidance warns some production
    // partners glue this leaf directly to the cover board, so printed content here
    // risks being unpredictably hidden. front_endpaper_bg/back_endpaper_bg and
    // front_endpaper_text/back_endpaper_text are stored but never read at print time.
    return <div className="w-full h-full" style={{ backgroundColor: "#f5f0e8" }} />;
  }

  if (pg.kind === "brand") {
    // Right-hand page of the first interior spread. Shows the generated
    // image (e.g. Flipping Smiles branding/line art) if one exists;
    // renderImageOrBlankPage() in lib/layout.ts falls back to plain white otherwise.
    return story.brand_page_image_url
      ? <img src={story.brand_page_image_url} alt="Brand page" className="w-full h-full object-cover" />
      : <div className="w-full h-full bg-white" />;
  }

  if (pg.kind === "title") {
    return (
      <div className="w-full h-full bg-white flex items-center justify-center px-8 text-center" style={{ containerType: "size" }}>
        <p style={{ fontFamily: printFontFamily, fontSize: "7cqh", color: "#1c1c1e", lineHeight: 1.3, textAlign: "center" }}>
          {story.title}
        </p>
      </div>
    );
  }

  if (pg.kind === "dedication") {
    return (
      <div className="w-full h-full flex items-center justify-center px-8 text-center" style={{ containerType: "size", backgroundColor: "#fffbeb" }}>
        <p
          className="whitespace-pre-wrap leading-relaxed italic"
          style={{ fontFamily: printFontFamily, fontSize: "2.8cqh", color: "#4b5563", textAlign: "center" }}
        >
          {personalizeForPreview(story.dedication_text ?? "", gender)}
        </p>
      </div>
    );
  }

  if (pg.kind === "story-image") {
    const url = gender === "girl" ? (pg.page.image_url_girl ?? pg.page.image_url) : pg.page.image_url;
    return url
      ? <img src={url} alt={`Page ${pg.page.page_number}`} className="w-full h-full object-cover" />
      : <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300 text-sm">No image</div>;
  }

  if (pg.kind === "story-spread-scene") {
    const spreadUrl = gender === "girl" ? (pg.page.image_url_girl ?? pg.page.image_url) : pg.page.image_url;
    if (!spreadUrl) return <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300 text-sm">No spread</div>;
    // Show the scene half by rendering the full 2:1 image with object-position to crop the correct half
    const objPos = pg.sceneDir === "left" ? "left center" : "right center";
    return <img src={spreadUrl} alt={`Page ${pg.page.page_number} scene`} className="w-full h-full object-cover" style={{ objectPosition: objPos }} />;
  }

  if (pg.kind === "story-spread-text") {
    const spreadUrl = gender === "girl" ? (pg.page.image_url_girl ?? pg.page.image_url) : pg.page.image_url;
    if (!spreadUrl) return <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300 text-sm">No spread</div>;
    const objPos = pg.sceneDir === "left" ? "right center" : "left center";
    const showPill = textStyle.textBoxBg !== "none";
    return (
      <div className="w-full h-full relative" style={{ containerType: "size" }}>
        <img src={spreadUrl} alt={`Page ${pg.page.page_number} text`} className="w-full h-full object-cover" style={{ objectPosition: objPos }} />
        {/* paddingInline matches renderSpreadTextPage's real paddingX (10% of
            width) exactly -- a fixed Tailwind px-8 here made the preview's
            margins look nothing like the actual print output, which scales
            proportionally with the page's real ~2433px resolution. */}
        <div className="absolute inset-0 flex justify-center text-center" style={{ paddingInline: "10cqw", alignItems: alignItemsFor(pg.page.vertical_align) }}>
          <p
            className="whitespace-pre-wrap leading-relaxed rounded-2xl px-5 py-4"
            style={{
              fontFamily: textStyle.fontFamily,
              fontSize: `${textStyle.fontSizePct}cqh`,
              color: textStyle.color,
              fontStyle: textStyle.italic ? "italic" : "normal",
              textAlign: textStyle.alignment,
              ...(showPill ? {
                backgroundColor: "rgba(255,255,255,0.55)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              } : {}),
            }}
          >
            {personalizeForPreview(pg.page.text, gender)}
          </p>
        </div>
      </div>
    );
  }

  if (pg.kind === "story-text") {
    // paddingInline matches renderTextSplitPage's real paddingX (10% of width).
    return (
      <div className="w-full h-full flex justify-center text-center" style={{ containerType: "size", paddingInline: "10cqw", alignItems: alignItemsFor(pg.page.vertical_align), ...panelBgStyle(panelBg, pg.page.text_bg_url) }}>
        <p className="whitespace-pre-wrap leading-relaxed"
          style={{ fontFamily: textStyle.fontFamily, fontSize: `${textStyle.fontSizePct}cqh`, color: textStyle.color, fontStyle: textStyle.italic ? "italic" : "normal", textAlign: textStyle.alignment }}>
          {personalizeForPreview(pg.page.text, gender)}
        </p>
      </div>
    );
  }

  if (pg.kind === "story-overlay") {
    const url = gender === "girl" ? (pg.page.image_url_girl ?? pg.page.image_url) : pg.page.image_url;
    return (
      <div className="w-full h-full relative">
        {url
          ? <img src={url} alt={`Page ${pg.page.page_number}`} className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300 text-sm">No image</div>
        }
        {/* containerType lives on THIS panel (not the outer full-image div) so
            fontSizePct's cqh resolves against the panel's own 25%-of-height
            box, matching buildSvgOverlay's real math (fontSize = panelHeight
            * fontSizePct/100) -- it was previously scoped to the full image,
            making preview text render ~4x too large relative to the actual
            composited PDF page. paddingInline matches buildSvgOverlay's real
            paddingX (3% of width; panel width == full image width, so cqw is
            unaffected by the panel's own containerType). */}
        <div className="absolute bottom-0 inset-x-0 py-4 flex items-center"
          style={{ height: "25%", containerType: "size", paddingInline: "3cqw", ...panelBgStyle(panelBg) }}>
          <p className="whitespace-pre-wrap"
            style={{ fontFamily: textStyle.fontFamily, fontSize: `${textStyle.fontSizePct}cqh`, color: textStyle.color, textAlign: textStyle.alignment, width: "100%" }}>
            {personalizeForPreview(pg.page.text, gender)}
          </p>
        </div>
      </div>
    );
  }

  if (pg.kind === "end") {
    return story.end_page_image_url
      ? <img src={story.end_page_image_url} alt="" className="w-full h-full object-cover" />
      : <div className="w-full h-full bg-white" />;
  }

  if (pg.kind === "back-cover") {
    const url = gender === "girl" ? (story.cover_image_url_girl ?? story.cover_image_url) : story.cover_image_url;
    const bc = coverPreviewData?.backCover;
    if (!url) {
      return <div className="w-full h-full bg-gray-900" />;
    }
    return (
      <div className="w-full h-full relative" style={{ containerType: "size" }}>
        <img src={url} alt="Back cover" className="w-full h-full object-cover" style={{ objectPosition: "left center" }} />
        {bc && (
          <BackCoverOverlay
            featuredBooks={bc.featuredBooks}
            websiteQrUrl={bc.websiteQrDataUrl}
            instagramQrUrl={bc.instagramQrDataUrl}
            companyName={bc.companyName}
            leadingText={bc.leadingText}
            fontFamily={printFontFamily}
          />
        )}
      </div>
    );
  }

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function PreviewPanel({ story, pages, textStyle, panelBg, layoutType }: Props) {
  const spreads = buildSpreads(story, pages, layoutType);
  const [index, setIndex] = useState(0);
  const [gender, setGender] = useState<"boy" | "girl">("boy");

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIndex((i) => Math.min(spreads.length - 1, i + 1)), [spreads.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  const spread = spreads[index];
  const isExteriorLeft = spread.left.kind === "blank" && index === 0;
  const isExteriorRight = spread.right.kind === "blank" && index === spreads.length - 1;
  const isCoverSpread = index === 0;

  const [coverPreviewData, setCoverPreviewData] = useState<CoverPreviewData | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCoverPreviewData(story.id).then((data) => {
      if (!cancelled) setCoverPreviewData(data);
    }).catch(() => { /* preview-only -- fall back to the approximate aspect ratio */ });
    return () => { cancelled = true; };
  }, [story.id]);
  const zones = coverPreviewData?.dims ? computeCoverZones(coverPreviewData.dims) : null;

  // Real Gelato geometry for the cover spread specifically; every other
  // spread is two square trim pages side by side.
  const spreadAspect = isCoverSpread && zones ? zones.aspectRatio : FALLBACK_SPREAD_ASPECT;

  return (
    <div className="flex flex-col h-full bg-gray-800 select-none">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1">
          {(["boy", "girl"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(g)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${gender === g ? "bg-white text-gray-900" : "text-gray-400 hover:text-gray-200"}`}
            >
              {g === "boy" ? "👦 Boy" : "👧 Girl"}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {index + 1} / {spreads.length}
        </p>
        <p className="text-xs text-gray-500 hidden sm:block">← → to navigate</p>
      </div>

      {/* Book spread */}
      <div className="flex-1 flex items-center justify-center p-8 min-h-0">
        <div className="flex items-center gap-4 w-full max-w-5xl">
          {/* Prev arrow */}
          <button
            onClick={prev}
            disabled={index === 0}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-20 transition-colors text-lg"
          >
            ‹
          </button>

          {/* Spread */}
          <div
            className="flex-1 rounded-lg overflow-hidden shadow-2xl relative"
            style={{ aspectRatio: spreadAspect }}
          >
            <div className="w-full h-full flex">
              {/* Left page */}
              <div className="flex-1 relative overflow-hidden">
                <PageRenderer pg={spread.left} story={story} textStyle={textStyle} panelBg={panelBg} gender={gender} coverPreviewData={coverPreviewData} />
              </div>

              {/* Spine */}
              {isCoverSpread && zones ? (
                <div
                  className="absolute top-0 bottom-0 bg-gray-800 pointer-events-none"
                  style={{ left: `${zones.spineLeftPct}%`, width: `${zones.spineWidthPct}%` }}
                />
              ) : (
                <div className={`shrink-0 ${index === 0 || index === spreads.length - 1 ? "w-0" : "w-px bg-gray-400/40"}`}
                  style={index !== 0 && index !== spreads.length - 1 ? { boxShadow: "0 0 8px rgba(0,0,0,0.3)" } : undefined}
                />
              )}

              {/* Right page */}
              <div className="flex-1 relative overflow-hidden">
                <PageRenderer pg={spread.right} story={story} textStyle={textStyle} panelBg={panelBg} gender={gender} coverPreviewData={coverPreviewData} />
              </div>
            </div>
          </div>

          {/* Next arrow */}
          <button
            onClick={next}
            disabled={index === spreads.length - 1}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-20 transition-colors text-lg"
          >
            ›
          </button>
        </div>
      </div>

      {/* Dot nav */}
      <div className="flex items-center justify-center gap-1.5 pb-5 shrink-0">
        {spreads.map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            className={`rounded-full transition-all ${i === index ? "w-5 h-2 bg-white" : "w-2 h-2 bg-white/30 hover:bg-white/50"}`}
          />
        ))}
      </div>
    </div>
  );
}
