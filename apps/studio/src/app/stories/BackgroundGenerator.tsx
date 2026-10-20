"use client";

import { useState, useTransition, useEffect } from "react";
import { generateSinglePage, generateSinglePageScene, startBackgroundGeneration, pollBackgroundGeneration, savePageCharacterDescription, type SceneResult } from "./backgrounds/actions";
import { setPageApproval } from "./backgrounds/approve/actions";
import type { StoryPageRow } from "@/lib/supabase/types";

interface Props {
  storyId: string;
  pages: StoryPageRow[];
}

type PageStatus = "idle" | "processing" | "done" | "failed";

interface PageImages { boy?: string; girl?: string }

export function BackgroundGenerator({ storyId, pages }: Props) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [pageStatuses, setPageStatuses] = useState<Record<string, PageStatus>>(
    Object.fromEntries(pages.map((p) => [
      p.id,
      p.image_url && p.image_url_girl ? "done" : "idle",
    ]))
  );
  const [pageErrors, setPageErrors] = useState<Record<string, string>>({});
  const [pageImages, setPageImages] = useState<Record<string, PageImages>>(
    Object.fromEntries(pages.map((p) => [p.id, {
      boy: p.image_url ?? undefined,
      girl: p.image_url_girl ?? undefined,
    }]))
  );

  const [lightbox, setLightbox] = useState<{ url: string; pageNumber: number; gender: "boy" | "girl" } | null>(null);
  const [charDescriptions, setCharDescriptions] = useState<Record<string, string>>(
    Object.fromEntries(pages.map((p) => [p.id, p.default_character_description ?? ""]))
  );
  const [savingDesc, setSavingDesc] = useState<Record<string, boolean>>({});
  const [genderProcessing, setGenderProcessing] = useState<Record<string, { boy?: boolean; girl?: boolean }>>({});
  const [approvals, setApprovals] = useState<Record<string, boolean>>(
    Object.fromEntries(pages.map((p) => [p.id, p.image_approved]))
  );
  const [savingApproval, setSavingApproval] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  const isAnyGenderProcessing = Object.values(genderProcessing).some((g) => g.boy || g.girl);
  const isAnyProcessing = Object.values(pageStatuses).some((s) => s === "processing") || isAnyGenderProcessing;
  const doneCount = Object.values(pageStatuses).filter((s) => s === "done").length;
  const approvedCount = Object.values(approvals).filter(Boolean).length;
  const pendingPages = pages.filter((p) => !pageImages[p.id]?.boy || !pageImages[p.id]?.girl);

  function applyResult(result: SceneResult) {
    if (result.boyImageUrl || result.girlImageUrl) {
      setPageImages((prev) => ({
        ...prev,
        [result.pageId]: {
          boy: result.boyImageUrl ?? prev[result.pageId]?.boy,
          girl: result.girlImageUrl ?? prev[result.pageId]?.girl,
        },
      }));
      setPageStatuses((prev) => ({ ...prev, [result.pageId]: "done" }));
    }
  }

  async function pollUntilDone(predictions: { pageId: string; predictionId: string }[]) {
    let remaining = predictions;
    while (remaining.length > 0) {
      await new Promise((r) => setTimeout(r, 6000));
      const results = await pollBackgroundGeneration(remaining);
      const stillProcessing: typeof remaining = [];
      for (const result of results) {
        if (result.status === "done") {
          setPageStatuses((prev) => ({ ...prev, [result.pageId]: "done" }));
          if (result.boyImageUrl) {
            setPageImages((prev) => ({ ...prev, [result.pageId]: { ...prev[result.pageId], boy: result.boyImageUrl } }));
          }
        } else if (result.status === "failed") {
          setPageStatuses((prev) => ({ ...prev, [result.pageId]: "failed" }));
          if (result.error) setPageErrors((prev) => ({ ...prev, [result.pageId]: result.error! }));
        } else {
          stillProcessing.push(remaining.find((p) => p.pageId === result.pageId)!);
        }
      }
      remaining = stillProcessing;
    }
  }

  function extractMessage(e: unknown): string {
    if (e instanceof Error) return e.message || "An unknown error occurred";
    if (typeof e === "string") return e;
    try { return JSON.stringify(e); } catch { return "An unknown error occurred"; }
  }

  function handleGeneratePage(pageId: string) {
    setError(null);
    setPageStatuses((prev) => ({ ...prev, [pageId]: "processing" }));
    startTransition(async () => {
      try {
        const result = await generateSinglePage(storyId, pageId);
        if (result.boyImageUrl || result.girlImageUrl) {
          applyResult(result);
        } else if (result.predictionId) {
          await pollUntilDone([result as { pageId: string; predictionId: string }]);
        }
      } catch (e) {
        setError(extractMessage(e));
        setPageStatuses((prev) => ({ ...prev, [pageId]: "failed" }));
      }
    });
  }

  function handleGenerateAll(onlyMissing: boolean) {
    setError(null);
    const targets = onlyMissing ? pendingPages : pages;
    if (!targets.length) return;
    targets.forEach((p) => setPageStatuses((prev) => ({ ...prev, [p.id]: "processing" })));
    startTransition(async () => {
      try {
        const pageIds = onlyMissing ? targets.map((p) => p.id) : undefined;
        const results = await startBackgroundGeneration(storyId, pageIds);
        results.forEach(applyResult);
        await pollUntilDone(results.filter((r): r is { pageId: string; predictionId: string } => !!r.predictionId));
      } catch (e) {
        setError(extractMessage(e));
        targets.forEach((p) => setPageStatuses((prev) => ({ ...prev, [p.id]: "idle" })));
      }
    });
  }

  function handleResetStuck() {
    setPageStatuses((prev) =>
      Object.fromEntries(Object.entries(prev).map(([id, s]) => [id, s === "processing" ? "idle" : s]))
    );
    setGenderProcessing({});
  }

  // The hero is now a blank silhouette, shared by every order regardless of
  // gender -- there's only one scene to generate per page anymore. `gender`
  // is kept as a param since this is still invoked from two boy/girl buttons
  // (pre-existing UI, unrelated to this change) and both now trigger the
  // same single-scene regeneration.
  function handleGenerateGender(pageId: string, gender: "boy" | "girl") {
    setError(null);
    setGenderProcessing((prev) => ({ ...prev, [pageId]: { ...prev[pageId], [gender]: true } }));
    startTransition(async () => {
      try {
        const result = await generateSinglePageScene(storyId, pageId);
        applyResult(result);
      } catch (e) {
        setError(extractMessage(e));
      } finally {
        setGenderProcessing((prev) => ({ ...prev, [pageId]: { ...prev[pageId], [gender]: false } }));
      }
    });
  }

  async function handleToggleApproval(pageId: string) {
    const next = !approvals[pageId];
    setApprovals((prev) => ({ ...prev, [pageId]: next }));
    setSavingApproval((prev) => ({ ...prev, [pageId]: true }));
    try {
      await setPageApproval(storyId, pageId, next);
    } catch {
      setApprovals((prev) => ({ ...prev, [pageId]: !next })); // revert on error
    } finally {
      setSavingApproval((prev) => ({ ...prev, [pageId]: false }));
    }
  }

  async function handleSaveDescription(pageId: string) {
    setSavingDesc((prev) => ({ ...prev, [pageId]: true }));
    try {
      await savePageCharacterDescription(pageId, charDescriptions[pageId] ?? "");
    } finally {
      setSavingDesc((prev) => ({ ...prev, [pageId]: false }));
    }
  }

  if (pages.length === 0) {
    return <p className="text-sm text-gray-400">Save at least one page first.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-700">Background scenes</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Two variants per page — boy and girl. {doneCount}/{pages.length} ready · {approvedCount}/{pages.length} approved.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingPages.length > 0 && pendingPages.length < pages.length && (
            <button
              onClick={() => handleGenerateAll(true)}
              disabled={isAnyProcessing}
              className="text-sm bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium px-3 py-2 rounded-lg disabled:opacity-60 transition-colors"
            >
              Generate missing ({pendingPages.length})
            </button>
          )}
          {pendingPages.length === pages.length && (
            <button
              onClick={() => handleGenerateAll(true)}
              disabled={isAnyProcessing}
              className="text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
            >
              Generate all
            </button>
          )}
          {doneCount > 0 && (
            <button
              onClick={() => handleGenerateAll(false)}
              disabled={isAnyProcessing}
              className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-60 transition-colors"
            >
              Regenerate all
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {isAnyProcessing && (
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>Generation in progress…</span>
          <button onClick={handleResetStuck} className="underline hover:text-gray-600">Stuck? Reset</button>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.url} alt={`Page ${lightbox.pageNumber} ${lightbox.gender}`} className="w-full rounded-xl shadow-2xl" />
            <div className="absolute top-3 left-3 flex gap-2">
              <span className="bg-black/50 text-white text-xs font-medium px-2.5 py-1 rounded-full">Page {lightbox.pageNumber}</span>
              <span className="bg-black/50 text-white text-xs px-2.5 py-1 rounded-full">{lightbox.gender === "boy" ? "👦 Boy" : "👧 Girl"}</span>
            </div>
            <button onClick={() => setLightbox(null)} className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 text-white w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none">×</button>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {pages.map((page) => {
          const status = pageStatuses[page.id] ?? "idle";
          const imgs = pageImages[page.id] ?? {};
          const isPageProcessing = status === "processing";
          const pageError = pageErrors[page.id];

          return (
            <div key={page.id} className="border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Page {page.page_number}</span>
                <div className="flex items-center gap-2">
                  {imgs.boy && imgs.girl
                    ? <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Both ready</span>
                    : imgs.boy
                    ? <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Boy only</span>
                    : null
                  }
                  {status === "failed" && <span className="text-xs text-red-500">{pageError ?? "Failed"}</span>}
                  {/* Approve button — only shown when at least one image exists */}
                  {(imgs.boy || imgs.girl) && !isPageProcessing && (
                    <button
                      onClick={() => handleToggleApproval(page.id)}
                      disabled={savingApproval[page.id]}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                        approvals[page.id]
                          ? "bg-green-500 text-white border-green-500 hover:bg-green-600"
                          : "bg-white text-gray-500 border-gray-200 hover:border-green-400 hover:text-green-600"
                      }`}
                    >
                      {savingApproval[page.id] ? "…" : approvals[page.id] ? "✓ Approved" : "Approve"}
                    </button>
                  )}
                  <button
                    onClick={() => handleGeneratePage(page.id)}
                    disabled={isAnyProcessing}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 bg-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40"
                  >
                    {isPageProcessing ? (
                      <span className="flex items-center gap-1"><span className="animate-spin inline-block">⟳</span> Generating…</span>
                    ) : status === "done" ? "Regenerate both" : "Generate both"}
                  </button>
                </div>
              </div>

              {/* Boy + Girl thumbnails side by side */}
              <div className="grid grid-cols-2 gap-3">
                {(["boy", "girl"] as const).map((gender) => {
                  const url = gender === "boy" ? imgs.boy : imgs.girl;
                  const isGenderProcessing = isPageProcessing || !!(genderProcessing[page.id]?.[gender]);
                  return (
                    <div key={gender} className="space-y-1">
                      <p className="text-xs font-medium text-gray-400">{gender === "boy" ? "👦 Boy" : "👧 Girl"}</p>
                      <div className="aspect-[4/3] rounded-lg overflow-hidden bg-gray-100 border border-gray-200 relative group">
                        {url ? (
                          <>
                            <img
                              src={url}
                              alt={`Page ${page.page_number} ${gender}`}
                              className={`w-full h-full object-cover transition-opacity ${isGenderProcessing ? "opacity-40" : ""}`}
                            />
                            {isGenderProcessing ? (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              </div>
                            ) : (
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 px-3">
                                <button
                                  onClick={() => setLightbox({ url, pageNumber: page.page_number, gender })}
                                  className="w-full text-xs bg-white text-gray-800 font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 text-center"
                                >
                                  Expand
                                </button>
                                {gender === "boy" ? (
                                  <button
                                    onClick={() => handleGeneratePage(page.id)}
                                    disabled={isAnyProcessing}
                                    className="w-full text-xs bg-white text-gray-800 font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-50 text-center"
                                    title="Regenerates boy scene then girl scene using it as reference"
                                  >
                                    Regenerate both
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleGenerateGender(page.id, "girl")}
                                    disabled={isAnyProcessing}
                                    className="w-full text-xs bg-white text-gray-800 font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-50 text-center"
                                    title="Regenerates girl scene using existing boy scene as reference"
                                  >
                                    Regenerate
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        ) : isGenderProcessing ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : (
                          <button
                            onClick={() => handleGenerateGender(page.id, gender)}
                            disabled={isAnyProcessing}
                            className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:pointer-events-none disabled:opacity-40"
                            title={gender === "girl" && imgs.boy ? "Generates girl scene using boy scene as composition reference" : undefined}
                          >
                            <span className="text-lg">+</span>
                            <span>Generate{gender === "girl" && imgs.boy ? " from boy" : ""}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Default character <span className="font-normal text-gray-300">— for personalisation</span>
                </label>
                <textarea
                  value={charDescriptions[page.id] ?? ""}
                  onChange={(e) => setCharDescriptions((prev) => ({ ...prev, [page.id]: e.target.value }))}
                  onBlur={() => handleSaveDescription(page.id)}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-400 resize-none"
                  placeholder="e.g. a young boy with brown hair, red t-shirt"
                />
                {savingDesc[page.id] && <p className="text-xs text-gray-400 mt-0.5">Saving…</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
