"use client";

import { useState, useTransition, useEffect } from "react";
import { saveBackCoverSettings, fetchPublishedStories, type FeaturedStory } from "./back-cover/actions";
import { getBrandSettings } from "@/app/settings/actions";
import { BackCoverOverlay } from "./BackCoverOverlay";
import { DEFAULT_COVER_LAYOUT, type StoryRow } from "@/lib/supabase/types";

interface Props {
  story: StoryRow;
}

export function BackCoverPanel({ story }: Props) {
  const [, startTransition] = useTransition();
  const [featuredIds, setFeaturedIds] = useState<string[]>(story.back_cover_featured_story_ids ?? []);
  const [publishedStories, setPublishedStories] = useState<FeaturedStory[]>([]);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [leadingText, setLeadingText] = useState<string | null>(story.back_cover_tagline ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPublishedStories(story.id).then(setPublishedStories).catch(() => {});
    getBrandSettings().then((s) => {
      setCompanyName(s.company_name ? `${s.company_name}™` : null);
      if (!story.back_cover_tagline) setLeadingText(s.back_cover_leading_text || "There's more smiles ahead");
    }).catch(() => {});
  }, [story.id, story.back_cover_tagline]);

  const featuredStories = publishedStories.filter((s) => featuredIds.includes(s.id));

  function toggleStory(id: string) {
    setFeaturedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev
    );
    setSaved(false);
  }

  function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await saveBackCoverSettings(story.id, { back_cover_featured_story_ids: featuredIds });
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
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Back Cover</h2>
        <p className="text-sm text-gray-400">
          Which other published books show in the "have you read?" row on this story's back cover. The
          leading text, QR codes, and everything else about the back cover's design live in the Front Cover
          tab's prompt builder and in Settings — this panel only picks the featured books.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="flex gap-6 items-start">
        {/* Preview */}
        <div
          className="shrink-0 relative rounded-xl overflow-hidden border border-gray-300 shadow-md bg-gray-900"
          style={{ width: 280, aspectRatio: "1/1", containerType: "size" }}
        >
          {story.cover_image_url ? (
            <img
              src={story.cover_image_url}
              alt="Back cover"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ objectPosition: "left center", transform: "scale(1.25)", transformOrigin: "left center" }}
            />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs px-8 text-center">
              No cover generated yet — go to Front Cover tab
            </p>
          )}

          <BackCoverOverlay
            featuredBooks={featuredStories.map((s) => ({ title: s.title, coverUrl: s.cover_image_url }))}
            websiteQrUrl={null}
            instagramQrUrl={null}
            companyName={companyName}
            leadingText={leadingText}
            fontFamily={story.cover_layout?.fontFamily ?? DEFAULT_COVER_LAYOUT.fontFamily}
            qrPlaceholder
          />

          {featuredStories.length === 0 && (
            <p className="absolute bottom-3 inset-x-0 text-center text-white/70 text-xs italic px-4">
              Select books below to feature
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-5">
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Featured stories</h3>
              <p className="text-xs text-gray-400 mt-0.5">Pick up to 4 published stories to show under the back cover's leading text.</p>
            </div>
            {publishedStories.length === 0 ? (
              <p className="text-xs text-gray-300 italic">No other published stories yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {publishedStories.map((s) => {
                  const selected = featuredIds.includes(s.id);
                  const disabled = !selected && featuredIds.length >= 4;
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleStory(s.id)}
                      disabled={disabled}
                      className={`relative rounded-lg overflow-hidden border-2 text-left transition-all disabled:opacity-40 ${
                        selected ? "border-brand-500" : "border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      {s.cover_image_url
                        ? <img src={s.cover_image_url} alt={s.title} className="w-full aspect-square object-cover" style={{ objectPosition: "right center" }} />
                        : <div className="w-full aspect-square bg-gray-100 flex items-center justify-center text-gray-400 text-xs p-2 text-center">{s.title}</div>
                      }
                      <div className={`px-2 py-1 text-[10px] font-medium truncate ${selected ? "bg-brand-500 text-white" : "bg-gray-50 text-gray-600"}`}>
                        {s.title}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm bg-gray-900 hover:bg-gray-700 text-white font-semibold px-5 py-2.5 rounded-xl disabled:opacity-60 transition-colors"
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save back cover"}
          </button>
        </div>
      </div>
    </div>
  );
}
