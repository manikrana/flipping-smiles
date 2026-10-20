"use client";

import { useState, useTransition } from "react";
import { saveBrandSettings } from "./actions";
import type { BrandSettingsRow } from "@/lib/supabase/types";

export function SettingsForm({ settings }: { settings: BrandSettingsRow }) {
  const [, startTransition] = useTransition();
  const [companyName, setCompanyName] = useState(settings.company_name ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(settings.website_url ?? "");
  const [instagramUrl, setInstagramUrl] = useState(settings.instagram_url ?? "");
  const [leadingText, setLeadingText] = useState(settings.back_cover_leading_text ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await saveBrandSettings({
          company_name: companyName || null,
          website_url: websiteUrl || null,
          instagram_url: instagramUrl || null,
          back_cover_leading_text: leadingText || null,
        });
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
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Brand settings</h2>
        <p className="text-sm text-gray-400">
          One set of values used on every book cover — company name, website, and Instagram QR
          targets, and the default back-cover leading line. Set once here instead of per story.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Company name</label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => { setCompanyName(e.target.value); setSaved(false); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Flipping Smiles"
          />
          <p className="text-xs text-gray-400 mt-1">Baked into the front cover art, bottom-most.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Website URL</label>
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => { setWebsiteUrl(e.target.value); setSaved(false); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="https://flippingsmiles.com"
          />
          <p className="text-xs text-gray-400 mt-1">Back-cover QR, bottom-right.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Instagram URL</label>
          <input
            type="url"
            value={instagramUrl}
            onChange={(e) => { setInstagramUrl(e.target.value); setSaved(false); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="https://instagram.com/flippingsmiles"
          />
          <p className="text-xs text-gray-400 mt-1">Back-cover QR, bottom-left.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Back cover leading text</label>
          <input
            type="text"
            value={leadingText}
            onChange={(e) => { setLeadingText(e.target.value); setSaved(false); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="There's more smiles ahead"
          />
          <p className="text-xs text-gray-400 mt-1">
            Shown as a real overlay above the featured-books row on the back cover. A story can override this in its own Front Cover tab.
          </p>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="text-sm bg-gray-900 hover:bg-gray-700 text-white font-semibold px-5 py-2.5 rounded-xl disabled:opacity-60 transition-colors"
      >
        {saving ? "Saving…" : saved ? "✓ Saved" : "Save settings"}
      </button>
    </div>
  );
}
