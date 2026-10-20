"use client";

import { useState } from "react";
import { generateEndPageImage, saveEndPagePrompt } from "./book/actions";
import type { StoryRow } from "@/lib/supabase/types";

interface Props {
  story: StoryRow;
}

export function EndPagePanel({ story }: Props) {
  const [prompt, setPrompt] = useState(story.end_page_prompt ?? "");
  const [imageUrl, setImageUrl] = useState(story.end_page_image_url ?? "");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const url = await generateEndPageImage(story.id, prompt);
      setImageUrl(url);
      setSaved(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSavePrompt() {
    setError(null);
    setSaving(true);
    try {
      await saveEndPagePrompt(story.id, prompt);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">End Page</h2>
        <p className="text-sm text-gray-400">
          Left-hand page of the last interior spread, right after the last story page — its facing page (right)
          is the blank back endpaper. Only prints if an image is generated for it — leave it blank and the page
          is skipped entirely rather than printing blank.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Page preview */}
      <div className="rounded-xl overflow-hidden border border-gray-300 shadow-md bg-white flex items-center justify-center" style={{ aspectRatio: "1/1", maxWidth: 320 }}>
        {imageUrl ? (
          <img src={imageUrl} alt="End page" className="w-full h-full object-cover" />
        ) : (
          <p className="text-gray-300 italic text-xs px-8 text-center">No image generated yet — page won&apos;t print</p>
        )}
      </div>

      {/* Prompt + generate */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Generate image</h3>
        <p className="text-xs text-gray-400">
          Same line-art-style generation as the Brand Page. Include any closing text (e.g. &quot;The End&quot;)
          directly in the prompt — it&apos;s not composited separately.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the artwork, e.g. delicate line art of leaves and vines framing the words &quot;The End&quot; in an elegant script, matching the brand page style…"
          rows={4}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
        <button
          onClick={handleGenerate}
          disabled={generating || !prompt.trim()}
          className="w-full text-sm bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold px-3 py-2 rounded-lg disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
        >
          {generating && <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />}
          {generating ? "Generating…" : imageUrl ? "🔄 Regenerate" : "✨ Generate"}
        </button>
      </div>

      <button
        onClick={handleSavePrompt}
        disabled={saving}
        className="text-sm bg-gray-900 hover:bg-gray-700 text-white font-semibold px-5 py-2.5 rounded-xl disabled:opacity-60 transition-colors"
      >
        {saving ? "Saving…" : saved ? "✓ Saved" : "Save prompt"}
      </button>
    </div>
  );
}
