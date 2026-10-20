"use client";

import { useState, useTransition } from "react";
import { saveBookPages, saveFrontSpreadPageStyles } from "./book/actions";
import type { StoryRow, TextStyle, TextPanelBg } from "@/lib/supabase/types";
import { FONT_OPTIONS } from "@/lib/fonts";
import { patternToCss } from "@/lib/patterns";

function panelBgCss(bg: TextPanelBg | null): React.CSSProperties {
  if (!bg || bg.type === "none" || bg.type === "scene_bleed") return {};
  if (bg.type === "solid") return { backgroundColor: bg.color };
  if (bg.type === "gradient") {
    const dir = bg.direction === "to-bottom" ? "to bottom" : bg.direction === "to-right" ? "to right" : "to bottom right";
    return { background: `linear-gradient(${dir}, ${bg.from}, ${bg.to})` };
  }
  if (bg.type === "pattern") return patternToCss(bg.patternId, bg.color, bg.bgColor) as React.CSSProperties;
  return {};
}

interface Props {
  story: StoryRow;
}

const DEFAULT_DEDICATION_STYLE: TextStyle = {
  fontFamily: "Georgia, serif",
  fontSizePct: 5,
  color: "#2d2d2d",
  alignment: "center",
  bgColor: "#fdf6e3",
  bgOpacity: 1,
};

const DEFAULT_TITLE_STYLE: TextStyle = {
  fontFamily: "Georgia, serif",
  fontSizePct: 7,
  color: "#1a1a1a",
  alignment: "center",
  bgColor: "#ffffff",
  bgOpacity: 1,
};

function StylePicker({
  label,
  style,
  onChange,
}: {
  label: string;
  style: TextStyle;
  onChange: (s: TextStyle) => void;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</h4>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Font</label>
        <select
          value={style.fontFamily}
          onChange={(e) => onChange({ ...style, fontFamily: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          style={{ fontFamily: style.fontFamily }}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.cssFamily} value={f.cssFamily} style={{ fontFamily: f.cssFamily }}>
              {f.label} — {f.style}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Size %</label>
          <input
            type="number" min={1} max={20} step={0.5}
            value={style.fontSizePct}
            onChange={(e) => onChange({ ...style, fontSizePct: parseFloat(e.target.value) })}
            className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Color</label>
          <input
            type="color"
            value={style.color}
            onChange={(e) => onChange({ ...style, color: e.target.value })}
            className="w-full h-9 rounded-lg cursor-pointer border border-gray-200"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Align</label>
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                onClick={() => onChange({ ...style, alignment: a })}
                className={`flex-1 py-2 rounded text-xs font-medium transition-colors ${
                  style.alignment === a ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {a === "left" ? "←" : a === "center" ? "≡" : "→"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Style</label>
          <button
            onClick={() => onChange({ ...style, italic: !style.italic })}
            className={`w-full py-2 rounded text-xs font-medium italic transition-colors ${
              style.italic ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            I
          </button>
        </div>
      </div>
    </div>
  );
}

export function FrontSpreadPanel({ story }: Props) {
  const [, startTransition] = useTransition();
  const [dedicationText, setDedicationText] = useState(story.dedication_text ?? "");
  const [dedicationStyle, setDedicationStyle] = useState<TextStyle>(
    story.dedication_text_style ?? DEFAULT_DEDICATION_STYLE
  );
  const [titleStyle, setTitleStyle] = useState<TextStyle>(
    story.title_page_text_style ?? DEFAULT_TITLE_STYLE
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await Promise.all([
          saveBookPages(story.id, { dedication_text: dedicationText || null }),
          saveFrontSpreadPageStyles(story.id, dedicationStyle, titleStyle),
        ]);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Dedication &amp; Title</h2>
        <p className="text-sm text-gray-400">The 3rd and 4th interior pages, in print order — dedication, then title. (The first interior spread, right after the cover, is a blank endpaper and the brand page — not shown here.)</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Page order preview — dedication prints first, title second (buildPageList in lib/pdf.ts) */}
      <div className="flex rounded-xl overflow-hidden border border-gray-300 shadow-md" style={{ aspectRatio: "2/1" }}>
        {/* First — Dedication */}
        <div className="flex-1 bg-amber-50 flex flex-col items-center justify-center px-8 text-center border-r border-gray-300" style={{ containerType: "size" }}>
          {dedicationText ? (
            <p
              className="whitespace-pre-wrap leading-relaxed"
              style={{
                fontFamily: dedicationStyle.fontFamily,
                fontSize: `${dedicationStyle.fontSizePct * 0.6}cqh`,
                color: dedicationStyle.color,
                textAlign: dedicationStyle.alignment,
                fontStyle: dedicationStyle.italic ? "italic" : "normal",
              }}
            >
              {dedicationText.replace(/{{hero_name}}/g, "Hero")}
            </p>
          ) : (
            <p className="text-gray-300 italic text-xs">Dedication text will appear here…</p>
          )}
        </div>
        {/* Second — Title page (uses Print tab text panel background) */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center" style={{ containerType: "size", ...panelBgCss(story.text_panel_bg) }}>
          <p
            style={{
              fontFamily: titleStyle.fontFamily,
              fontSize: `${titleStyle.fontSizePct * 0.9}cqh`,
              color: titleStyle.color,
              textAlign: titleStyle.alignment,
              fontStyle: titleStyle.italic ? "italic" : "normal",
              fontWeight: 600,
              lineHeight: 1.3,
            }}
          >
            {story.title}
          </p>
        </div>
      </div>

      {/* Two-column style pickers */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <StylePicker label="Dedication style" style={dedicationStyle} onChange={setDedicationStyle} />
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <StylePicker label="Title page style" style={titleStyle} onChange={setTitleStyle} />
        </div>
      </div>

      {/* Dedication text editor */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-0.5">Dedication text</h3>
          <p className="text-xs text-gray-400">Use <code className="bg-gray-100 px-1 rounded">{"{{hero_name}}"}</code> to insert the child's name.</p>
        </div>
        <textarea
          value={dedicationText}
          onChange={(e) => setDedicationText(e.target.value)}
          rows={5}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder={"For {{hero_name}}, who makes every adventure magical.\n\nWith love."}
        />
      </div>

      {/* Title page info */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-0.5">Title page</h3>
        <p className="text-xs text-gray-400 mb-3">Auto-generated from the story title. Edit the title in the Details tab.</p>
        <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600 font-medium">{story.title}</div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="text-sm bg-gray-900 hover:bg-gray-700 text-white font-semibold px-5 py-2.5 rounded-xl disabled:opacity-60 transition-colors"
      >
        {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
      </button>
    </div>
  );
}
