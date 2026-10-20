"use client";

import { useState, useTransition } from "react";
import { saveStory } from "../actions";
import { STYLES, type GenerationStyle } from "@/lib/styles";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "te", label: "Telugu" },
];

export function NewStoryForm() {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [ageMin, setAgeMin] = useState(3);
  const [ageMax, setAgeMax] = useState(8);
  const [priceUsd, setPriceUsd] = useState(29.99);
  const [languages, setLanguages] = useState(["en"]);
  const [generationStyle, setGenerationStyle] = useState<GenerationStyle>("pixar-3d");

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

  function handleCreate() {
    if (!title.trim()) { setError("Title is required"); return; }
    if (!slug.trim()) { setError("Slug is required"); return; }
    setError(null);
    setSaving(true);
    startTransition(async () => {
      try {
        await saveStory(null, {
          title, slug, description,
          age_min: ageMin, age_max: ageMax,
          price_usd: priceUsd, languages,
          scene_model: "nano-banana-pro",
          generation_style: generationStyle,
          layout_type: "split_image_left",
          pages: [],
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h3 className="font-semibold text-gray-700">Story basics</h3>
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
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
        <h3 className="font-semibold text-gray-700">Illustration style</h3>
        <div className="flex gap-2">
          {(Object.entries(STYLES) as [GenerationStyle, (typeof STYLES)[GenerationStyle]][]).map(([id, cfg]) => (
            <button key={id} type="button" onClick={() => setGenerationStyle(id)}
              className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium text-left transition-colors ${
                generationStyle === id
                  ? "bg-brand-50 border-brand-400 text-brand-700"
                  : "bg-white border-gray-200 text-gray-500 hover:border-gray-400"
              }`}>
              <div className="font-semibold">{cfg.label}</div>
              <div className="text-xs font-normal mt-0.5 opacity-75">{cfg.description}</div>
            </button>
          ))}
        </div>
      </section>

      <button onClick={handleCreate} disabled={saving}
        className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors">
        {saving ? "Creating…" : "Create story"}
      </button>
    </div>
  );
}
