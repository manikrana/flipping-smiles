"use client";

import { useState, useTransition, useEffect } from "react";
import { setCoverImage, saveCoverLayout, setCoverHeroCharacters, generateCoverSpread, generateCoverSwapTemplate, getCoverPreviewData, getCoverAgeVariantUrls, generateAgeVariantsForCover, getSpineAppearance, type CoverPreviewData } from "./book/actions";
import { getBrandSettings } from "@/app/settings/actions";
import { computeCoverZones } from "@/lib/coverZones";
import { BackCoverOverlay } from "./BackCoverOverlay";
import { FrontCoverOverlay } from "./FrontCoverOverlay";
import { buildCoverPrompt, TITLE_POSITIONS } from "@/lib/coverPrompt";
import { FONT_OPTIONS, FONT_CATEGORIES, GOOGLE_FONTS_URL } from "@/lib/fonts";
import { DEFAULT_COVER_LAYOUT, type CoverLayout, type StoryRow, type StoryPageRow, type BrandSettingsRow, type CastCharacterRow } from "@/lib/supabase/types";

const FALLBACK_ASPECT_RATIO = "1.88 / 1"; // used until the live Gelato geometry loads

interface Props {
  story: StoryRow;
  approvedPages: StoryPageRow[];
  allCharacters: CastCharacterRow[];
}

