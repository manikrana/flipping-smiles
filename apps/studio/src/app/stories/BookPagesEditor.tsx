"use client";

import { useState, useTransition, useEffect } from "react";
import { saveBookPages, setCoverImage, saveCoverLayout } from "./book/actions";
import { saveTextStyle } from "./text-style/actions";
import { compositeTextOnPages } from "./backgrounds/text/actions";
import { saveEndpaperSettings } from "./endpaper/actions";
import { saveBackCoverSettings, fetchPublishedStories, type FeaturedStory } from "./back-cover/actions";
import { getCoverPreviewData, type CoverPreviewData } from "./book/actions";
import { computeCoverZones } from "@/lib/coverZones";
import { FONT_OPTIONS, GOOGLE_FONTS_URL } from "@/lib/fonts";
import { patternToCss, PATTERNS } from "@/lib/patterns";
import {
  DEFAULT_COVER_LAYOUT,
  DEFAULT_TEXT_STYLE,
  type CoverLayout,
  type TextStyle,
  type TextPanelBg,
} from "@/lib/supabase/types";
import type { StoryRow, StoryPageRow, PrintProviderTrimSizeRow } from "@/lib/supabase/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  story: StoryRow;
  pages: StoryPageRow[];
  trimSizes: PrintProviderTrimSizeRow[];
}

type PageDef =
  | { kind: "cover" }
  | { kind: "front-endpaper" }
  | { kind: "title" }
  | { kind: "story"; page: StoryPageRow }
  | { kind: "story-image"; page: StoryPageRow }
  | { kind: "story-text"; page: StoryPageRow }
  | { kind: "end" }
  | { kind: "back-endpaper" }
  | { kind: "back" };

type Spread = { left: PageDef; right: PageDef | null; exterior?: boolean };

function pageKey(p: PageDef): string {
  if (p.kind === "story") return `story-${p.page.id}`;
  if (p.kind === "story-image") return `story-image-${p.page.id}`;
  if (p.kind === "story-text") return `story-text-${p.page.id}`;
  return p.kind;
}

function pageLabel(p: PageDef): string {
  switch (p.kind) {
    case "cover": return "Front Cover";
    case "front-endpaper": return "Front Endpaper";
    case "title": return "Title Page";
    case "story": return `Page ${p.page.page_number}`;
    case "story-image": return `Page ${p.page.page_number}`;
    case "story-text": return `Page ${p.page.page_number} ✏`;
    case "end": return "End Page";
    case "back-endpaper": return "Back Endpaper";
    case "back": return "Back Cover";
  }
}

