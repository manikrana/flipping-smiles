"use client";

import { useState, useTransition, useEffect } from "react";
import { sendToPrint } from "./actions";
import { regenerateOrderCover, generateOrderPdf, generateSinglePage, regenerateEntireBook, reverifyPageIdentity } from "../generate/actions";
import { GOOGLE_FONTS_URL } from "@/lib/fonts";
import { panelBgStyle } from "@/lib/textPanelBg";
import { computeCoverZones } from "@/lib/coverZones";
import { getSpineAppearance, type CoverPreviewData } from "../../stories/book/actions";
import { BackCoverOverlay } from "../../stories/BackCoverOverlay";
import { FrontCoverOverlay } from "../../stories/FrontCoverOverlay";
import {
  DEFAULT_COVER_LAYOUT, DEFAULT_TEXT_STYLE, DEFAULT_TEXT_PANEL_BG,
  type CoverLayout, type TextStyle, type TextPanelBg,
} from "@/lib/supabase/types";
import type { StoryRow, StoryPageRow, OrderPageRow } from "@/lib/supabase/types";

interface Props {
  orderId: string;
  heroName: string;
  gender: "boy" | "girl";
  orderStatus: string;
  pdfUrl: string | null;
  coverUrl: string | null;
  coverPreviewData: CoverPreviewData | null;
  story: StoryRow;
  storyPages: StoryPageRow[];
  orderPages: OrderPageRow[];
}

type StoryPageEntry = { storyPage: StoryPageRow; orderPage: OrderPageRow | undefined };

type SpreadPage =
  | { kind: "cover-front" }
  | { kind: "cover-back" }
  | { kind: "endpaper"; position: "front" | "back" }
  | { kind: "brand" }
  | { kind: "title" }
  | { kind: "dedication" }
  | ({ kind: "story-overlay" } & StoryPageEntry)
  | ({ kind: "story-image" } & StoryPageEntry)
  | ({ kind: "story-text" } & StoryPageEntry)
  | ({ kind: "story-spread-scene"; sceneDir: "left" | "right" } & StoryPageEntry)
  | ({ kind: "story-spread-text"; sceneDir: "left" | "right" } & StoryPageEntry)
  | { kind: "end" };

const STORY_KINDS = new Set(["story-overlay", "story-image", "story-text", "story-spread-scene", "story-spread-text"]);

function isStoryPage(pg: SpreadPage): pg is SpreadPage & StoryPageEntry {
  return STORY_KINDS.has(pg.kind);
}

type Spread = { left: SpreadPage; right: SpreadPage | null; exterior?: boolean };