export function CoverEditor({ story, approvedPages, allCharacters }: Props) {
  const [, startTransition] = useTransition();
  const [coverUrl, setCoverUrl] = useState(story.cover_image_url ?? "");
  const [coverUrlGirl, setCoverUrlGirl] = useState(story.cover_image_url_girl ?? "");
  const [coverPreviewGender, setCoverPreviewGender] = useState<"boy" | "girl">("boy");
  // Merge (not replace) with defaults -- a story saved before titlePosition
  // existed has cover_layout JSON missing that key, not null.
  const [layout, setLayout] = useState<CoverLayout>({ ...DEFAULT_COVER_LAYOUT, ...(story.cover_layout ?? {}) });
  const [backLeadingText, setBackLeadingText] = useState(story.back_cover_tagline ?? "");
  const [heroBoyCharId, setHeroBoyCharId] = useState(story.cover_hero_boy_character_id);
  const [heroGirlCharId, setHeroGirlCharId] = useState(story.cover_hero_girl_character_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sceneDescription, setSceneDescription] = useState("");
  const [finalPrompt, setFinalPrompt] = useState("");
  const [generatingBoy, setGeneratingBoy] = useState(false);
  const [generatingGirl, setGeneratingGirl] = useState(false);
  // Blank-silhouette cover used only by the order-time identity swap --
  // never shown to customers. Separate from coverUrl/coverUrlGirl above,
  // which remain the storefront-facing display covers.
  const [coverSwapTemplateUrl, setCoverSwapTemplateUrl] = useState(story.cover_swap_template_url ?? "");
  const [generatingSwapTemplate, setGeneratingSwapTemplate] = useState(false);
  const [previewData, setPreviewData] = useState<CoverPreviewData | null>(null);
  const [brandSettings, setBrandSettings] = useState<BrandSettingsRow | null>(null);
  const [coverAgeVariantUrls, setCoverAgeVariantUrls] = useState<Record<"1-4" | "5-8" | "9-12", string | null>>({ "1-4": null, "5-8": null, "9-12": null });
  const [generatingCoverAgeVariants, setGeneratingCoverAgeVariants] = useState(false);
  const [spineAppearance, setSpineAppearance] = useState<{ spineColor: string; spineTextColor: string } | null>(null);

  useEffect(() => {
    if (document.getElementById("kitabee-google-fonts")) return;
    const link = document.createElement("link");
    link.id = "kitabee-google-fonts";
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCoverPreviewData(story.id).then((data) => {
      if (!cancelled) setPreviewData(data);
    }).catch(() => { /* preview-only -- fall back to the approximate aspect ratio */ });
    getBrandSettings().then((data) => {
      if (!cancelled) setBrandSettings(data);
    }).catch(() => { /* brand settings are optional context for the prompt preview */ });
    return () => { cancelled = true; };
  }, [story.id]);

  // Age-band variant preview -- refetched whenever the swap template
  // changes (coverSwapTemplateUrl as a cheap proxy for "a regen just
  // finished"), so the admin can spot-check the 1-4/9-12 derivatives.
  useEffect(() => {
    let cancelled = false;
    getCoverAgeVariantUrls(story.id).then((urls) => { if (!cancelled) setCoverAgeVariantUrls(urls); });
    return () => { cancelled = true; };
  }, [story.id, coverSwapTemplateUrl]);

  // Age-band derivation is a manual, explicit action (not run automatically
  // on every base regen) so testing the core swap pipeline doesn't triple
  // the Gemini cost of every click.
  async function handleGenerateCoverAgeVariants() {
    setGeneratingCoverAgeVariants(true);
    setError(null);
    try {
      await generateAgeVariantsForCover(story.id);
      const urls = await getCoverAgeVariantUrls(story.id);
      setCoverAgeVariantUrls(urls);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingCoverAgeVariants(false);
    }
  }

  const zones = previewData?.dims ? computeCoverZones(previewData.dims) : null;
  const activeCoverUrl = coverPreviewGender === "girl" ? (coverUrlGirl || coverUrl) : coverUrl;

  // Real sampled spine color + contrast-matched text color, same geometry
  // renderCoverSpread uses at print time -- replaces the flat gray
  // placeholder bar with what the spine will actually look like.
  useEffect(() => {
    if (!activeCoverUrl || !previewData?.dims) { setSpineAppearance(null); return; }
    let cancelled = false;
    getSpineAppearance(activeCoverUrl, previewData.dims)
      .then((result) => { if (!cancelled) setSpineAppearance(result); })
      .catch(() => { if (!cancelled) setSpineAppearance(null); });
    return () => { cancelled = true; };
  }, [activeCoverUrl, previewData?.dims]);

  function set<K extends keyof CoverLayout>(key: K, value: CoverLayout[K]) {
    setLayout((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function assemblePrompt(): string | null {
    if (!previewData?.dims) return null;
    return buildCoverPrompt({
      sceneDescription: sceneDescription.trim() || "A warm, inviting children's book scene matching the story's setting.",
    });
  }

  // Seed the editable prompt preview once, as soon as we have enough data to
  // build it -- never overwrites a hand-edit made afterward.
  useEffect(() => {
    if (finalPrompt || !previewData?.dims || !brandSettings) return;
    const built = assemblePrompt();
    if (built) setFinalPrompt(built);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewData, brandSettings]);

  function handleRebuildPrompt() {
    const built = assemblePrompt();
    if (built) setFinalPrompt(built);
  }

  function handlePickScene(imageUrl: string, imageUrlGirl?: string | null) {
    setCoverUrl(imageUrl);
    setCoverUrlGirl(imageUrlGirl ?? "");
    setSaved(false);
    startTransition(async () => {
      try {
        await setCoverImage(story.id, imageUrl, imageUrlGirl);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function handleGenerateWraparound(gender: "boy" | "girl") {
    setError(null);
    const setGenerating = gender === "boy" ? setGeneratingBoy : setGeneratingGirl;
    const heroCharacterId = gender === "boy" ? heroBoyCharId : heroGirlCharId;
    setGenerating(true);
    try {
      const url = await generateCoverSpread(story.id, gender, finalPrompt, heroCharacterId);
      if (gender === "boy") setCoverUrl(url);
      else setCoverUrlGirl(url);
      setCoverPreviewGender(gender);
      setSaved(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateSwapTemplate() {
    setError(null);
    setGeneratingSwapTemplate(true);
    try {
      const url = await generateCoverSwapTemplate(story.id, finalPrompt);
      setCoverSwapTemplateUrl(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingSwapTemplate(false);
    }
  }

  function handleHeroChange(gender: "boy" | "girl", characterId: string | null) {
    const nextBoy = gender === "boy" ? characterId : heroBoyCharId;
    const nextGirl = gender === "girl" ? characterId : heroGirlCharId;
    setHeroBoyCharId(nextBoy);
    setHeroGirlCharId(nextGirl);
    startTransition(async () => {
      try {
        await setCoverHeroCharacters(story.id, nextBoy, nextGirl);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function handleSaveLayout() {
    setSaving(true);
    setError(null);
    startTransition(async () => {
      try {
        await saveCoverLayout(story.id, layout, backLeadingText || null);
        setSaved(true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="flex gap-6 items-start">
        {/* Cover preview */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Preview</h3>
            {(coverUrl || coverUrlGirl) && (
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setCoverPreviewGender("boy")}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${coverPreviewGender === "boy" ? "bg-white shadow-sm font-medium text-gray-700" : "text-gray-400 hover:text-gray-600"}`}
                >
                  👦 Boy
                </button>
                <button
                  onClick={() => setCoverPreviewGender("girl")}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${coverPreviewGender === "girl" ? "bg-white shadow-sm font-medium text-gray-700" : "text-gray-400 hover:text-gray-600"}`}
                >
                  👧 Girl
                </button>
              </div>
            )}
          </div>
          {(() => {
            if (!activeCoverUrl) {
              return (
                <div
                  className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-100 flex flex-col items-center justify-center text-gray-400 gap-2"
                  style={{ aspectRatio: FALLBACK_ASPECT_RATIO }}
                >
                  <span className="text-3xl">📖</span>
                  <span className="text-sm">Generate or pick a scene below to use as cover</span>
                </div>
              );
            }
            return (
              <div
                className="relative rounded-xl overflow-hidden border-2 border-gray-800 bg-gray-100 flex"
                style={{ aspectRatio: zones?.aspectRatio ?? FALLBACK_ASPECT_RATIO, containerType: "size" }}
              >
                {/* Back cover half */}
                <div className="flex-1 relative overflow-hidden" style={{ containerType: "size" }}>
                  <img src={activeCoverUrl} alt="Back cover" className="w-full h-full object-cover" style={{ objectPosition: "left center" }} />
                  {previewData && (
                    <BackCoverOverlay
                      featuredBooks={previewData.backCover.featuredBooks}
                      websiteQrUrl={previewData.backCover.websiteQrDataUrl}
                      instagramQrUrl={previewData.backCover.instagramQrDataUrl}
                      companyName={previewData.backCover.companyName}
                      leadingText={backLeadingText || brandSettings?.back_cover_leading_text || "There's more smiles ahead"}
                      fontFamily={layout.fontFamily}
                    />
                  )}
                </div>

                {/* Spine */}
                <div
                  className="shrink-0 flex items-center justify-center overflow-hidden"
                  style={{
                    width: zones ? `${zones.spineWidthPct}%` : "2%",
                    backgroundColor: spineAppearance?.spineColor ?? "#1f2937",
                    containerType: "inline-size",
                  }}
                >
                  {spineAppearance && (
                    <span
                      className="whitespace-nowrap"
                      style={{
                        writingMode: "vertical-rl",
                        color: spineAppearance.spineTextColor,
                        fontFamily: layout.fontFamily,
                        fontSize: "50cqw",
                        fontWeight: 600,
                      }}
                    >
                      {story.title}{layout.subtitle ? `: ${layout.subtitle}` : ""}
                    </span>
                  )}
                </div>

                {/* Front cover half -- the AI art is a pure scene (no text);
                    title/subtitle/company name are composited here to mirror
                    what renderCoverSpread bakes in at print time. */}
                <div className="flex-1 relative overflow-hidden">
                  <img src={activeCoverUrl} alt="Front cover" className="w-full h-full object-cover" style={{ objectPosition: "right center" }} />
                  <FrontCoverOverlay
                    title={story.title}
                    subtitle={layout.subtitle}
                    companyName={previewData?.backCover.companyName ?? null}
                    titlePosition={layout.titlePosition}
                    titleColor={layout.titleColor}
                    subtitleColor={layout.subtitleColor}
                    titleSize={layout.titleSize}
                    subtitleSize={layout.subtitleSize}
                    overlayOpacity={layout.overlayOpacity}
                    fontFamily={layout.fontFamily}
                  />
                </div>
              </div>
            );
          })()}
          <p className="text-xs text-gray-400">
            {zones ? "Spine width is the real Gelato geometry for this story's page count." : "Spine shown at an approximate width — couldn't load live spine geometry."}
          </p>

          {/* Wraparound cover generation */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Generate wraparound cover</h3>
            <p className="text-xs text-gray-400">
              One continuous AI-generated scene spanning back cover → spine → front cover. Title and subtitle
              are composited on top afterward in the story's real selected font (see Cover typography below).
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Cover hero <span className="font-normal normal-case text-gray-400">(optional — anchors the depicted child's likeness instead of a generic one)</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(["boy", "girl"] as const).map((gender) => {
                  const currentId = gender === "boy" ? heroBoyCharId : heroGirlCharId;
                  const current = allCharacters.find((c) => c.id === currentId);
                  return (
                    <div key={gender}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        {gender === "boy" ? "👦 Boy hero" : "👧 Girl hero"}
                      </label>
                      <select
                        value={currentId ?? ""}
                        onChange={(e) => handleHeroChange(gender, e.target.value || null)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        <option value="">— None (generic) —</option>
                        {allCharacters.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      {current?.sheet_url && (
                        <div className="mt-1.5 rounded-lg overflow-hidden border border-gray-200">
                          <img src={current.sheet_url} alt={current.name} className="w-full object-contain" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Scene description</label>
              <textarea
                value={sceneDescription}
                onChange={(e) => setSceneDescription(e.target.value)}
                placeholder="Describe the cover scene, e.g. a child standing at the edge of an enchanted forest at golden hour…"
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Prompt preview (editable)</label>
                <button
                  onClick={handleRebuildPrompt}
                  disabled={!previewData?.dims}
                  className="text-xs text-brand-600 hover:text-brand-700 disabled:opacity-40 font-medium"
                >
                  ↺ Rebuild from fields
                </button>
              </div>
              <textarea
                value={finalPrompt}
                onChange={(e) => setFinalPrompt(e.target.value)}
                rows={10}
                placeholder={previewData?.dims ? "Fill in a scene description above, then click Rebuild from fields." : "Loading live cover geometry…"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
              />
              <p className="text-xs text-gray-400 mt-1">
                This exact text is what gets sent to Gemini — edit it directly if you want to fine-tune anything.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleGenerateWraparound("boy")}
                disabled={generatingBoy || generatingGirl || !finalPrompt.trim()}
                className="flex-1 text-sm bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold px-3 py-2 rounded-lg disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
              >
                {generatingBoy && <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />}
                {generatingBoy ? "Generating…" : coverUrl ? "🔄 Regenerate (Boy)" : "✨ Generate (Boy)"}
              </button>
              <button
                onClick={() => handleGenerateWraparound("girl")}
                disabled={generatingBoy || generatingGirl || !finalPrompt.trim()}
                className="flex-1 text-sm bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold px-3 py-2 rounded-lg disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
              >
                {generatingGirl && <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />}
                {generatingGirl ? "Generating…" : coverUrlGirl ? "🔄 Regenerate (Girl)" : "✨ Generate (Girl)"}
              </button>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100">
              <button
                onClick={handleGenerateSwapTemplate}
                disabled={generatingSwapTemplate || !finalPrompt.trim() || !coverUrl}
                title={!coverUrl ? "Generate the boy display cover above first — the swap template locks onto its exact scene" : undefined}
                className="w-full text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-3 py-2 rounded-lg disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
              >
                {generatingSwapTemplate && <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />}
                {generatingSwapTemplate ? "Generating…" : coverSwapTemplateUrl ? "🔒 Regenerate swap template" : "🔒 Generate swap template"}
              </button>
              <p className="text-xs text-gray-400 mt-1">
                A blank-hero version used only for order personalization — not shown to customers. Locks onto the boy display cover above so the order-time cover matches exactly what customers browsed; regenerate this whenever that cover changes.
              </p>
              {coverSwapTemplateUrl && (
                <div className="mt-2 rounded-lg overflow-hidden border border-gray-200">
                  <img src={coverSwapTemplateUrl} alt="Swap template (blank hero)" className="w-full object-contain" />
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-xs text-gray-400 mr-1">Age bands:</span>
                {(["1-4", "5-8", "9-12"] as const).map((band) => {
                  const url = coverAgeVariantUrls[band];
                  return (
                    <button
                      key={band}
                      type="button"
                      onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
                      disabled={!url}
                      title={url ? `View ${band} variant` : `${band} variant not generated yet`}
                      className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      {band}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={handleGenerateCoverAgeVariants}
                  disabled={generatingCoverAgeVariants || !coverSwapTemplateUrl}
                  title={!coverSwapTemplateUrl ? "Generate the base swap template first" : "Generate the 1-4 and 9-12 age-band variants (2 Gemini calls)"}
                  className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent transition-colors flex items-center gap-1"
                >
                  {generatingCoverAgeVariants && <span className="w-2.5 h-2.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />}
                  {generatingCoverAgeVariants ? "Generating…" : "⚙ Generate age bands"}
                </button>
              </div>
            </div>
          </div>

          {/* Scene picker */}
          <div>
            <p className="text-xs text-gray-500 font-medium mb-2">
              Or pick from approved scenes
              {approvedPages.length === 0 && <span className="text-amber-500 ml-1">— approve scenes in the Scenes tab first</span>}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {approvedPages.filter((p) => p.image_url).map((page) => {
                const isSelected = coverUrl === page.image_url;
                return (
                  <button
                    key={page.id}
                    onClick={() => handlePickScene(page.image_url!, page.image_url_girl)}
                    className={`rounded-xl overflow-hidden border-2 transition-colors relative group ${
                      isSelected ? "border-brand-500" : "border-gray-200 hover:border-brand-300"
                    }`}
                  >
                    {/* Page number + selected badge */}
                    <div className="flex items-center justify-between px-2 py-1 bg-gray-50 border-b border-gray-100">
                      <span className="text-xs font-medium text-gray-500">Page {page.page_number}</span>
                      {isSelected && (
                        <span className="bg-brand-500 text-white text-xs font-semibold px-1.5 py-0.5 rounded-full">✓</span>
                      )}
                    </div>
                    {/* Boy + Girl thumbnails */}
                    <div className="grid grid-cols-2">
                      <div className="relative">
                        <img src={page.image_url!} alt={`Page ${page.page_number} boy`} className="w-full aspect-[4/3] object-cover" />
                        <span className="absolute bottom-1 left-1 text-xs bg-black/50 text-white px-1 py-0.5 rounded">👦</span>
                      </div>
                      <div className="relative">
                        {page.image_url_girl
                          ? <>
                              <img src={page.image_url_girl} alt={`Page ${page.page_number} girl`} className="w-full aspect-[4/3] object-cover" />
                              <span className="absolute bottom-1 left-1 text-xs bg-black/50 text-white px-1 py-0.5 rounded">👧</span>
                            </>
                          : <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center text-xs text-gray-400">No girl yet</div>
                        }
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Layout controls */}
        <div className="w-64 shrink-0 space-y-5">
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-5">
            <h3 className="text-sm font-semibold text-gray-700">Cover typography</h3>

            {/* Subtitle template */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Subtitle
              </label>
              <input
                value={layout.subtitle}
                onChange={(e) => set("subtitle", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="A story starring {{hero_name}}"
              />
              <p className="text-xs text-gray-400 mt-1">
                Use {"{{hero_name}}"} for the child's name — rendered literally in the template art, swapped
                for the real name at order time.
              </p>
            </div>

            {/* Title/subtitle position */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Title block position
              </label>
              <div className="grid grid-cols-3 gap-1">
                {TITLE_POSITIONS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => set("titlePosition", p.value)}
                    title={p.label}
                    className={`aspect-square rounded-lg border flex items-center justify-center transition-colors ${
                      layout.titlePosition === p.value ? "border-brand-400 bg-brand-50" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${layout.titlePosition === p.value ? "bg-brand-500" : "bg-gray-300"}`} />
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">Where the title/subtitle block is composited on the front cover.</p>
            </div>

            {/* Font */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Font style</label>
              <div className="space-y-3">
                {FONT_CATEGORIES.map((cat) => (
                  <div key={cat.id}>
                    <p className="text-xs text-gray-400 font-medium mb-1">{cat.label}</p>
                    <div className="space-y-1">
                      {FONT_OPTIONS.filter((f) => f.category === cat.id).map((opt) => (
                        <button
                          key={opt.cssFamily}
                          onClick={() => set("fontFamily", opt.cssFamily)}
                          className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center justify-between gap-2 ${
                            layout.fontFamily === opt.cssFamily
                              ? "border-brand-400 bg-brand-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <span
                            className="text-base leading-tight truncate"
                            style={{ fontFamily: opt.cssFamily, color: layout.fontFamily === opt.cssFamily ? "#6d28d9" : "#1f2937" }}
                          >
                            {opt.label}
                          </span>
                          <span className="text-xs text-gray-400 shrink-0">{opt.style}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Rendered exactly, in the real font file, when the title/subtitle are composited onto the cover.
              </p>
            </div>

            {/* Font size */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Title size <span className="font-normal normal-case text-gray-400">({layout.titleSize.toFixed(1)}%)</span>
              </label>
              <input
                type="range"
                min={3}
                max={15}
                step={0.5}
                value={layout.titleSize}
                onChange={(e) => set("titleSize", parseFloat(e.target.value))}
                className="w-full accent-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Subtitle size <span className="font-normal normal-case text-gray-400">({layout.subtitleSize.toFixed(1)}%)</span>
              </label>
              <input
                type="range"
                min={2}
                max={8}
                step={0.5}
                value={layout.subtitleSize}
                onChange={(e) => set("subtitleSize", parseFloat(e.target.value))}
                className="w-full accent-brand-500"
              />
              <p className="text-xs text-gray-400 mt-1">Percent of the front-cover panel height.</p>
            </div>

            {/* Company name (global) */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Company name</label>
              <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                {brandSettings?.company_name || <span className="text-gray-400 italic">Not set</span>}
              </div>
              <a href="/settings" className="text-xs text-brand-600 hover:text-brand-700 font-medium mt-1 inline-block">
                Edit in Settings →
              </a>
            </div>

            {/* Back cover leading text */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Back cover leading text
              </label>
              <input
                value={backLeadingText}
                onChange={(e) => { setBackLeadingText(e.target.value); setSaved(false); }}
                placeholder={brandSettings?.back_cover_leading_text || "There's more smiles ahead"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <p className="text-xs text-gray-400 mt-1">Optional override for this story only — leave blank to use the global default.</p>
            </div>
          </div>

          <button
            onClick={handleSaveLayout}
            disabled={saving}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save cover typography"}
          </button>
        </div>
      </div>
    </div>
  );
}
