"use client";

import { useState, useTransition, useEffect } from "react";
import { compositeTextOnPages } from "./backgrounds/text/actions";
import { saveTextStyle } from "./text-style/actions";
import type { StoryRow, StoryPageRow } from "@/lib/supabase/types";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "@/lib/supabase/types";
import { FONT_OPTIONS, FONT_CATEGORIES, GOOGLE_FONTS_URL } from "@/lib/fonts";

interface Props {
  story: StoryRow;
  pages: StoryPageRow[];
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function PagePreview({
  page,
  style,
  onClick,
  saved,
}: {
  page: StoryPageRow;
  style: TextStyle;
  onClick?: () => void;
  saved?: boolean;
}) {
  const imageUrl = page.image_url;
  if (!imageUrl) {
    return (
      <div className="aspect-[4/3] rounded-xl bg-gray-100 border border-dashed border-gray-200 flex items-center justify-center">
        <span className="text-xs text-gray-400">No scene yet</span>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-xl overflow-hidden border-2 cursor-pointer group transition-colors ${saved ? "border-green-400" : "border-gray-200 hover:border-brand-400"}`}
      style={{ aspectRatio: "4/3" }}
      onClick={onClick}
    >
      <img src={imageUrl} alt={`Page ${page.page_number}`} className="w-full h-full object-cover" />
      {/* Text overlay — 20% from bottom */}
      <div
        className="absolute left-0 right-0 flex items-center"
        style={{
          height: "25%",
          bottom: "4%",
          backgroundColor: `rgba(${hexToRgb(style.bgColor)}, ${style.bgOpacity})`,
          padding: "0 6%",
        }}
      >
        <p
          style={{
            fontFamily: style.fontFamily,
            fontSize: `${style.fontSizePct}cqh`,
            color: style.color,
            textAlign: style.alignment,
            lineHeight: 1.55,
            width: "100%",
            containerType: "size",
          }}
        >
          {page.text}
        </p>
      </div>
      {saved && (
        <div className="absolute top-2 left-2 bg-green-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
          ✓ Saved
        </div>
      )}
      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <span className="bg-white text-gray-800 text-xs font-medium px-3 py-1.5 rounded-lg">Edit</span>
      </div>
    </div>
  );
}

function StyleControls({
  style,
  onChange,
}: {
  style: TextStyle;
  onChange: (s: TextStyle) => void;
}) {
  function set<K extends keyof TextStyle>(key: K, value: TextStyle[K]) {
    onChange({ ...style, [key]: value });
  }

  return (
    <div className="space-y-5">
      {/* Font family */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Font</label>
        <div className="space-y-4">
          {FONT_CATEGORIES.map((cat) => (
            <div key={cat.id}>
              <p className="text-xs text-gray-400 font-medium mb-1.5">{cat.label}</p>
              <div className="space-y-1">
                {FONT_OPTIONS.filter((f) => f.category === cat.id).map((opt) => (
                  <button
                    key={opt.cssFamily}
                    onClick={() => set("fontFamily", opt.cssFamily)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center justify-between gap-3 ${
                      style.fontFamily === opt.cssFamily
                        ? "border-brand-400 bg-brand-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span
                      className="text-lg leading-tight truncate"
                      style={{ fontFamily: opt.cssFamily, color: style.fontFamily === opt.cssFamily ? "#6d28d9" : "#1f2937" }}
                    >
                      The quick brown fox
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Size <span className="font-normal normal-case text-gray-400 ml-1">{style.fontSizePct.toFixed(1)}% of height</span>
        </label>
        <input
          type="range"
          min="2"
          max="10"
          step="0.5"
          value={style.fontSizePct}
          onChange={(e) => set("fontSizePct", parseFloat(e.target.value))}
          className="w-full accent-brand-500"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>Small</span>
          <span>Large</span>
        </div>
      </div>

      {/* Text color */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Text colour</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={style.color}
            onChange={(e) => set("color", e.target.value)}
            className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
          />
          <span className="text-sm font-mono text-gray-500">{style.color}</span>
          <div className="flex gap-1.5 ml-auto">
            {["#1c1c1e", "#ffffff", "#2d3748", "#7b341e"].map((c) => (
              <button
                key={c}
                onClick={() => set("color", c)}
                className={`w-6 h-6 rounded-full border-2 transition-colors ${style.color === c ? "border-brand-500" : "border-gray-200"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Panel background */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Panel background</label>
        <div className="flex items-center gap-3 mb-2">
          <input
            type="color"
            value={style.bgColor}
            onChange={(e) => set("bgColor", e.target.value)}
            className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
          />
          <span className="text-sm font-mono text-gray-500">{style.bgColor}</span>
          <div className="flex gap-1.5 ml-auto">
            {["#ffffff", "#fdf6e3", "#1c1c1e", "#f0f4ff"].map((c) => (
              <button
                key={c}
                onClick={() => set("bgColor", c)}
                className={`w-6 h-6 rounded-full border-2 transition-colors ${style.bgColor === c ? "border-brand-500" : "border-gray-200"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={style.bgOpacity}
            onChange={(e) => set("bgOpacity", parseFloat(e.target.value))}
            className="flex-1 accent-brand-500"
          />
          <span className="text-xs text-gray-500 w-10 text-right">{Math.round(style.bgOpacity * 100)}%</span>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>Transparent</span>
          <span>Solid</span>
        </div>
      </div>

      {/* Horizontal alignment */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Alignment</label>
        <div className="flex gap-2">
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              onClick={() => set("alignment", a)}
              className={`flex-1 py-1.5 rounded-lg border text-sm transition-colors ${
                style.alignment === a
                  ? "border-brand-400 bg-brand-50 text-brand-700"
                  : "border-gray-200 hover:border-gray-400 text-gray-500"
              }`}
            >
              {a === "left" ? "⬅" : a === "center" ? "⬛" : "➡"}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

export function TextEditor({ story, pages: initialPages }: Props) {
  const [, startTransition] = useTransition();
  const [style, setStyle] = useState<TextStyle>(story.text_style ?? DEFAULT_TEXT_STYLE);

  // Inject Google Fonts into the page once on mount
  useEffect(() => {
    if (document.getElementById("kitabee-google-fonts")) return;
    const link = document.createElement("link");
    link.id = "kitabee-google-fonts";
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    document.head.appendChild(link);
  }, []);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [savedTextImages, setSavedTextImages] = useState<Record<string, string>>(
    Object.fromEntries(initialPages.filter((p) => p.text_image_url).map((p) => [p.id, p.text_image_url!]))
  );
  const [saving, setSaving] = useState<"page" | "all" | null>(null);
  const [styleSaving, setStyleSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagesWithScenes = initialPages.filter((p) => p.image_url);
  const selectedPage = selectedPageId ? pagesWithScenes.find((p) => p.id === selectedPageId) : null;
  const selectedIndex = selectedPage ? pagesWithScenes.indexOf(selectedPage) : -1;

  function handleStyleChange(next: TextStyle) {
    setStyle(next);
  }

  function handleSaveStyle() {
    setStyleSaving(true);
    startTransition(async () => {
      try {
        await saveTextStyle(story.id, style);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setStyleSaving(false);
      }
    });
  }

  function handleSavePage(pageId: string) {
    setSaving("page");
    setError(null);
    startTransition(async () => {
      try {
        const results = await compositeTextOnPages(story.id, [pageId], style);
        setSavedTextImages((prev) => {
          const next = { ...prev };
          for (const r of results) next[r.pageId] = r.textImageUrl;
          return next;
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(null);
      }
    });
  }

  function handleSaveAll() {
    setSaving("all");
    setError(null);
    startTransition(async () => {
      try {
        const results = await compositeTextOnPages(story.id, undefined, style);
        setSavedTextImages((prev) => {
          const next = { ...prev };
          for (const r of results) next[r.pageId] = r.textImageUrl;
          return next;
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(null);
      }
    });
  }

  if (pagesWithScenes.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
        Generate scene images in the <strong>Scenes</strong> tab first.
      </div>
    );
  }

  // ── Page editor view ────────────────────────────────────────────────────
  if (selectedPage) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedPageId(null)}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            ← All pages
          </button>
          <span className="text-sm text-gray-300">|</span>
          <span className="text-sm font-medium text-gray-700">Page {selectedPage.page_number}</span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        <div className="flex gap-6 items-start">
          {/* Preview — takes most of the width */}
          <div className="flex-1 min-w-0 space-y-3">
            <div
              className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-100"
              style={{ aspectRatio: "4/3", containerType: "size" }}
            >
              <img
                src={selectedPage.image_url!}
                alt={`Page ${selectedPage.page_number}`}
                className="w-full h-full object-cover"
              />
              <div
                className="absolute left-0 right-0 flex items-center"
                style={{
                  height: "25%",
                  bottom: "4%",
                  backgroundColor: `rgba(${hexToRgb(style.bgColor)}, ${style.bgOpacity})`,
                  padding: "0 6%",
                  containerType: "size",
                }}
              >
                <p
                  style={{
                    fontFamily: style.fontFamily,
                    fontSize: `${style.fontSizePct}cqh`,
                    color: style.color,
                    textAlign: style.alignment,
                    lineHeight: 1.55,
                    width: "100%",
                  }}
                >
                  {selectedPage.text}
                </p>
              </div>
            </div>

            {/* Prev / Next */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSelectedPageId(pagesWithScenes[selectedIndex - 1]?.id ?? null)}
                disabled={selectedIndex <= 0}
                className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                ← Prev
              </button>
              <span className="text-xs text-gray-400">
                {selectedIndex + 1} / {pagesWithScenes.length}
              </span>
              <button
                onClick={() => setSelectedPageId(pagesWithScenes[selectedIndex + 1]?.id ?? null)}
                disabled={selectedIndex >= pagesWithScenes.length - 1}
                className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                Next →
              </button>
            </div>

            {/* Saved preview */}
            {savedTextImages[selectedPage.id] && (
              <div className="space-y-1">
                <p className="text-xs text-gray-400 font-medium">Last saved</p>
                <div className="rounded-xl overflow-hidden border border-green-200" style={{ aspectRatio: "4/3" }}>
                  <img
                    src={savedTextImages[selectedPage.id]}
                    alt="Saved composited"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Controls sidebar */}
          <div className="w-64 shrink-0 space-y-5">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <StyleControls style={style} onChange={handleStyleChange} />
            </div>

            <div className="space-y-2">
              <button
                onClick={() => handleSavePage(selectedPage.id)}
                disabled={saving !== null}
                className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {saving === "page" && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
                {saving === "page" ? "Saving…" : "Save this page"}
              </button>
              <button
                onClick={handleSaveAll}
                disabled={saving !== null}
                className="w-full bg-white hover:bg-gray-50 disabled:opacity-60 border border-gray-200 text-gray-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {saving === "all" && <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-600 rounded-full animate-spin" />}
                {saving === "all" ? "Saving all…" : "Save all pages"}
              </button>
              <button
                onClick={handleSaveStyle}
                disabled={styleSaving}
                className="w-full text-xs text-gray-400 hover:text-gray-600 disabled:opacity-60 transition-colors underline underline-offset-2 pt-1"
              >
                {styleSaving ? "Saving style…" : "Save style as story default"}
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-xs text-blue-700 leading-relaxed">
                Changes to the controls update the preview instantly. Hit <strong>Save</strong> to composite and store the image.
                <br /><br />
                <span className="text-blue-500">{"{{hero_name}}"}</span> shows as-is here — it gets replaced with the child's name at order time.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Grid view ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Style controls + save all */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-start gap-6">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Story text style</h3>
            <StyleControls style={style} onChange={handleStyleChange} />
          </div>
          <div className="w-48 shrink-0 space-y-2 pt-6">
            <button
              onClick={handleSaveAll}
              disabled={saving !== null}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {saving === "all" && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
              {saving === "all" ? "Saving…" : "Save all pages"}
            </button>
            <button
              onClick={handleSaveStyle}
              disabled={styleSaving}
              className="w-full text-xs text-gray-400 hover:text-gray-600 disabled:opacity-60 transition-colors underline underline-offset-2 text-center block pt-1"
            >
              {styleSaving ? "Saving…" : "Save as story default"}
            </button>
            <p className="text-xs text-gray-400 pt-1">
              {Object.keys(savedTextImages).length}/{pagesWithScenes.length} pages composited
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Page grid */}
      <div className="grid grid-cols-3 gap-4">
        {pagesWithScenes.map((page) => (
          <div key={page.id} className="space-y-1">
            <PagePreview
              page={page}
              style={style}
              saved={!!savedTextImages[page.id]}
              onClick={() => setSelectedPageId(page.id)}
            />
            <p className="text-xs text-gray-500 text-center">Page {page.page_number}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