// Mirrors lib/pdf.ts's personalizeText -- this preview only did the
// hero_name swap, leaving {{hero_his}}/{{hero_he}}/etc. placeholders shown
// raw and unresolved whenever a page's identity-fill retries were exhausted
// (the "Unverified identity" case), confirmed on a real order.
function sub(text: string, heroName: string, gender: "boy" | "girl"): string {
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

// Mirrors buildPageList()'s real print structure exactly: cover spread, a
// blank front endpaper, the brand page, dedication/title, story pages, the
// end page, a blank back endpaper -- so the navigable spread count matches
// the real PDF.
function buildSpreads(story: StoryRow, storyPages: StoryPageRow[], orderPages: OrderPageRow[]): Spread[] {
  const orderPageByNum = Object.fromEntries(orderPages.map((p) => [p.page_number, p]));
  const layoutType = story.layout_type;

  const storyPageEntries: SpreadPage[] = [];
  for (const sp of storyPages) {
    const orderPage = orderPageByNum[sp.page_number];
    if (layoutType === "split_image_left") {
      storyPageEntries.push({ kind: "story-image", storyPage: sp, orderPage });
      storyPageEntries.push({ kind: "story-text", storyPage: sp, orderPage });
    } else if (layoutType === "split_image_right") {
      storyPageEntries.push({ kind: "story-text", storyPage: sp, orderPage });
      storyPageEntries.push({ kind: "story-image", storyPage: sp, orderPage });
    } else if (layoutType === "spread_left" || layoutType === "spread_left_clean") {
      storyPageEntries.push({ kind: "story-spread-scene", storyPage: sp, orderPage, sceneDir: "left" });
      storyPageEntries.push({ kind: "story-spread-text", storyPage: sp, orderPage, sceneDir: "left" });
    } else if (layoutType === "spread_right" || layoutType === "spread_right_clean") {
      storyPageEntries.push({ kind: "story-spread-text", storyPage: sp, orderPage, sceneDir: "right" });
      storyPageEntries.push({ kind: "story-spread-scene", storyPage: sp, orderPage, sceneDir: "right" });
    } else {
      storyPageEntries.push({ kind: "story-overlay", storyPage: sp, orderPage });
    }
  }

  const inner: SpreadPage[] = [
    { kind: "endpaper", position: "front" },
    { kind: "brand" },
    { kind: "dedication" },
    { kind: "title" },
    ...storyPageEntries,
    ...(story.end_page_image_url ? [{ kind: "end" } as SpreadPage] : []),
    { kind: "endpaper", position: "back" },
  ];

  const innerSpreads: Spread[] = [];
  for (let i = 0; i < inner.length; i += 2) {
    innerSpreads.push({ left: inner[i], right: inner[i + 1] ?? null });
  }

  return [
    { left: { kind: "cover-back" }, right: { kind: "cover-front" }, exterior: true },
    ...innerSpreads,
  ];
}

function pageLabel(p: SpreadPage): string {
  switch (p.kind) {
    case "cover-front": return "Front Cover";
    case "cover-back": return "Back Cover";
    case "endpaper": return p.position === "front" ? "Front Endpaper" : "Back Endpaper";
    case "brand": return "Brand Page";
    case "title": return "Title Page";
    case "dedication": return "Dedication";
    case "story-overlay":
    case "story-image":
    case "story-spread-scene":
      return `Page ${p.storyPage.page_number}`;
    case "story-text":
    case "story-spread-text":
      return `Page ${p.storyPage.page_number} (text)`;
    case "end": return "End Page";
  }
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function GeneratingPlaceholder() {
  return (
    <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center text-gray-300 gap-1">
      <span className="text-2xl">🖼</span>
      <span className="text-xs">Generating…</span>
    </div>
  );
}

function FailedOverlay() {
  return (
    <div className="absolute inset-0 bg-red-900/60 flex items-center justify-center">
      <span className="text-white text-xs font-medium px-2 py-1 bg-red-700 rounded">Face-swap failed</span>
    </div>
  );
}

function PageContent({
  pg, story, layout, textStyle, panelBg, heroName, gender, coverUrl, coverPreviewData,
}: {
  pg: SpreadPage;
  story: StoryRow;
  layout: CoverLayout;
  textStyle: TextStyle;
  panelBg: TextPanelBg;
  heroName: string;
  gender: "boy" | "girl";
  coverUrl: string | null;
  coverPreviewData: CoverPreviewData | null;
}) {
  if (pg.kind === "cover-front") {
    if (!coverUrl) {
      return (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300 text-xs">
          No cover image
        </div>
      );
    }
    // The AI art is a pure scene (no text) -- title/subtitle/company name are
    // composited here to mirror what renderCoverSpread bakes in at print time.
    return (
      <div className="w-full h-full relative overflow-hidden" style={{ containerType: "size" }}>
        <img src={coverUrl} alt="Front cover" className="w-full h-full object-cover" style={{ objectPosition: "right center" }} />
        <FrontCoverOverlay
          title={story.title}
          subtitle={sub(layout.subtitle, heroName, gender)}
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

  if (pg.kind === "cover-back") {
    const bc = coverPreviewData?.backCover;
    if (!coverUrl) {
      return <div className="w-full h-full bg-gray-900" />;
    }
    return (
      <div className="w-full h-full relative" style={{ containerType: "size" }}>
        <img src={coverUrl} alt="Back cover" className="w-full h-full object-cover" style={{ objectPosition: "left center" }} />
        {bc && (
          <BackCoverOverlay
            featuredBooks={bc.featuredBooks}
            websiteQrUrl={bc.websiteQrDataUrl}
            instagramQrUrl={bc.instagramQrDataUrl}
            companyName={bc.companyName}
            leadingText={bc.leadingText}
            fontFamily={layout.fontFamily}
          />
        )}
      </div>
    );
  }

  if (pg.kind === "endpaper") {
    return <div className="w-full h-full" style={{ backgroundColor: "#f5f0e8" }} />;
  }

  if (pg.kind === "brand") {
    return story.brand_page_image_url
      ? <img src={story.brand_page_image_url} alt="Brand page" className="w-full h-full object-cover" />
      : <div className="w-full h-full bg-white" />;
  }

  if (pg.kind === "title") {
    return (
      <div className="w-full h-full bg-white flex flex-col items-center justify-center px-6 text-center" style={{ containerType: "size" }}>
        <p style={{ fontFamily: layout.fontFamily, fontSize: "7cqh", color: "#1c1c1e", lineHeight: 1.3 }}>
          {story.title}
        </p>
      </div>
    );
  }

  if (pg.kind === "dedication") {
    return (
      <div className="w-full h-full bg-amber-50 flex flex-col items-center justify-center px-8 text-center" style={{ containerType: "size" }}>
        {story.dedication_text ? (
          <p className="whitespace-pre-wrap leading-relaxed italic text-gray-600" style={{ fontSize: "2.8cqh" }}>
            {sub(story.dedication_text, heroName, gender)}
          </p>
        ) : (
          <p className="text-xs text-gray-300 italic">No dedication set</p>
        )}
      </div>
    );
  }

  if (pg.kind === "story-image") {
    const displayUrl = pg.orderPage?.image_url ?? pg.storyPage.image_url;
    if (!displayUrl) return <GeneratingPlaceholder />;
    return (
      <>
        <img src={displayUrl} alt={`Page ${pg.storyPage.page_number}`} className="w-full h-full object-cover" />
        {pg.orderPage?.generation_status === "failed" && <FailedOverlay />}
      </>
    );
  }

  if (pg.kind === "story-text") {
    return (
      <div
        className="w-full h-full flex items-center justify-center px-8 text-center"
        style={{ containerType: "size", ...panelBgStyle(panelBg, pg.storyPage.text_bg_url) }}
      >
        <p
          className="whitespace-pre-wrap leading-relaxed"
          style={{
            fontFamily: textStyle.fontFamily,
            fontSize: `${textStyle.fontSizePct}cqh`,
            color: textStyle.color,
            fontStyle: textStyle.italic ? "italic" : "normal",
            textAlign: textStyle.alignment,
          }}
        >
          {sub(pg.storyPage.text, heroName, gender)}
        </p>
      </div>
    );
  }

  if (pg.kind === "story-spread-scene") {
    const displayUrl = pg.orderPage?.image_url ?? pg.storyPage.image_url;
    if (!displayUrl) return <GeneratingPlaceholder />;
    const objPos = pg.sceneDir === "left" ? "left center" : "right center";
    return (
      <>
        <img src={displayUrl} alt={`Page ${pg.storyPage.page_number} scene`} className="w-full h-full object-cover" style={{ objectPosition: objPos }} />
        {pg.orderPage?.generation_status === "failed" && <FailedOverlay />}
      </>
    );
  }

  if (pg.kind === "story-spread-text") {
    const displayUrl = pg.orderPage?.image_url ?? pg.storyPage.image_url;
    if (!displayUrl) return <GeneratingPlaceholder />;
    const objPos = pg.sceneDir === "left" ? "right center" : "left center";
    const showPill = textStyle.textBoxBg !== "none";
    return (
      <div className="w-full h-full relative" style={{ containerType: "size" }}>
        <img src={displayUrl} alt={`Page ${pg.storyPage.page_number} text`} className="w-full h-full object-cover" style={{ objectPosition: objPos }} />
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
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
            {sub(pg.storyPage.text, heroName, gender)}
          </p>
        </div>
        {pg.orderPage?.generation_status === "failed" && <FailedOverlay />}
      </div>
    );
  }

  if (pg.kind === "story-overlay") {
    // Prefer the text-composited order page image (has real hero name baked in)
    const displayUrl = pg.orderPage?.text_image_url ?? pg.orderPage?.image_url ?? pg.storyPage.image_url;
    const isPersonalized = !!(pg.orderPage?.text_image_url ?? pg.orderPage?.image_url);

    if (!displayUrl) return <GeneratingPlaceholder />;

    return (
      <>
        <img src={displayUrl} alt={`Page ${pg.storyPage.page_number}`} className="w-full h-full object-cover" />
        {!isPersonalized && pg.storyPage.image_url && (
          // Live CSS overlay preview if no composited image yet — panel position/
          // padding mirrors composite.ts's buildSvgOverlay() math exactly (25%
          // panel height, 4%-of-page-height bottom margin, 3% horizontal padding,
          // 6%-of-panel-height vertical padding) so this matches the real print.
          // Padding lives on a nested div, not the cqh container itself — a size
          // container can't resolve cqh/cqw on its own properties, only on descendants.
          <div
            className="absolute left-0 right-0"
            style={{
              height: "25%",
              bottom: "4%",
              backgroundColor: `rgba(${hexToRgb(textStyle.bgColor)}, ${textStyle.bgOpacity})`,
              containerType: "size",
            }}
          >
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ paddingLeft: "3%", paddingRight: "3%", paddingTop: "6cqh", paddingBottom: "6cqh", boxSizing: "border-box" }}
            >
              <p style={{
                fontFamily: textStyle.fontFamily,
                fontSize: `${textStyle.fontSizePct}cqh`,
                color: textStyle.color,
                textAlign: textStyle.alignment,
                lineHeight: 1.55,
                width: "100%",
              }}>
                {sub(pg.storyPage.text, heroName, gender)}
              </p>
            </div>
          </div>
        )}
        {pg.orderPage?.generation_status === "failed" && <FailedOverlay />}
      </>
    );
  }

  if (pg.kind === "end") {
    return story.end_page_image_url
      ? <img src={story.end_page_image_url} alt="" className="w-full h-full object-cover" />
      : <div className="w-full h-full bg-white" />;
  }

  return null;
}

function SpreadPageCard({
  pg, active, story, layout, textStyle, panelBg, heroName, gender, coverUrl, coverPreviewData, onClick,
}: {
  pg: SpreadPage | null;
  active: boolean;
  story: StoryRow;
  layout: CoverLayout;
  textStyle: TextStyle;
  panelBg: TextPanelBg;
  heroName: string;
  gender: "boy" | "girl";
  coverUrl: string | null;
  coverPreviewData: CoverPreviewData | null;
  onClick: () => void;
}) {
  if (!pg) return <div className="flex-1 bg-gray-50" />;

  return (
    <div
      className={`flex-1 relative overflow-hidden cursor-pointer transition-all ${
        active ? "ring-2 ring-inset ring-brand-500" : "hover:ring-2 hover:ring-inset hover:ring-brand-300"
      }`}
      onClick={onClick}
    >
      <PageContent pg={pg} story={story} layout={layout} textStyle={textStyle} panelBg={panelBg} heroName={heroName} gender={gender} coverUrl={coverUrl} coverPreviewData={coverPreviewData} />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/40 to-transparent pt-4 pb-1.5 px-2 text-center">
        <span className="text-white text-[10px] font-medium drop-shadow">{pageLabel(pg)}</span>
      </div>
      {active && (
        <div className="absolute top-2 left-2 bg-brand-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          Viewing
        </div>
      )}
    </div>
  );
}

export function OrderBookPreview({ orderId, heroName, gender, orderStatus, pdfUrl, coverUrl, coverPreviewData, story, storyPages, orderPages }: Props) {
  const [, startTransition] = useTransition();
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [activeKey, setActiveKey] = useState("cover-front");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(orderStatus === "sent_to_print");
  const [error, setError] = useState<string | null>(null);
  const [regeneratingCover, setRegeneratingCover] = useState(false);
  const [currentPdfUrl, setCurrentPdfUrl] = useState(pdfUrl);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [regeneratingBook, setRegeneratingBook] = useState(false);
  const [regeneratingPage, setRegeneratingPage] = useState<number | null>(null);
  const [reverifyingPage, setReverifyingPage] = useState<number | null>(null);
  const [reverifyResult, setReverifyResult] = useState<{ page: number; verified: boolean; reason: string } | null>(null);
  const [spineAppearance, setSpineAppearance] = useState<{ spineColor: string; spineTextColor: string } | null>(null);

  useEffect(() => {
    if (document.getElementById("kitabee-google-fonts")) return;
    const link = document.createElement("link");
    link.id = "kitabee-google-fonts";
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    document.head.appendChild(link);
  }, []);

  const layout = story.cover_layout ?? DEFAULT_COVER_LAYOUT;
  const textStyle = (story.text_style as TextStyle | null) ?? DEFAULT_TEXT_STYLE;
  const panelBg = story.text_panel_bg ?? DEFAULT_TEXT_PANEL_BG;
  const spreads = buildSpreads(story, storyPages, orderPages);
  const currentSpread = spreads[spreadIndex];
  const zones = coverPreviewData?.dims ? computeCoverZones(coverPreviewData.dims) : null;

  // Real sampled spine color + contrast-matched text color, same geometry
  // renderCoverSpread uses at print time -- replaces the flat gray
  // placeholder bar with what the spine will actually look like.
  useEffect(() => {
    if (!coverUrl || !coverPreviewData?.dims) { setSpineAppearance(null); return; }
    let cancelled = false;
    getSpineAppearance(coverUrl, coverPreviewData.dims)
      .then((result) => { if (!cancelled) setSpineAppearance(result); })
      .catch(() => { if (!cancelled) setSpineAppearance(null); });
    return () => { cancelled = true; };
  }, [coverUrl, coverPreviewData?.dims]);

  function pgKey(pg: SpreadPage): string {
    if (isStoryPage(pg)) return `${pg.kind}-${pg.storyPage.id}`;
    if (pg.kind === "endpaper") return `endpaper-${pg.position}`;
    return pg.kind;
  }

  function handleSpreadNav(dir: -1 | 1) {
    const next = spreadIndex + dir;
    setSpreadIndex(next);
    const s = spreads[next];
    const defaultPg = s.exterior && s.right ? s.right : s.left;
    setActiveKey(pgKey(defaultPg));
  }

  async function handleRegenerateCover() {
    if (!confirm("Regenerate this order's cover? This calls Gemini again and replaces the current cover.")) return;
    setRegeneratingCover(true);
    setError(null);
    try {
      await regenerateOrderCover(orderId);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setRegeneratingCover(false);
    }
  }

  async function handleGeneratePdf() {
    setGeneratingPdf(true);
    setError(null);
    try {
      const url = await generateOrderPdf(orderId);
      setCurrentPdfUrl(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function handleRegenerateBook() {
    if (!confirm(
      "Dispose all generated pages for this order and regenerate the entire book from scratch, then rebuild the PDF? " +
      "This calls Gemini again for every page and cannot be undone."
    )) return;
    setRegeneratingBook(true);
    setError(null);
    try {
      await regenerateEntireBook(orderId);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setRegeneratingBook(false);
    }
  }

  async function handleRegeneratePage(pageNumber: number) {
    if (!confirm(`Regenerate page ${pageNumber}? This calls Gemini again and replaces the current page image.`)) return;
    setRegeneratingPage(pageNumber);
    setError(null);
    try {
      await generateSinglePage(orderId, pageNumber);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setRegeneratingPage(null);
    }
  }

  // Re-checks the ALREADY-SAVED image with a single cheap judge call instead
  // of regenerating -- the judge has real run-to-run variance, so a stale
  // "unverified" flag doesn't always mean the image needs a new fill-in.
  async function handleReverifyPage(pageNumber: number) {
    setReverifyingPage(pageNumber);
    setReverifyResult(null);
    setError(null);
    try {
      const { verified, reason } = await reverifyPageIdentity(orderId, pageNumber);
      setReverifyResult({ page: pageNumber, verified, reason });
      if (verified) window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReverifyingPage(null);
    }
  }

  function handleSendToPrint() {
    setSending(true);
    setError(null);
    startTransition(async () => {
      try {
        await sendToPrint(orderId);
        setSent(true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSending(false);
      }
    });
  }

  const failedPages = orderPages.filter((p) => p.generation_status === "failed");
  const unverifiedPages = orderPages.filter((p) => p.generation_status === "done" && p.identity_verified === false);
  const generatingPages = orderPages.filter((p) => p.generation_status === "processing" || p.generation_status === "upscaling");
  const allDone = orderPages.length > 0 && generatingPages.length === 0;
  // A false verification flag now means either identity or the locked
  // wardrobe failed QA. Do not allow that known-bad state into fulfillment.
  const canSendToPrint = allDone && unverifiedPages.length === 0 && !sent && orderStatus !== "sent_to_print";

  // Active page detail
  const activePg = [...spreads.flatMap((s) => [s.left, s.right].filter(Boolean) as SpreadPage[])].find(
    (pg) => pgKey(pg) === activeKey
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {failedPages.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm">
          {failedPages.length} page{failedPages.length !== 1 ? "s" : ""} had face-swap errors — review carefully before printing.
        </div>
      )}

      <div className="flex gap-6 items-start">
        {/* ── Left: book spread ── */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Context label */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              currentSpread.exterior ? "bg-gray-800 text-white" : "bg-blue-50 text-blue-700"
            }`}>
              {currentSpread.exterior ? "Outside" : "Inside"}
            </span>
            <span className="text-xs text-gray-400">
              {currentSpread.exterior
                ? "Front & back covers"
                : `${pageLabel(currentSpread.left)}${currentSpread.right ? ` · ${pageLabel(currentSpread.right)}` : ""}`}
            </span>
          </div>

          {/* Spread */}
          <div
            className={`w-full overflow-hidden shadow-xl bg-white relative ${
              currentSpread.exterior ? "rounded-2xl border-2 border-gray-800" : "rounded-2xl border border-gray-300"
            }`}
            style={{ aspectRatio: currentSpread.exterior && zones ? zones.aspectRatio : "2/1" }}
          >
            <div className="w-full h-full flex">
              <SpreadPageCard
                pg={currentSpread.left}
                active={currentSpread.left ? activeKey === pgKey(currentSpread.left) : false}
                story={story}
                layout={layout}
                textStyle={textStyle}
                panelBg={panelBg}
                heroName={heroName}
                gender={gender}
                coverUrl={coverUrl}
                coverPreviewData={coverPreviewData}
                onClick={() => currentSpread.left && setActiveKey(pgKey(currentSpread.left))}
              />
              {currentSpread.exterior && zones ? (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none flex items-center justify-center overflow-hidden"
                  style={{
                    left: `${zones.spineLeftPct}%`,
                    width: `${zones.spineWidthPct}%`,
                    backgroundColor: spineAppearance?.spineColor ?? "#1f2937",
                    containerType: "inline-size",
                  }}
                >
                  {spineAppearance && (
                    <span
                      className="whitespace-nowrap"
                      style={{
                        writingMode: "vertical-rl",
                        color: spineAppearance.spineTextColor,
                        fontFamily: layout.fontFamily,
                        fontSize: "50cqw",
                        fontWeight: 600,
                      }}
                    >
                      {story.title}{layout.subtitle ? `: ${sub(layout.subtitle, heroName, gender)}` : ""}
                    </span>
                  )}
                </div>
              ) : (
                <div className={`shrink-0 ${currentSpread.exterior ? "w-2 bg-gray-800" : "w-px bg-gray-300"}`}
                  style={currentSpread.exterior ? undefined : { boxShadow: "0 0 8px rgba(0,0,0,0.12)" }} />
              )}
              <SpreadPageCard
                pg={currentSpread.right}
                active={currentSpread.right ? activeKey === pgKey(currentSpread.right) : false}
                story={story}
                layout={layout}
                textStyle={textStyle}
                panelBg={panelBg}
                heroName={heroName}
                gender={gender}
                coverUrl={coverUrl}
                coverPreviewData={coverPreviewData}
                onClick={() => currentSpread.right && setActiveKey(pgKey(currentSpread.right))}
              />
            </div>
          </div>

          {/* Nav */}
          <div className="flex items-center justify-between px-1">
            <button onClick={() => handleSpreadNav(-1)} disabled={spreadIndex === 0}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              ← Prev
            </button>
            <div className="flex gap-1.5 items-center">
              {spreads.map((s, i) => (
                <button key={i}
                  onClick={() => { setSpreadIndex(i); const dp = s.exterior && s.right ? s.right : s.left; setActiveKey(pgKey(dp)); }}
                  className={`rounded-full transition-all ${i === spreadIndex ? "w-5 h-2 bg-gray-800" : "w-2 h-2 bg-gray-200 hover:bg-gray-400"}`}
                  title={s.exterior ? "Covers" : `${pageLabel(s.left)}${s.right ? ` · ${pageLabel(s.right)}` : ""}`}
                />
              ))}
            </div>
            <button onClick={() => handleSpreadNav(1)} disabled={spreadIndex === spreads.length - 1}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              Next →
            </button>
          </div>
        </div>

        {/* ── Right: page info + send to print ── */}
        <div className="w-64 shrink-0 space-y-4">
          {/* Active page info */}
          {activePg && isStoryPage(activePg) && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Page {activePg.storyPage.page_number}
              </p>
              <p className="text-xs text-gray-600 italic leading-relaxed">
                "{sub(activePg.storyPage.text, heroName, gender)}"
              </p>
              {activePg.orderPage && (
                <div className={`text-xs font-medium px-2 py-1 rounded-lg inline-block ${
                  activePg.orderPage.generation_status === "done"
                    ? activePg.orderPage.identity_verified === false ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
                    : activePg.orderPage.generation_status === "failed"
                      ? "bg-red-50 text-red-700"
                      : "bg-amber-50 text-amber-700"
                }`}>
                  {activePg.orderPage.generation_status === "done"
                    ? activePg.orderPage.identity_verified === false
                      ? "⚠ Identity or wardrobe unverified — retry required"
                      : activePg.orderPage.text_image_url ? "✓ Personalised + text" : "✓ Face-swapped"
                    : activePg.orderPage.generation_status === "failed"
                      ? "✗ " + (activePg.orderPage.error_message ?? "Failed")
                      : "Generating…"}
                </div>
              )}
              {activePg.orderPage?.generation_status === "done" && activePg.orderPage.identity_verified === false && (
                <button
                  onClick={() => handleReverifyPage(activePg.storyPage.page_number)}
                  disabled={reverifyingPage !== null || orderStatus === "sent_to_print"}
                  className="block text-xs text-brand-600 hover:text-brand-700 disabled:opacity-40 font-medium transition-colors"
                  title="Re-checks the existing image with one cheap judge call instead of regenerating -- fixes it if the flag was just judge noise"
                >
                  {reverifyingPage === activePg.storyPage.page_number ? "Re-checking…" : "✓ Re-verify identity + wardrobe"}
                </button>
              )}
              {reverifyResult?.page === activePg.storyPage.page_number && !reverifyResult.verified && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
                  Still no match: {reverifyResult.reason}
                </p>
              )}
              <button
                onClick={() => handleRegeneratePage(activePg.storyPage.page_number)}
                disabled={regeneratingPage !== null || orderStatus === "sent_to_print"}
                className="block text-xs text-purple-600 hover:text-purple-700 disabled:opacity-40 font-medium transition-colors"
              >
                {regeneratingPage === activePg.storyPage.page_number ? "Regenerating…" : "↺ Regenerate this page"}
              </button>
            </div>
          )}

          {/* Generation status */}
          {generatingPages.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium text-purple-700">Generating…</span>
              </div>
              <p className="text-xs text-purple-500">
                {orderPages.filter((p) => p.generation_status === "done").length}/{orderPages.length} pages done
              </p>
            </div>
          )}

          {/* Cover */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cover</p>
            <button
              onClick={handleRegenerateCover}
              disabled={regeneratingCover}
              className="text-xs text-purple-600 hover:text-purple-700 disabled:opacity-40 font-medium transition-colors"
            >
              {regeneratingCover ? "Regenerating…" : "🔄 Regenerate cover"}
            </button>
          </div>

          {/* Page status summary */}
          {allDone && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pages</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Face-swapped</span>
                  <span className="font-medium text-green-700">{orderPages.filter((p) => p.image_url).length}/{orderPages.length}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Text composited</span>
                  <span className="font-medium text-green-700">{orderPages.filter((p) => p.text_image_url).length}/{orderPages.length}</span>
                </div>
                {failedPages.length > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-red-500">Failed</span>
                    <span className="font-medium text-red-700">{failedPages.length}</span>
                  </div>
                )}
                {unverifiedPages.length > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-amber-600">Unverified identity / wardrobe</span>
                    <span className="font-medium text-amber-700">{unverifiedPages.length}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PDF export */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">PDF</p>
            <div className="flex items-center gap-3">
              {currentPdfUrl && !generatingPdf && (
                <a
                  href={currentPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                >
                  Download
                </a>
              )}
              <button
                onClick={handleGeneratePdf}
                disabled={generatingPdf || !allDone}
                className="text-xs text-purple-600 hover:text-purple-700 disabled:opacity-40 font-medium transition-colors"
              >
                {generatingPdf ? "Generating…" : currentPdfUrl ? "↺ Regenerate PDF" : "Export PDF"}
              </button>
            </div>
          </div>

          {/* Full-book recovery: dispose every generated page and PDF, regenerate from scratch */}
          {orderStatus !== "sent_to_print" && orderStatus !== "shipped" && orderStatus !== "delivered" && (
            <button
              onClick={handleRegenerateBook}
              disabled={regeneratingBook || regeneratingPage !== null}
              className="w-full bg-red-50 hover:bg-red-100 disabled:opacity-40 text-red-700 font-semibold px-4 py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {regeneratingBook && <span className="w-3.5 h-3.5 border-2 border-red-400/60 border-t-red-700 rounded-full animate-spin" />}
              {regeneratingBook ? "Regenerating entire book…" : "🔄 Regenerate entire book"}
            </button>
          )}

          {/* Send to print */}
          <div className="space-y-2">
            {sent || orderStatus === "sent_to_print" ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-sm font-semibold text-green-700">✓ Sent to print</p>
                <p className="text-xs text-green-500 mt-0.5">Order is in the print queue.</p>
              </div>
            ) : (
              <>
                <button
                  onClick={handleSendToPrint}
                  disabled={sending || !canSendToPrint}
                  className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-4 py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {sending && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
                  {sending ? "Sending…" : "Approve & Send to Print"}
                </button>
                {!allDone && (
                  <p className="text-xs text-gray-400 text-center">Waiting for generation to complete…</p>
                )}
                {allDone && unverifiedPages.length > 0 && (
                  <p className="text-xs text-amber-600 text-center">Resolve every identity or wardrobe warning before sending to print.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
