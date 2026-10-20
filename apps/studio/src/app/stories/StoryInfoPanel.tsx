"use client";

import { useState, useTransition } from "react";
import { saveStoryDetails, archiveStory } from "./actions";
import { STYLES, type GenerationStyle } from "@/lib/styles";
import type { StoryRow } from "@/lib/supabase/types";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "te", label: "Telugu" },
];

interface Props {
  story: StoryRow;
}

export function StoryInfoPanel({ story }: Props) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [title, setTitle] = useState(story.title ?? "");
  const [slug, setSlug] = useState(story.slug ?? "");
  const [description, setDescription] = useState(story.description ?? "");
  const [ageMin, setAgeMin] = useState(story.age_min ?? 3);
  const [ageMax, setAgeMax] = useState(story.age_max ?? 8);
  const [priceUsd, setPriceUsd] = useState(story.price_usd ?? 29.99);
  const [languages, setLanguages] = useState<string[]>(story.languages ?? ["en"]);
  const [generationStyle, setGenerationStyle] = useState<GenerationStyle>(
    (story.generation_style as GenerationStyle) ?? "pixar-3d"
  );
  const [heroCostumeBoy, setHeroCostumeBoy] = useState(story.hero_costume_description_boy ?? "");
  const [heroCostumeGirl, setHeroCostumeGirl] = useState(story.hero_costume_description_girl ?? "");
  function autoSlug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    setSlug(autoSlug(value));
  }

  function toggleLanguage(lang: string) {
    setLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  }

  function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await saveStoryDetails(story.id, {
          title, slug, description,
          age_min: ageMin, age_max: ageMax,
          price_usd: priceUsd, languages,
          scene_model: story.scene_model ?? "nano-banana-pro",
          generation_style: generationStyle,
          hero_costume_description_boy: heroCostumeBoy.trim() || null,
          hero_costume_description_girl: heroCostumeGirl.trim() || null,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    });
  }

  function handleArchive() {
    if (!confirm(`Archive "${story.title}"? It will be hidden from the store and can be revived later.`)) return;
    startTransition(async () => {
      try { await archiveStory(story.id); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* ── Story basics ───────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h3 className="font-semibold text-gray-700">Story basics</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Title</label>
            <input value={title} onChange={(e) => handleTitleChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="The Dragon Who Lost His Roar" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Slug</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="the-dragon-who-lost-his-roar" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="A fun adventure about finding your voice." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Age range</label>
              <div className="flex items-center gap-2">
                <input type="number" value={ageMin} min={0} max={18} onChange={(e) => setAgeMin(Number(e.target.value))}
                  className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                <span className="text-gray-400 text-sm">to</span>
                <input type="number" value={ageMax} min={0} max={18} onChange={(e) => setAgeMax(Number(e.target.value))}
                  className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Price (USD)</label>
              <input type="number" value={priceUsd} min={0} step={0.01} onChange={(e) => setPriceUsd(Number(e.target.value))}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">Languages</label>
            <div className="flex gap-4">
              {LANGUAGES.map((lang) => (
                <label key={lang.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={languages.includes(lang.value)} onChange={() => toggleLanguage(lang.value)} className="accent-brand-500" />
                  {lang.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Illustration style ─────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h3 className="font-semibold text-gray-700">Illustration style</h3>
        <div className="flex gap-2">
          {(Object.entries(STYLES) as [GenerationStyle, (typeof STYLES)[GenerationStyle]][]).map(([id, cfg]) => (
            <button key={id} type="button" onClick={() => setGenerationStyle(id)}
              className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium text-left transition-colors ${
                generationStyle === id
                  ? "bg-brand-50 border-brand-400 text-brand-700"
                  : "bg-white border-gray-200 text-gray-500 hover:border-gray-400"
              }`}
            >
              <div className="font-semibold">{cfg.label}</div>
              <div className="text-xs font-normal mt-0.5 opacity-75">{cfg.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* ── Hero costume ────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
        <h3 className="font-semibold text-gray-700">Hero costume</h3>
        <p className="text-xs text-gray-400">
          A specific, concrete outfit baked onto the hero's identity reference sheet at order time — applied
          consistently across every page and the cover of this book. Leave blank to fall back to generic,
          scene-appropriate clothing.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Boy</label>
          <textarea value={heroCostumeBoy} onChange={(e) => setHeroCostumeBoy(e.target.value)} rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="a khaki safari vest over a light-blue tee, cargo shorts, and brown lace-up boots" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Girl</label>
          <textarea value={heroCostumeGirl} onChange={(e) => setHeroCostumeGirl(e.target.value)} rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="a khaki safari vest over a light-pink tee, cargo shorts, and brown lace-up boots" />
        </div>
      </section>

      {/* ── Actions ───────────────────────────────────────── */}
      <div className="flex items-center gap-3 pb-8">
        <button onClick={handleSave} disabled={saving}
          className="bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors">
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save details"}
        </button>
        {!story.archived && (
          <button onClick={handleArchive} disabled={saving}
            className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-60">
            Archive story
          </button>
        )}
      </div>
    </div>
  );
}
