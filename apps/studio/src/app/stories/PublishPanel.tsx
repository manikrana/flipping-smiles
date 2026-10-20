"use client";

import { useState, useTransition } from "react";
import { setStoryStatus } from "./book/actions";
import type { StoryRow, StoryPageRow } from "@/lib/supabase/types";

interface Props {
  story: StoryRow;
  pages: StoryPageRow[];
}

interface CheckItem {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
}

export function PublishPanel({ story, pages }: Props) {
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState(story.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagesWithImages = pages.filter((p) => p.image_url);
  const approvedPages = pages.filter((p) => p.image_approved);
  const previewPages = pages.filter((p) => p.preview_eligible && p.image_url);
  const pagesWithText = pages.filter((p) => p.text_image_url);

  const checks: CheckItem[] = [
    {
      id: "scenes_generated",
      label: "All scenes generated",
      detail: `${pagesWithImages.length}/${pages.length} pages have a scene image`,
      passed: pages.length > 0 && pagesWithImages.length === pages.length,
    },
    {
      id: "scenes_approved",
      label: "All scenes approved",
      detail: `${approvedPages.length}/${pages.length} scenes approved`,
      passed: pages.length > 0 && approvedPages.length === pages.length,
    },
    {
      id: "text_composited",
      label: "Text added to all scenes",
      detail: `${pagesWithText.length}/${pages.length} pages have text composited`,
      passed: pages.length > 0 && pagesWithText.length === pages.length,
    },
    {
      id: "preview_ready",
      label: "Preview pages marked",
      detail: previewPages.length > 0
        ? `${previewPages.length} pages marked for storefront preview`
        : `No pages marked — mark pages as "Preview" in the pages tab`,
      passed: previewPages.length > 0,
    },
    {
      id: "cover_image",
      label: "Cover image selected",
      detail: story.cover_image_url ? "Cover image is set" : "No cover image selected — go to Cover tab",
      passed: !!story.cover_image_url,
    },
  ];

  const allPassed = checks.every((c) => c.passed);
  const passedCount = checks.filter((c) => c.passed).length;

  function handleSetStatus(newStatus: "draft" | "ready") {
    setSaving(true);
    setError(null);
    startTransition(async () => {
      try {
        await setStoryStatus(story.id, newStatus);
        setStatus(newStatus);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Status badge */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${
        status === "ready"
          ? "bg-green-50 border-green-200"
          : "bg-gray-50 border-gray-200"
      }`}>
        <div>
          <p className="text-sm font-semibold text-gray-700">Current status</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {status === "ready"
              ? "This story is live and visible in the store."
              : "This story is a draft — not yet visible to customers."}
          </p>
        </div>
        <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
          status === "ready"
            ? "bg-green-100 text-green-700"
            : "bg-gray-200 text-gray-600"
        }`}>
          {status === "ready" ? "✓ Ready" : "Draft"}
        </span>
      </div>

      {/* Checklist */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Pre-publish checklist</h3>
          <span className="text-xs text-gray-400">{passedCount}/{checks.length} complete</span>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {checks.map((check) => (
            <div key={check.id} className="flex items-start gap-3 px-4 py-3.5">
              <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                check.passed ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
              }`}>
                {check.passed ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
                    <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${check.passed ? "text-gray-700" : "text-gray-500"}`}>
                  {check.label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{check.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-500"
            style={{ width: `${(passedCount / checks.length) * 100}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          {allPassed ? "All checks passed — ready to publish!" : `${checks.length - passedCount} item${checks.length - passedCount !== 1 ? "s" : ""} remaining`}
        </p>
      </div>

      {/* Action buttons */}
      {status === "draft" ? (
        <div className="space-y-3">
          {allPassed && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5">
              <span className="text-amber-500 text-lg shrink-0">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">This will make the book public</p>
                <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                  Once published, this story will immediately appear in the store and customers will be able to order it. Make sure everything looks right before continuing.
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSetStatus("ready")}
              disabled={saving || !allPassed}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              {saving && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
              {saving ? "Publishing…" : "🚀 Publish to Store"}
            </button>
            {!allPassed && (
              <p className="text-xs text-gray-400">Complete all checks above to publish.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3.5">
            <span className="text-green-500 text-lg shrink-0">✅</span>
            <div>
              <p className="text-sm font-semibold text-green-800">Live in the store</p>
              <p className="text-xs text-green-700 mt-0.5 leading-relaxed">
                This story is publicly visible and customers can order it. Revert to draft to hide it from the store.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleSetStatus("draft")}
            disabled={saving}
            className="bg-gray-100 hover:bg-gray-200 disabled:opacity-60 text-gray-700 font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-gray-400/60 border-t-gray-500 rounded-full animate-spin" />}
            {saving ? "Reverting…" : "Revert to Draft"}
          </button>
        </div>
      )}
    </div>
  );
}