function buildSpreads(pages: StoryPageRow[], layoutType: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean"): Spread[] {
  // Exterior: back cover left, front cover right — exactly how a closed book looks
  const exterior: Spread = { left: { kind: "back" }, right: { kind: "cover" }, exterior: true };

  // Inner pages in reading order: front-endpaper, title, ...story pages..., end, back-endpaper
  const inner: PageDef[] = [{ kind: "front-endpaper" }, { kind: "title" }];

  if (layoutType === "split_image_left" || layoutType === "spread_left" || layoutType === "spread_left_clean") {
    for (const p of pages) {
      inner.push({ kind: "story-image", page: p });
      inner.push({ kind: "story-text", page: p });
    }
  } else if (layoutType === "split_image_right" || layoutType === "spread_right" || layoutType === "spread_right_clean") {
    for (const p of pages) {
      inner.push({ kind: "story-text", page: p });
      inner.push({ kind: "story-image", page: p });
    }
  } else {
    for (const p of pages) {
      inner.push({ kind: "story", page: p });
    }
  }

  inner.push({ kind: "end" });
  inner.push({ kind: "back-endpaper" });

  const innerSpreads: Spread[] = [];
  for (let i = 0; i < inner.length; i += 2) {
    innerSpreads.push({ left: inner[i], right: inner[i + 1] ?? null });
  }

  return [exterior, ...innerSpreads];
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function SaveButton({ onClick, saving, saved }: { onClick: () => void; saving: boolean; saved: boolean }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
      {saving && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
      {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
    </button>
  );
}

function EndpaperBgPicker({ bg, onChange }: { bg: TextPanelBg; onChange: (b: TextPanelBg) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["solid", "gradient", "pattern"] as const).map((t) => (
          <button key={t} onClick={() => {
            if (t === "solid") onChange({ type: "solid", color: bg.type === "solid" ? bg.color : "#f5f0e8" });
            else if (t === "gradient") onChange({ type: "gradient", from: "#f5f0e8", to: "#e8d5b7", direction: "to-bottom" });
            else onChange({ type: "pattern", patternId: "clouds", color: "#c4b5a0", bgColor: "#f5f0e8" });
          }}
          className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${bg.type === t ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {t}
          </button>
        ))}
      </div>
      {bg.type === "solid" && (
        <div className="flex items-center gap-3">
          <input type="color" value={bg.color} onChange={(e) => onChange({ type: "solid", color: e.target.value })}
            className="w-9 h-9 rounded-lg cursor-pointer border border-gray-200" />
          <span className="text-xs font-mono text-gray-500">{bg.color}</span>
          <div className="w-16 h-9 rounded-lg border border-gray-200" style={{ backgroundColor: bg.color }} />
        </div>
      )}
      {bg.type === "gradient" && (
        <div className="flex gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">From</label>
            <input type="color" value={bg.from} onChange={(e) => onChange({ ...bg, from: e.target.value })}
              className="w-9 h-9 rounded-lg cursor-pointer border border-gray-200" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">To</label>
            <input type="color" value={bg.to} onChange={(e) => onChange({ ...bg, to: e.target.value })}
              className="w-9 h-9 rounded-lg cursor-pointer border border-gray-200" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Direction</label>
            <select value={bg.direction} onChange={(e) => onChange({ ...bg, direction: e.target.value as "to-bottom" | "to-right" | "to-bottom-right" })}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs">
              <option value="to-bottom">↓ Down</option>
              <option value="to-right">→ Right</option>
              <option value="to-bottom-right">↘ Diagonal</option>
            </select>
          </div>
        </div>
      )}
      {bg.type === "pattern" && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-1.5">
            {PATTERNS.map((p) => {
              const isSelected = bg.type === "pattern" && bg.patternId === p.id;
              return (
                <button key={p.id} onClick={() => onChange({ ...bg, patternId: p.id })} title={p.label}
                  className={`rounded-lg overflow-hidden border-2 transition-colors ${isSelected ? "border-brand-500" : "border-gray-200 hover:border-gray-400"}`}>
                  <div className="h-10" style={patternToCss(p.id, bg.type === "pattern" ? bg.color : "#c4b5a0", bg.type === "pattern" ? bg.bgColor : "#f5f0e8") as React.CSSProperties} />
                  <div className={`text-[9px] font-medium py-0.5 text-center ${isSelected ? "text-brand-700 bg-brand-50" : "text-gray-500 bg-gray-50"}`}>{p.label}</div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Pattern color</label>
              <input type="color" value={bg.color} onChange={(e) => onChange({ ...bg, color: e.target.value })}
                className="w-9 h-9 rounded-lg cursor-pointer border border-gray-200" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Background color</label>
              <input type="color" value={bg.bgColor} onChange={(e) => onChange({ ...bg, bgColor: e.target.value })}
                className="w-9 h-9 rounded-lg cursor-pointer border border-gray-200" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EndpaperStylePicker({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-500">Text style</label>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Font</label>
          <select value={style.fontFamily} onChange={(e) => onChange({ ...style, fontFamily: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
            style={{ fontFamily: style.fontFamily }}>
            {FONT_OPTIONS.map((f) => (
              <option key={f.cssFamily} value={f.cssFamily} style={{ fontFamily: f.cssFamily }}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Color</label>
          <input type="color" value={style.color} onChange={(e) => onChange({ ...style, color: e.target.value })}
            className="w-full h-8 rounded cursor-pointer border border-gray-200" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Align</label>
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} onClick={() => onChange({ ...style, alignment: a })}
                className={`flex-1 py-1.5 rounded text-xs transition-colors ${style.alignment === a ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {a === "left" ? "←" : a === "center" ? "≡" : "→"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page content renderer ─────────────────────────────────────────────────────

function endpaperBgCss(bg: TextPanelBg | null): React.CSSProperties {
  if (!bg || bg.type === "none" || bg.type === "scene_bleed") return {};
  if (bg.type === "solid") return { backgroundColor: bg.color };
  if (bg.type === "gradient") {
    const dir = bg.direction === "to-bottom" ? "to bottom" : bg.direction === "to-right" ? "to right" : "to bottom right";
    return { background: `linear-gradient(${dir}, ${bg.from}, ${bg.to})` };
  }
  if (bg.type === "pattern") {
    return patternToCss(bg.patternId, bg.color, bg.bgColor) as React.CSSProperties;
  }
  return {};
}

function PageContent({
  pg, story, layout, textStyle, endPageText, savedTextImages,
  frontEpBg, frontEpText, frontEpTextStyle,
  backEpBg, backEpText, backEpTextStyle,
  backCoverFeaturedStories, backCoverQrUrl, backCoverWebsiteText,
}: {
  pg: PageDef;
  story: StoryRow;
  layout: CoverLayout;
  textStyle: TextStyle;
  endPageText: string;
  savedTextImages: Record<string, string>;
  frontEpBg?: TextPanelBg;
  frontEpText?: string;
  frontEpTextStyle?: TextStyle;
  backEpBg?: TextPanelBg;
  backEpText?: string;
  backEpTextStyle?: TextStyle;
  backCoverFeaturedStories?: FeaturedStory[];
  backCoverQrUrl?: string;
  backCoverWebsiteText?: string;
}) {
  if (pg.kind === "cover") {
    if (!story.cover_image_url) {
      return (
        <div className="w-full h-full bg-gradient-to-b from-gray-100 to-gray-200 flex flex-col items-center justify-center text-gray-300 gap-2">
          <span className="text-4xl">📖</span>
          <span className="text-xs text-center px-4">Click to set cover</span>
        </div>
      );
    }
    const titleSize = layout.titleSize ?? 8;
    const subtitleSize = layout.subtitleSize ?? 4.5;
    return (
      <>
        <img src={story.cover_image_url} alt="Cover" className="w-full h-full object-cover" style={{ objectPosition: "right center" }} />
        <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${layout.overlayOpacity})` }} />
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-end px-6 pb-8 text-center gap-2"
          style={{ containerType: "size", height: "100%" }}
        >
          <p style={{ fontFamily: layout.fontFamily, fontSize: `${titleSize}cqh`, color: layout.titleColor, lineHeight: 1.2, textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>
            {story.title}
          </p>
          {layout.subtitle && (
            <p style={{ fontFamily: layout.fontFamily, fontSize: `${subtitleSize}cqh`, color: layout.subtitleColor, lineHeight: 1.3, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>
              {layout.subtitle}
            </p>
          )}
        </div>
      </>
    );
  }

  if (pg.kind === "title") {
    return (
      <div
        className="w-full h-full bg-white flex flex-col items-center justify-center px-6 text-center"
        style={{ containerType: "size" }}
      >
        <p style={{ fontFamily: layout.fontFamily, fontSize: "7cqh", color: "#1c1c1e", lineHeight: 1.3 }}>
          {story.title}
        </p>
      </div>
    );
  }

  if (pg.kind === "front-endpaper" || pg.kind === "back-endpaper") {
    // Real print endpapers are genuinely blank (Gelato's own guidance warns
    // some production partners glue this leaf directly to the cover board,
    // so printed content risks being unpredictably hidden) -- this text is
    // kept visible here only as live typing feedback for the editor below,
    // not as a representation of what will actually print.
    const isFront = pg.kind === "front-endpaper";
    const bg = (isFront ? frontEpBg : backEpBg) ?? (isFront ? story.front_endpaper_bg : story.back_endpaper_bg);
    const text = (isFront ? frontEpText : backEpText) ?? (isFront ? story.front_endpaper_text : story.back_endpaper_text) ?? "";
    const epStyle = (isFront ? frontEpTextStyle : backEpTextStyle) ?? (isFront ? story.front_endpaper_text_style : story.back_endpaper_text_style) ?? DEFAULT_TEXT_STYLE;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center px-8 text-center relative"
        style={{ containerType: "size", ...endpaperBgCss(bg ?? null) }}>
        <div className="absolute top-2 left-2 bg-amber-500/90 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
          Won't print — endpapers are blank
        </div>
        {text ? (
          <p className="whitespace-pre-wrap leading-relaxed"
            style={{ fontFamily: epStyle.fontFamily, fontSize: isFront ? "3cqh" : "2.5cqh", color: epStyle.color, textAlign: epStyle.alignment }}>
            {text.replace(/{{hero_name}}/g, "Hero")}
          </p>
        ) : (
          <p className="text-[10px] text-gray-400 italic">{isFront ? "Front" : "Back"} endpaper — edit in sidebar</p>
        )}
      </div>
    );
  }

  if (pg.kind === "story") {
    if (!pg.page.image_url) {
      return (
        <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center text-gray-300 gap-1">
          <span className="text-2xl">🖼</span>
          <span className="text-xs">No scene yet</span>
        </div>
      );
    }
    const isComposited = !!(savedTextImages[pg.page.id] ?? pg.page.text_image_url);
    return (
      <>
        <img src={pg.page.image_url} alt={`Page ${pg.page.page_number}`} className="w-full h-full object-cover" />
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center"
          style={{
            height: "25%",
            backgroundColor: `rgba(${hexToRgb(textStyle.bgColor)}, ${textStyle.bgOpacity})`,
            padding: "0 6%",
            containerType: "size",
          }}
        >
          <p style={{
            fontFamily: textStyle.fontFamily,
            fontSize: `${textStyle.fontSizePct}cqh`,
            color: textStyle.color,
            textAlign: textStyle.alignment,
            lineHeight: 1.55,
            width: "100%",
          }}>
            {pg.page.text}
          </p>
        </div>
        {isComposited && (
          <div className="absolute top-2 right-2 bg-green-500/90 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
            ✓ saved
          </div>
        )}
      </>
    );
  }

  if (pg.kind === "story-image") {
    if (!pg.page.image_url) {
      return (
        <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center text-gray-300 gap-1">
          <span className="text-2xl">🖼</span>
          <span className="text-xs">No scene yet</span>
        </div>
      );
    }
    return (
      <img src={pg.page.image_url} alt={`Page ${pg.page.page_number}`} className="w-full h-full object-cover" />
    );
  }

  if (pg.kind === "story-text") {
    const isComposited = !!(savedTextImages[pg.page.id] ?? pg.page.text_image_url);
    return (
      <div
        className="w-full h-full flex items-center justify-center px-6"
        style={{
          backgroundColor: textStyle.bgColor,
          containerType: "size",
        }}
      >
        <p style={{
          fontFamily: textStyle.fontFamily,
          fontSize: `${textStyle.fontSizePct}cqh`,
          color: textStyle.color,
          textAlign: textStyle.alignment,
          lineHeight: 1.7,
          width: "100%",
        }}>
          {pg.page.text}
        </p>
        {isComposited && (
          <div className="absolute top-2 right-2 bg-green-500/90 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
            ✓ saved
          </div>
        )}
      </div>
    );
  }

  if (pg.kind === "end") {
    return (
      <div
        className="w-full h-full bg-white flex flex-col items-center justify-center px-8 text-center"
        style={{ containerType: "size" }}
      >
        <p style={{ fontFamily: layout.fontFamily, fontSize: "9cqh", color: "#1c1c1e", lineHeight: 1.3 }}>
          {(endPageText || "The End").replace(/{{hero_name}}/g, "Hero")}
        </p>
      </div>
    );
  }

  if (pg.kind === "back") {
    const featuredStories = backCoverFeaturedStories ?? [];
    const hasContent = featuredStories.length > 0 || !!backCoverQrUrl || !!backCoverWebsiteText;
    if (!story.cover_image_url) {
      return <div className="w-full h-full" style={{ backgroundColor: "#1a1a2e" }} />;
    }
    return (
      <div className="w-full h-full relative" style={{ containerType: "size" }}>
        <img src={story.cover_image_url} alt="Back cover" className="w-full h-full object-cover" style={{ objectPosition: "left center" }} />
        {hasContent ? (
          <div
            className="absolute inset-[8%] rounded-xl flex flex-col items-center justify-center gap-3 px-4 py-4 text-center"
            style={{ containerType: "size", backgroundColor: "rgba(255,255,255,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          >
            {featuredStories.length > 0 && (
              <>
                <p className="italic" style={{ fontSize: "6cqh", color: "#1c1c1e" }}>Have you read?</p>
                <div className="grid grid-cols-2 gap-2 w-full">
                  {featuredStories.slice(0, 4).map(s => (
                    <div key={s.id} className="rounded overflow-hidden">
                      {s.cover_image_url
                        ? <img src={s.cover_image_url} alt={s.title} className="w-full aspect-square object-cover" style={{ objectPosition: "right center" }} />
                        : <div className="w-full aspect-square bg-gray-100 flex items-center justify-center text-gray-500 text-xs">{s.title}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
            {backCoverQrUrl && (
              <div className="w-12 h-12 bg-white rounded flex items-center justify-center border border-gray-200">
                <span className="text-[8px] text-gray-500">QR</span>
              </div>
            )}
            {backCoverWebsiteText && (
              <p style={{ fontSize: "5cqh", color: "#1c1c1e" }}>{backCoverWebsiteText}</p>
            )}
          </div>
        ) : (
          <p className="absolute inset-x-0 bottom-4 text-[10px] text-white/70 italic text-center">Back cover — edit in sidebar</p>
        )}
      </div>
    );
  }

  return null;
}

// ── Page card (in the spread) ─────────────────────────────────────────────────

function SpreadPage({
  pg, active, story, layout, textStyle, endPageText, savedTextImages, onClick,
  frontEpBg, frontEpText, frontEpTextStyle,
  backEpBg, backEpText, backEpTextStyle,
  backCoverFeaturedStories, backCoverQrUrl, backCoverWebsiteText,
}: {
  pg: PageDef | null;
  active: boolean;
  story: StoryRow;
  layout: CoverLayout;
  textStyle: TextStyle;
  endPageText: string;
  savedTextImages: Record<string, string>;
  onClick: () => void;
  frontEpBg?: TextPanelBg;
  frontEpText?: string;
  frontEpTextStyle?: TextStyle;
  backEpBg?: TextPanelBg;
  backEpText?: string;
  backEpTextStyle?: TextStyle;
  backCoverFeaturedStories?: FeaturedStory[];
  backCoverQrUrl?: string;
  backCoverWebsiteText?: string;
}) {
  if (!pg) {
    return <div className="flex-1 bg-gray-50" />;
  }

  const isClickable = pg.kind !== "title";

  return (
    <div
      className={`flex-1 relative overflow-hidden transition-all ${
        isClickable ? "cursor-pointer" : "cursor-default"
      } ${active ? "ring-2 ring-inset ring-brand-500" : isClickable ? "hover:ring-2 hover:ring-inset hover:ring-brand-300" : ""}`}
      onClick={isClickable ? onClick : undefined}
    >
      <PageContent
        pg={pg}
        story={story}
        layout={layout}
        textStyle={textStyle}
        endPageText={endPageText}
        savedTextImages={savedTextImages}
        frontEpBg={frontEpBg}
        frontEpText={frontEpText}
        frontEpTextStyle={frontEpTextStyle}
        backEpBg={backEpBg}
        backEpText={backEpText}
        backEpTextStyle={backEpTextStyle}
        backCoverFeaturedStories={backCoverFeaturedStories}
        backCoverQrUrl={backCoverQrUrl}
        backCoverWebsiteText={backCoverWebsiteText}
      />
      {/* Page label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/40 to-transparent pt-4 pb-1.5 px-2 text-center">
        <span className="text-white text-[10px] font-medium drop-shadow">{pageLabel(pg)}</span>
      </div>
      {active && (
        <div className="absolute top-2 left-2 bg-brand-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          Editing
        </div>
      )}
    </div>
  );
}

// ── Right panel editors ───────────────────────────────────────────────────────

function CoverPanel({
  story, layout, onPickScene, onLayoutChange, onSave, saving, saved,
}: {
  story: StoryRow;
  layout: CoverLayout;
  onPickScene: (url: string, urlGirl?: string | null) => void;
  onLayoutChange: <K extends keyof CoverLayout>(key: K, val: CoverLayout[K]) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  const approvedPages = (story as StoryRow & { _approvedPages?: StoryPageRow[] })._approvedPages ?? [];

  return (
    <div className="space-y-5">
      {/* Scene picker */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cover image</p>
        {approvedPages.length === 0 ? (
          <p className="text-xs text-amber-500">Approve scenes in the Scenes tab first.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {approvedPages.filter((p: StoryPageRow) => p.image_url).map((page: StoryPageRow) => {
              const isSelected = story.cover_image_url === page.image_url;
              return (
                <button
                  key={page.id}
                  onClick={() => onPickScene(page.image_url!, page.image_url_girl)}
                  className={`rounded-lg overflow-hidden border-2 transition-colors relative ${
                    isSelected ? "border-brand-500" : "border-gray-200 hover:border-brand-300"
                  }`}
                >
                  <div className="flex items-center justify-between px-1.5 py-0.5 bg-gray-50 border-b border-gray-100">
                    <span className="text-[10px] font-medium text-gray-500">p.{page.page_number}</span>
                    {isSelected && <span className="text-[10px] text-brand-500 font-bold">✓</span>}
                  </div>
                  <div className="grid grid-cols-2">
                    <div className="relative">
                      <img src={page.image_url!} alt="boy" className="w-full aspect-[4/3] object-cover" />
                      <span className="absolute bottom-0.5 left-0.5 text-[10px] bg-black/50 text-white px-1 rounded">👦</span>
                    </div>
                    <div className="relative">
                      {page.image_url_girl
                        ? <>
                            <img src={page.image_url_girl} alt="girl" className="w-full aspect-[4/3] object-cover" />
                            <span className="absolute bottom-0.5 left-0.5 text-[10px] bg-black/50 text-white px-1 rounded">👧</span>
                          </>
                        : <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">No girl</div>
                      }
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Font */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Font</p>
        <div className="space-y-1">
          {FONT_OPTIONS.slice(0, 5).map((opt) => (
            <button
              key={opt.cssFamily}
              onClick={() => onLayoutChange("fontFamily", opt.cssFamily)}
              className={`w-full text-left px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                layout.fontFamily === opt.cssFamily
                  ? "border-brand-400 bg-brand-50 text-brand-700"
                  : "border-gray-200 hover:border-gray-300 text-gray-700"
              }`}
              style={{ fontFamily: opt.cssFamily }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Title size */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Title size <span className="font-normal text-gray-400">{(layout.titleSize ?? 8).toFixed(1)}%</span>
        </p>
        <input type="range" min="4" max="14" step="0.5" value={layout.titleSize ?? 8}
          onChange={(e) => onLayoutChange("titleSize", parseFloat(e.target.value))}
          className="w-full accent-brand-500" />
      </div>

      {/* Subtitle */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Subtitle</p>
        <input
          value={layout.subtitle}
          onChange={(e) => onLayoutChange("subtitle", e.target.value)}
          placeholder="A story starring {{hero_name}}"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* Subtitle size */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Subtitle size <span className="font-normal text-gray-400">{(layout.subtitleSize ?? 4.5).toFixed(1)}%</span>
        </p>
        <input type="range" min="2" max="8" step="0.5" value={layout.subtitleSize ?? 4.5}
          onChange={(e) => onLayoutChange("subtitleSize", parseFloat(e.target.value))}
          className="w-full accent-brand-500" />
      </div>

      {/* Colours */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Title colour</p>
          <div className="flex items-center gap-1.5">
            <input type="color" value={layout.titleColor} onChange={(e) => onLayoutChange("titleColor", e.target.value)}
              className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
            <div className="flex gap-1">
              {["#ffffff", "#fdf6e3", "#ffe4e1", "#e0f0ff"].map((c) => (
                <button key={c} onClick={() => onLayoutChange("titleColor", c)}
                  className={`w-5 h-5 rounded-full border-2 ${layout.titleColor === c ? "border-brand-500" : "border-gray-200"}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Subtitle colour</p>
          <div className="flex items-center gap-1.5">
            <input type="color" value={layout.subtitleColor} onChange={(e) => onLayoutChange("subtitleColor", e.target.value)}
              className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
            <div className="flex gap-1">
              {["#ffffff", "#f0e6ff", "#ffecd2", "#d4f5d4"].map((c) => (
                <button key={c} onClick={() => onLayoutChange("subtitleColor", c)}
                  className={`w-5 h-5 rounded-full border-2 ${layout.subtitleColor === c ? "border-brand-500" : "border-gray-200"}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Overlay */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Overlay darkness <span className="font-normal">{Math.round(layout.overlayOpacity * 100)}%</span>
        </p>
        <input type="range" min="0" max="0.85" step="0.05" value={layout.overlayOpacity}
          onChange={(e) => onLayoutChange("overlayOpacity", parseFloat(e.target.value))}
          className="w-full accent-brand-500" />
      </div>

      <button
        onClick={onSave}
        disabled={saving}
        className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
      >
        {saving && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
        {saving ? "Saving…" : saved ? "✓ Saved" : "Save cover"}
      </button>
    </div>
  );
}

function TextPanel({
  page, textStyle, onStyleChange, onSavePage, onSaveAll, saving, savedCount, totalCount,
}: {
  page: StoryPageRow;
  textStyle: TextStyle;
  onStyleChange: (s: TextStyle) => void;
  onSavePage: (id: string) => void;
  onSaveAll: () => void;
  saving: "page" | "all" | null;
  savedCount: number;
  totalCount: number;
}) {
  function set<K extends keyof TextStyle>(key: K, value: TextStyle[K]) {
    onStyleChange({ ...textStyle, [key]: value });
  }

  return (
    <div className="space-y-4">
      {/* Font */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Font</p>
        <div className="space-y-1">
          {FONT_OPTIONS.map((opt) => (
            <button
              key={opt.cssFamily}
              onClick={() => set("fontFamily", opt.cssFamily)}
              className={`w-full text-left px-3 py-1.5 rounded-lg border transition-colors ${
                textStyle.fontFamily === opt.cssFamily
                  ? "border-brand-400 bg-brand-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <span className="block text-sm" style={{ fontFamily: opt.cssFamily, color: textStyle.fontFamily === opt.cssFamily ? "#6d28d9" : "#374151" }}>
                {opt.label}
              </span>
              <span className="block text-xs text-gray-400">{opt.style}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Size */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Size <span className="font-normal text-gray-400">{textStyle.fontSizePct.toFixed(1)}%</span>
        </p>
        <input type="range" min="2" max="10" step="0.5" value={textStyle.fontSizePct}
          onChange={(e) => set("fontSizePct", parseFloat(e.target.value))}
          className="w-full accent-brand-500" />
      </div>

      {/* Text colour */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Text colour</p>
        <div className="flex items-center gap-2">
          <input type="color" value={textStyle.color} onChange={(e) => set("color", e.target.value)}
            className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
          <div className="flex gap-1">
            {["#1c1c1e", "#ffffff", "#2d3748", "#7b341e"].map((c) => (
              <button key={c} onClick={() => set("color", c)}
                className={`w-5 h-5 rounded-full border-2 ${textStyle.color === c ? "border-brand-500" : "border-gray-200"}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
      </div>

      {/* Panel bg */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Panel bg <span className="font-normal text-gray-400">{Math.round(textStyle.bgOpacity * 100)}%</span>
        </p>
        <div className="flex items-center gap-2 mb-1.5">
          <input type="color" value={textStyle.bgColor} onChange={(e) => set("bgColor", e.target.value)}
            className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
          <div className="flex gap-1">
            {["#ffffff", "#fdf6e3", "#1c1c1e", "#f0f4ff"].map((c) => (
              <button key={c} onClick={() => set("bgColor", c)}
                className={`w-5 h-5 rounded-full border-2 ${textStyle.bgColor === c ? "border-brand-500" : "border-gray-200"}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <input type="range" min="0" max="1" step="0.05" value={textStyle.bgOpacity}
          onChange={(e) => set("bgOpacity", parseFloat(e.target.value))}
          className="w-full accent-brand-500" />
      </div>

      {/* Alignment */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Alignment</p>
        <div className="flex gap-1.5">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} onClick={() => set("alignment", a)}
              className={`flex-1 py-1.5 rounded-lg border text-xs transition-colors ${
                textStyle.alignment === a
                  ? "border-brand-400 bg-brand-50 text-brand-700"
                  : "border-gray-200 hover:border-gray-300 text-gray-500"
              }`}
            >
              {a === "left" ? "Left" : a === "center" ? "Center" : "Right"}
            </button>
          ))}
        </div>
      </div>

      {/* Save buttons */}
      <div className="space-y-1.5 pt-1">
        <button
          onClick={() => onSavePage(page.id)}
          disabled={saving !== null}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          {saving === "page" && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
          {saving === "page" ? "Saving…" : "Save this page"}
        </button>
        <button
          onClick={onSaveAll}
          disabled={saving !== null}
          className="w-full bg-white hover:bg-gray-50 disabled:opacity-60 border border-gray-200 text-gray-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          {saving === "all" && <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-600 rounded-full animate-spin" />}
          {saving === "all" ? "Saving all…" : `Save all pages (${savedCount}/${totalCount} done)`}
        </button>
      </div>
    </div>
  );
}

function BookTextField({
  label, description, value, onChange, rows, placeholder,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-gray-700">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      {rows === 1 ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none placeholder:text-gray-300"
        />
      )}
      <p className="text-xs text-gray-400">
        Use <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600">{"{{hero_name}}"}</code> — replaced with the child's name at order time.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BookPagesEditor({ story, pages, trimSizes }: Props) {
  const [, startTransition] = useTransition();

  // Inject fonts
  useEffect(() => {
    if (document.getElementById("kitabee-google-fonts")) return;
    const link = document.createElement("link");
    link.id = "kitabee-google-fonts";
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    document.head.appendChild(link);
  }, []);

  // Book text state
  const [endPageText, setEndPageText] = useState(story.end_page_text ?? "The End");

  // Cover state
  const [coverUrl, setCoverUrlState] = useState(story.cover_image_url ?? "");
  const [layout, setLayout] = useState<CoverLayout>(story.cover_layout ?? DEFAULT_COVER_LAYOUT);

  // Text style state
  const [textStyle, setTextStyle] = useState<TextStyle>(story.text_style ?? DEFAULT_TEXT_STYLE);
  const [savedTextImages, setSavedTextImages] = useState<Record<string, string>>(
    Object.fromEntries(pages.filter((p) => p.text_image_url).map((p) => [p.id, p.text_image_url!]))
  );

  // Front endpaper
  const [frontEpBg, setFrontEpBg] = useState<TextPanelBg>(story.front_endpaper_bg ?? { type: "solid", color: "#f5f0e8" });
  const [frontEpText, setFrontEpText] = useState(story.front_endpaper_text ?? "");
  const [frontEpStyle, setFrontEpStyle] = useState<TextStyle>(story.front_endpaper_text_style ?? DEFAULT_TEXT_STYLE);

  // Back endpaper
  const [backEpBg, setBackEpBg] = useState<TextPanelBg>(story.back_endpaper_bg ?? { type: "solid", color: "#f5f0e8" });
  const [backEpText, setBackEpText] = useState(story.back_endpaper_text ?? story.dedication_text ?? "");
  const [backEpStyle, setBackEpStyle] = useState<TextStyle>(story.back_endpaper_text_style ?? DEFAULT_TEXT_STYLE);

  // Back cover
  const [featuredStoryIds, setFeaturedStoryIds] = useState<string[]>(story.back_cover_featured_story_ids ?? []);
  const [backCoverQrUrl, setBackCoverQrUrl] = useState(story.back_cover_website_qr_url ?? "");
  const [backCoverWebsiteText, setBackCoverWebsiteText] = useState(story.back_cover_website_text ?? "");
  const [publishedStories, setPublishedStories] = useState<FeaturedStory[]>([]);

  // Saving states
  const [bookSaving, setBookSaving] = useState(false);
  const [bookSaved, setBookSaved] = useState(false);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverSaved, setCoverSaved] = useState(false);
  const [textSaving, setTextSaving] = useState<"page" | "all" | null>(null);
  const [epSaving, setEpSaving] = useState(false);
  const [epSaved, setEpSaved] = useState(false);
  const [bcSaving, setBcSaving] = useState(false);
  const [bcSaved, setBcSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load published stories for back cover
  useEffect(() => {
    fetchPublishedStories(story.id).then(setPublishedStories).catch(() => {});
  }, [story.id]);

  // Real Gelato cover geometry (spine width, exact wraparound aspect ratio) --
  // only used for the exterior (cover) spread; every other spread uses the
  // trim-size-derived aspect ratio below.
  const [coverPreviewData, setCoverPreviewData] = useState<CoverPreviewData | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCoverPreviewData(story.id).then((data) => {
      if (!cancelled) setCoverPreviewData(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [story.id]);
  const coverZones = coverPreviewData?.dims ? computeCoverZones(coverPreviewData.dims) : null;

  // Derive page aspect ratio from trim size (default square 1:1 if not set)
  const trimSize = trimSizes.find((t) => t.id === story.trim_size_id) ?? null;
  const pageW = trimSize?.width_in ?? 1;
  const pageH = trimSize?.height_in ?? 1;
  const spreadAspectRatio = `${pageW * 2} / ${pageH}`;

  // Spread navigation — start on exterior (spread 0), active page = cover (right side)
  const spreads = buildSpreads(pages, story.layout_type ?? "split_image_left");
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [activeKey, setActiveKey] = useState<string>("cover");

  const currentSpread = spreads[spreadIndex];

  // Resolve active PageDef from key
  function findPageByKey(key: string): PageDef | null {
    for (const s of spreads) {
      if (pageKey(s.left) === key) return s.left;
      if (s.right && pageKey(s.right) === key) return s.right;
    }
    return null;
  }

  // activeKey can be "spine" which is not a PageDef key
  const activePage = activeKey === "spine" ? null : findPageByKey(activeKey);

  // Attach approved pages to story object for CoverPanel
  const approvedPages = pages.filter((p) => p.image_approved);
  const storyWithApproved = Object.assign(Object.create(Object.getPrototypeOf(story)), story, {
    cover_image_url: coverUrl || story.cover_image_url,
    _approvedPages: approvedPages,
  });

  // The featured stories resolved from ids
  const featuredStoriesResolved: FeaturedStory[] = featuredStoryIds
    .map(id => publishedStories.find(s => s.id === id))
    .filter((s): s is FeaturedStory => !!s);

  // ── Sidebar navigation ─────────────────────────────────────────────────────

  function findSpreadIndex(key: string): number {
    return spreads.findIndex(s => pageKey(s.left) === key || (s.right && pageKey(s.right) === key));
  }

  function navTo(key: string, spreadIdx?: number) {
    setActiveKey(key);
    const si = spreadIdx !== undefined ? spreadIdx : findSpreadIndex(key);
    if (si >= 0) setSpreadIndex(si);
  }

  // Build sidebar nav items
  type NavItem = { key: string; label: string; icon: string; spreadIdx: number };

  const exteriorItems: NavItem[] = [
    { key: "cover", label: "Front Cover", icon: "🖼️", spreadIdx: 0 },
    { key: "spine", label: "Spine", icon: "▌", spreadIdx: 0 },
    { key: "back", label: "Back Cover", icon: "🖼️", spreadIdx: 0 },
  ];

  const interiorItems: NavItem[] = [];
  interiorItems.push({ key: "front-endpaper", label: "Front Endpaper", icon: "📄", spreadIdx: findSpreadIndex("front-endpaper") });
  interiorItems.push({ key: "title", label: "Title Page", icon: "📖", spreadIdx: findSpreadIndex("title") });

  if (story.layout_type === "split_image_left" || story.layout_type === "split_image_right") {
    for (const p of pages) {
      const imageKey = story.layout_type === "split_image_left" ? `story-image-${p.id}` : `story-text-${p.id}`;
      interiorItems.push({
        key: imageKey,
        label: `Page ${p.page_number}`,
        icon: "🖼",
        spreadIdx: findSpreadIndex(imageKey),
      });
    }
  } else {
    for (const p of pages) {
      interiorItems.push({
        key: `story-${p.id}`,
        label: `Page ${p.page_number}`,
        icon: "📝",
        spreadIdx: findSpreadIndex(`story-${p.id}`),
      });
    }
  }

  interiorItems.push({ key: "end", label: "End Page", icon: "🏁", spreadIdx: findSpreadIndex("end") });
  interiorItems.push({ key: "back-endpaper", label: "Back Endpaper", icon: "📄", spreadIdx: findSpreadIndex("back-endpaper") });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleLayoutChange<K extends keyof CoverLayout>(key: K, val: CoverLayout[K]) {
    setLayout((prev) => ({ ...prev, [key]: val }));
    setCoverSaved(false);
  }

  function handlePickScene(imageUrl: string, imageUrlGirl?: string | null) {
    setCoverUrlState(imageUrl);
    setCoverSaved(false);
    startTransition(async () => {
      try {
        await setCoverImage(story.id, imageUrl, imageUrlGirl);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function handleSaveCover() {
    setCoverSaving(true);
    setError(null);
    startTransition(async () => {
      try {
        await saveCoverLayout(story.id, layout, story.back_cover_tagline ?? null);
        setCoverSaved(true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCoverSaving(false);
      }
    });
  }

  function handleSaveBookText() {
    setBookSaving(true);
    setError(null);
    setBookSaved(false);
    startTransition(async () => {
      try {
        await saveBookPages(story.id, {
          end_page_text: endPageText || "The End",
        });
        setBookSaved(true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBookSaving(false);
      }
    });
  }

  async function handleSaveFrontEndpaper() {
    setEpSaving(true); setEpSaved(false);
    try {
      await saveEndpaperSettings(story.id, {
        front_endpaper_bg: frontEpBg,
        front_endpaper_text: frontEpText || null,
        front_endpaper_text_style: frontEpStyle,
      });
      setEpSaved(true); setTimeout(() => setEpSaved(false), 2500);
    } catch(e) { setError((e as Error).message); }
    finally { setEpSaving(false); }
  }

  async function handleSaveBackEndpaper() {
    setEpSaving(true); setEpSaved(false);
    try {
      await saveEndpaperSettings(story.id, {
        back_endpaper_bg: backEpBg,
        back_endpaper_text: backEpText || null,
        back_endpaper_text_style: backEpStyle,
      });
      // Also save dedication_text for compatibility
      await saveBookPages(story.id, { dedication_text: backEpText || null });
      setEpSaved(true); setTimeout(() => setEpSaved(false), 2500);
    } catch(e) { setError((e as Error).message); }
    finally { setEpSaving(false); }
  }

  async function handleSaveBackCover() {
    setBcSaving(true); setBcSaved(false);
    try {
      await saveBackCoverSettings(story.id, {
        back_cover_featured_story_ids: featuredStoryIds,
      });
      setBcSaved(true); setTimeout(() => setBcSaved(false), 2500);
    } catch(e) { setError((e as Error).message); }
    finally { setBcSaving(false); }
  }

  function handleSavePage(pageId: string) {
    setTextSaving("page");
    setError(null);
    startTransition(async () => {
      try {
        const [results] = await Promise.all([
          compositeTextOnPages(story.id, [pageId], textStyle),
          saveTextStyle(story.id, textStyle),
        ]);
        setSavedTextImages((prev) => {
          const next = { ...prev };
          for (const r of results) next[r.pageId] = r.textImageUrl;
          return next;
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setTextSaving(null);
      }
    });
  }

  function handleSaveAll() {
    setTextSaving("all");
    setError(null);
    startTransition(async () => {
      try {
        const [results] = await Promise.all([
          compositeTextOnPages(story.id, undefined, textStyle),
          saveTextStyle(story.id, textStyle),
        ]);
        setSavedTextImages((prev) => {
          const next = { ...prev };
          for (const r of results) next[r.pageId] = r.textImageUrl;
          return next;
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setTextSaving(null);
      }
    });
  }

  const savedCount = Object.keys(savedTextImages).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="flex gap-0 items-start">
        {/* ── Left sidebar ── */}
        <div className="w-48 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto flex flex-col gap-0.5 py-3 px-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-2 pb-1">Exterior</p>
          {exteriorItems.map((item) => (
            <button
              key={item.key}
              onClick={() => navTo(item.key, item.spreadIdx)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${
                activeKey === item.key ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
          <div className="border-t border-gray-200 mt-2 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-2 pb-1">Interior</p>
            {interiorItems.map((item) => (
              <button
                key={item.key}
                onClick={() => navTo(item.key, item.spreadIdx)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${
                  activeKey === item.key ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Center: book spread ── */}
        <div className="flex-1 min-w-0 px-4 space-y-3">
          {/* Context label */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              currentSpread.exterior
                ? "bg-gray-800 text-white"
                : "bg-blue-50 text-blue-700"
            }`}>
              {currentSpread.exterior ? "Outside" : "Inside"}
            </span>
            <span className="text-xs text-gray-400">
              {currentSpread.exterior
                ? "The closed book — front and back covers"
                : currentSpread.left.kind === "story-image" && currentSpread.right?.kind === "story-text"
                  ? `Page ${currentSpread.left.page.page_number} — image · text`
                  : `${pageLabel(currentSpread.left)}${currentSpread.right ? ` · ${pageLabel(currentSpread.right)}` : ""}`}
            </span>
            {trimSize && (
              <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {trimSize.width_in}" × {trimSize.height_in}"
              </span>
            )}
            {!trimSize && (
              <span className="ml-auto text-xs text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">
                Set trim size in Print tab
              </span>
            )}
          </div>

          {/* Spread */}
          <div
            className={`w-full overflow-hidden shadow-xl bg-white relative ${
              currentSpread.exterior
                ? "rounded-2xl border-2 border-gray-800"
                : "rounded-2xl border border-gray-300"
            }`}
            style={{ aspectRatio: currentSpread.exterior && coverZones ? coverZones.aspectRatio : spreadAspectRatio }}
          >
            <div className="w-full h-full flex">
              <SpreadPage
                pg={currentSpread.left}
                active={activeKey === pageKey(currentSpread.left)}
                story={storyWithApproved}
                layout={layout}
                textStyle={textStyle}
                endPageText={endPageText}
                savedTextImages={savedTextImages}
                frontEpBg={frontEpBg}
                frontEpText={frontEpText}
                frontEpTextStyle={frontEpStyle}
                backEpBg={backEpBg}
                backEpText={backEpText}
                backEpTextStyle={backEpStyle}
                backCoverFeaturedStories={featuredStoriesResolved}
                backCoverQrUrl={backCoverQrUrl}
                backCoverWebsiteText={backCoverWebsiteText}
                onClick={() => setActiveKey(pageKey(currentSpread.left))}
              />
              {/* Spine */}
              {currentSpread.exterior && coverZones ? (
                <div
                  className={`absolute top-0 bottom-0 pointer-events-none ${activeKey === "spine" ? "bg-brand-500" : "bg-gray-800"}`}
                  style={{ left: `${coverZones.spineLeftPct}%`, width: `${coverZones.spineWidthPct}%` }}
                />
              ) : (
                <div className={`shrink-0 ${currentSpread.exterior
                  ? activeKey === "spine" ? "w-3 bg-brand-500" : "w-2 bg-gray-800"
                  : "w-px bg-gray-300"}`}
                  style={currentSpread.exterior ? undefined : { boxShadow: "0 0 8px rgba(0,0,0,0.12)" }} />
              )}
              <SpreadPage
                pg={currentSpread.right}
                active={currentSpread.right ? activeKey === pageKey(currentSpread.right) : false}
                story={storyWithApproved}
                layout={layout}
                textStyle={textStyle}
                endPageText={endPageText}
                savedTextImages={savedTextImages}
                frontEpBg={frontEpBg}
                frontEpText={frontEpText}
                frontEpTextStyle={frontEpStyle}
                backEpBg={backEpBg}
                backEpText={backEpText}
                backEpTextStyle={backEpStyle}
                backCoverFeaturedStories={featuredStoriesResolved}
                backCoverQrUrl={backCoverQrUrl}
                backCoverWebsiteText={backCoverWebsiteText}
                onClick={() => currentSpread.right && setActiveKey(pageKey(currentSpread.right))}
              />
            </div>
          </div>
        </div>

        {/* ── Right: editor panel ── */}
        <div className="w-72 shrink-0">
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4 max-h-[80vh] overflow-y-auto">

            {activeKey === "spine" && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">Spine</h3>
                <p className="text-xs text-gray-400">Auto-colored from your cover. Spine text is omitted when Gelato's spine is too narrow to fit (under 10mm).</p>
                <div className="bg-gray-50 rounded-lg px-3 py-3 text-xs text-gray-500 space-y-1">
                  <p><span className="font-medium">Title:</span> {story.title}</p>
                  <p><span className="font-medium">Color:</span> Matches front cover</p>
                </div>
              </>
            )}

            {activePage?.kind === "cover" && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">Front Cover</h3>
                <CoverPanel
                  story={storyWithApproved}
                  layout={layout}
                  onPickScene={handlePickScene}
                  onLayoutChange={handleLayoutChange}
                  onSave={handleSaveCover}
                  saving={coverSaving}
                  saved={coverSaved}
                />
              </>
            )}

            {activePage?.kind === "title" && (
              <div className="text-center py-6">
                <p className="text-sm font-semibold text-gray-500">Title page</p>
                <p className="text-xs text-gray-400 mt-1">Auto-generated from the story title.</p>
              </div>
            )}

            {activePage?.kind === "front-endpaper" && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">Front Endpaper — Note to the Reader</h3>
                <p className="text-xs text-gray-400">A personal note from the gift-giver. Supports {"{{hero_name}}"}.</p>
                <EndpaperBgPicker bg={frontEpBg} onChange={setFrontEpBg} />
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Note text</label>
                  <textarea value={frontEpText} onChange={e => setFrontEpText(e.target.value)} rows={5}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder={"Dear {{hero_name}},\n\nThis book was made just for you…"} />
                </div>
                <EndpaperStylePicker style={frontEpStyle} onChange={setFrontEpStyle} />
                <SaveButton onClick={handleSaveFrontEndpaper} saving={epSaving} saved={epSaved} />
              </>
            )}

            {activePage?.kind === "back-endpaper" && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">Back Endpaper — Dedication</h3>
                <p className="text-xs text-gray-400">A dedication message. Supports {"{{hero_name}}"}.</p>
                <EndpaperBgPicker bg={backEpBg} onChange={setBackEpBg} />
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Dedication text</label>
                  <textarea value={backEpText} onChange={e => setBackEpText(e.target.value)} rows={5}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder={"For {{hero_name}}, the bravest adventurer I know…"} />
                </div>
                <EndpaperStylePicker style={backEpStyle} onChange={setBackEpStyle} />
                <SaveButton onClick={handleSaveBackEndpaper} saving={epSaving} saved={epSaved} />
              </>
            )}

            {activePage?.kind === "story" && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">
                  Page {activePage.page.page_number}
                  {savedTextImages[activePage.page.id] && (
                    <span className="ml-2 text-xs font-normal text-green-600">✓ composited</span>
                  )}
                </h3>
                <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 italic leading-relaxed">
                  "{activePage.page.text}"
                </p>
                <TextPanel
                  page={activePage.page}
                  textStyle={textStyle}
                  onStyleChange={setTextStyle}
                  onSavePage={handleSavePage}
                  onSaveAll={handleSaveAll}
                  saving={textSaving}
                  savedCount={savedCount}
                  totalCount={pages.filter((p) => p.image_url).length}
                />
              </>
            )}

            {activePage?.kind === "story-image" && (
              <div className="text-center py-6 space-y-2">
                <p className="text-sm font-semibold text-gray-700">Page {activePage.page.page_number} — Image</p>
                <p className="text-xs text-gray-400">Full-bleed illustration. Click the text page (right side) to edit text style.</p>
              </div>
            )}

            {activePage?.kind === "story-text" && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">
                  Page {activePage.page.page_number} — Text
                  {savedTextImages[activePage.page.id] && (
                    <span className="ml-2 text-xs font-normal text-green-600">✓ composited</span>
                  )}
                </h3>
                <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 italic leading-relaxed">
                  "{activePage.page.text}"
                </p>
                <TextPanel
                  page={activePage.page}
                  textStyle={textStyle}
                  onStyleChange={setTextStyle}
                  onSavePage={handleSavePage}
                  onSaveAll={handleSaveAll}
                  saving={textSaving}
                  savedCount={savedCount}
                  totalCount={pages.filter((p) => p.image_url).length}
                />
              </>
            )}

            {activePage?.kind === "end" && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">End Page</h3>
                <BookTextField
                  label="End page text"
                  description="Shown after the last story scene."
                  value={endPageText}
                  onChange={(v) => { setEndPageText(v); setBookSaved(false); }}
                  rows={1}
                  placeholder="The End"
                />
                <button
                  onClick={handleSaveBookText}
                  disabled={bookSaving}
                  className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {bookSaving && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
                  {bookSaving ? "Saving…" : bookSaved ? "✓ Saved" : "Save"}
                </button>
              </>
            )}

            {activePage?.kind === "back" && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">Back Cover</h3>
                {/* Story picker */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Featured stories ("Have you read?")</label>
                  <p className="text-[11px] text-gray-400 mb-2">Select up to 4 published stories to feature.</p>
                  {publishedStories.length === 0 ? (
                    <p className="text-[11px] text-gray-300 italic">No other published stories yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {publishedStories.map(s => {
                        const selected = featuredStoryIds.includes(s.id);
                        return (
                          <button key={s.id} onClick={() => {
                            if (selected) setFeaturedStoryIds(prev => prev.filter(id => id !== s.id));
                            else if (featuredStoryIds.length < 4) setFeaturedStoryIds(prev => [...prev, s.id]);
                          }}
                          className={`relative rounded-lg overflow-hidden border-2 text-left transition-all ${selected ? "border-brand-500" : "border-gray-200 hover:border-gray-400"}`}>
                            {s.cover_image_url ? (
                              <img src={s.cover_image_url} alt={s.title} className="w-full aspect-square object-cover" style={{ objectPosition: "right center" }} />
                            ) : (
                              <div className="w-full aspect-square bg-gray-100 flex items-center justify-center text-gray-300 text-xs">No cover</div>
                            )}
                            <div className={`px-1.5 py-1 text-[9px] font-medium truncate ${selected ? "bg-brand-500 text-white" : "bg-gray-50 text-gray-600"}`}>{s.title}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* QR URL */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">QR code URL</label>
                  <input type="url" value={backCoverQrUrl} onChange={e => setBackCoverQrUrl(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="https://flippingsmiles.com" />
                </div>
                {/* Website text */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Website / tagline text</label>
                  <input type="text" value={backCoverWebsiteText} onChange={e => setBackCoverWebsiteText(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="flippingsmiles.com — personalised books for every child" />
                </div>
                <SaveButton onClick={handleSaveBackCover} saving={bcSaving} saved={bcSaved} />
              </>
            )}

            {/* Fallback when nothing is active */}
            {!activePage && activeKey !== "spine" && (
              <div className="text-center py-6">
                <p className="text-xs text-gray-400">Select a page from the sidebar to edit it.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
