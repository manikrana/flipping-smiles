"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { savePageContent } from "./actions";
import { savePageCharacterDescription, generateSinglePageScene, clearPageImages } from "./backgrounds/actions";
import { setPageApproval, setPreviewEligible as setPreviewEligibleAction, generateSceneBleed, generateSpreadScene, setPageVerticalAlign, getPageAgeVariantUrls, generateAgeVariantsForPage, getPageGeminiCallCount } from "./backgrounds/approve/actions";
import { togglePageCharacter, setPageHeroCharacters } from "./page_cast/actions";
import { TokenizeText } from "@/components/TokenizeText";
import { compositePageText } from "./backgrounds/text/actions";
import { EnhancePrompt } from "@/components/EnhancePrompt";
import { patternToCss } from "@/lib/patterns";
import type { TextStyle, TextPanelBg, StoryRow, CastCharacterRow } from "@/lib/supabase/types";

export type PageSummary = {
  id: string;
  page_number: number;
  image_url: string | null;
  image_url_girl: string | null;
  image_approved: boolean;
  preview_eligible: boolean;
  hero_boy_character_id: string | null;
  hero_girl_character_id: string | null;
  text_image_url: string | null;
  text_bg_url: string | null;
  text: string;
  scene_prompt: string;
  scene_prompt_girl: string | null;
  continuity_reference_page_id: string | null;
  vertical_align: "top" | "center" | "bottom" | null;
  character_count_verified: boolean | null;
};

interface Props {
  page: PageSummary;
  story: StoryRow;
  textStyle: TextStyle;
  panelBg: TextPanelBg;
  layoutType: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
  allCharacters: CastCharacterRow[];
  initialPageCast: string[];
  /** All pages in this story — used for the continuity reference picker */
  allPages: PageSummary[];
  onUpdate: (updates: Partial<PageSummary>) => void;
  onDelete: () => void;
}

/** Convert TextPanelBg to a CSS style object for the live preview */
function bgToCss(bg: TextPanelBg | null, textBgUrl?: string | null): React.CSSProperties {
  if (!bg || bg.type === "none") return {};
  if (bg.type === "solid") return { backgroundColor: bg.color };
  if (bg.type === "gradient") {
    const dir =
      bg.direction === "to-bottom" ? "to bottom"
      : bg.direction === "to-right" ? "to right"
      : "to bottom right";
    return { background: `linear-gradient(${dir}, ${bg.from}, ${bg.to})` };
  }
  if (bg.type === "pattern") {
    return patternToCss(bg.patternId, bg.color, bg.bgColor) as React.CSSProperties;
  }
  if (bg.type === "scene_bleed" && textBgUrl) {
    return {
      backgroundImage: `url(${textBgUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return {};
}

export function StoryPagePanel({
  page,
  story,
  textStyle,
  panelBg,
  layoutType,
  allCharacters,
  initialPageCast,
  allPages,
  onUpdate,
  onDelete,
}: Props) {
  const [, startTransition] = useTransition();
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState(page.text);
  const [scenePrompt, setScenePrompt] = useState(page.scene_prompt);
  const [scenePromptGirl, setScenePromptGirl] = useState(page.scene_prompt_girl ?? "");
  const [continuityRefPageId, setContinuityRefPageId] = useState<string | null>(page.continuity_reference_page_id);
  const [continuityPopoverOpen, setContinuityPopoverOpen] = useState(false);
  const continuityPopoverRef = useRef<HTMLDivElement>(null);
  const [charDesc, setCharDesc] = useState<string>("");

  useEffect(() => {
    if (!continuityPopoverOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (continuityPopoverRef.current && !continuityPopoverRef.current.contains(e.target as Node)) {
        setContinuityPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [continuityPopoverOpen]);
  const [sceneCopied, setSceneCopied] = useState(false);

  const [verticalAlign, setVerticalAlign] = useState<"top" | "center" | "bottom">(page.vertical_align ?? "bottom");

  const [characterCountVerified, setCharacterCountVerified] = useState<boolean | null>(page.character_count_verified);
  const [boyUrl, setBoyUrl] = useState<string | null>(page.image_url);
  const [girlUrl, setGirlUrl] = useState<string | null>(page.image_url_girl);
  const [boyGenerating, setBoyGenerating] = useState(false);
  const [girlGenerating, setGirlGenerating] = useState(false);
  const [approved, setApproved] = useState(page.image_approved);
  const [previewEligible, setPreviewEligible] = useState(page.preview_eligible);

  const [textImageUrl, setTextImageUrl] = useState<string | null>(page.text_image_url);
  const [textBgUrl, setTextBgUrl] = useState<string | null>(page.text_bg_url);
  const [bleedGenerating, setBleedGenerating] = useState(false);
  const [spreadBoyGenerating, setSpreadBoyGenerating] = useState(false);
  const [spreadGirlGenerating, setSpreadGirlGenerating] = useState(false);
  const [compositing, setCompositing] = useState(false);

  const [pageCastIds, setPageCastIds] = useState<Set<string>>(new Set(initialPageCast));
  const [heroBoyCharId, setHeroBoyCharId] = useState<string | null>(page.hero_boy_character_id);
  const [heroGirlCharId, setHeroGirlCharId] = useState<string | null>(page.hero_girl_character_id);
  const [previewGender, setPreviewGender] = useState<"boy" | "girl">("boy");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Age-band variant preview -- lets the admin spot-check that the 1-4/9-12
  // derivatives actually resized just the hero and left the rest of the
  // scene untouched. Refetched whenever the page changes or a regen finishes
  // (boyUrl changing is used as a cheap proxy for "a regen just happened").
  const [ageVariantUrls, setAgeVariantUrls] = useState<Record<"1-4" | "5-8" | "9-12", string | null>>({ "1-4": null, "5-8": null, "9-12": null });
  const [generatingAgeVariants, setGeneratingAgeVariants] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPageAgeVariantUrls(page.id).then((urls) => { if (!cancelled) setAgeVariantUrls(urls); });
    return () => { cancelled = true; };
  }, [page.id, boyUrl]);

  // Real Gemini call count for this page (template regens + every order-time
  // attempt that used it) -- refetched alongside the age-band variants.
  const [geminiCallCount, setGeminiCallCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPageGeminiCallCount(page.id).then((n) => { if (!cancelled) setGeminiCallCount(n); });
    return () => { cancelled = true; };
  }, [page.id, boyUrl]);

  // Age-band derivation is a manual, explicit action (not run automatically
  // on every base regen) so testing the core swap pipeline doesn't triple
  // the Gemini cost of every click.
  async function handleGenerateAgeVariants() {
    setGeneratingAgeVariants(true);
    setError(null);
    try {
      await generateAgeVariantsForPage(story.id, page.id);
      const urls = await getPageAgeVariantUrls(page.id);
      setAgeVariantUrls(urls);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingAgeVariants(false);
    }
  }

  const isGenerating = boyGenerating || girlGenerating;
  // girlUrl is null after a regen under the new single-template system (see
  // generateSpreadScene/generateSinglePageScene) -- fall back to boyUrl, same
  // pattern as every other image_url_girl reader in the admin UI.
  const previewImageUrl = previewGender === "boy" ? boyUrl : (girlUrl ?? boyUrl);

  const SCENE_GPT_CONTEXT = `You are helping write scene prompts for Flipping Smiles — a children's book personalization platform. Scene prompts are sent to Gemini to generate a Pixar 3D illustrated storybook scene.

HOW THE SYSTEM WORKS:
- The hero character (the child protagonist) is injected automatically via their character sheet — you do NOT describe their appearance in the prompt.
- Supporting characters are also injected automatically.
- The prompt should describe the ACTION, SETTING, and MOOD of the scene only.

WHAT GEMINI NEEDS:
A short, vivid storybook sentence (1–2 sentences max). Write it like text that would appear on a children's book page — natural and evocative, not a technical image prompt.

RULES:
• Describe what's HAPPENING and WHERE — not who the characters look like.
• Name characters by role (e.g. "Nana", "the hero", "the little fox") — not by appearance.
• Be specific about setting and mood. One strong visual anchor is better than a list.
• Do NOT include camera directions (close-up, wide shot), aspect ratio, or art style — those are handled automatically.
• Keep it to 1–2 sentences.

TEMPLATE:
[Character] [action verb] [in/at/through setting], [mood or sensory detail].

EXAMPLES:
• Arjun splashes through the monsoon puddles, laughing with his arms stretched wide.
• The whole family gathers around the table as Dadi lights the diya.
• Mia and the little fox peek through the tall grass at the glowing fireflies beyond.

FOR GIRL VARIANT PROMPTS (scene_prompt_girl):
Only write one if the girl's outfit or action differs from the boy's scene. Call out the outfit explicitly.
Example: "Priya twirls in her pink lehenga as the crowd watches in awe."

When I give you a scene idea, output the scene prompt in the correct format.`;

  function handleCopySceneGptContext() {
    navigator.clipboard.writeText(SCENE_GPT_CONTEXT).then(() => {
      setSceneCopied(true);
      setTimeout(() => setSceneCopied(false), 2000);
    });
  }

  async function savePrompts() {
    const payload = { text, scene_prompt: scenePrompt, scene_prompt_girl: scenePromptGirl || null, continuity_reference_page_id: continuityRefPageId };
    await savePageContent(page.id, payload);
    onUpdate(payload);
  }

  async function handleContinuityRefChange(pageId: string | null) {
    setContinuityRefPageId(pageId);
    try {
      await savePageContent(page.id, {
        text, scene_prompt: scenePrompt, scene_prompt_girl: scenePromptGirl || null,
        continuity_reference_page_id: pageId,
      });
      onUpdate({ continuity_reference_page_id: pageId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleTextBlur() {
    startTransition(async () => {
      try { await savePrompts(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });
  }

  const handleScenePromptBlur = handleTextBlur;
  const handleScenePromptGirlBlur = handleTextBlur;

  async function handleSavePrompts() {
    setPromptSaving(true);
    setPromptSaved(false);
    try {
      await savePrompts();
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPromptSaving(false);
    }
  }

  function handleCharDescBlur() {
    startTransition(async () => {
      try {
        await savePageCharacterDescription(page.id, charDesc);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function handleClearImages() {
    if (!confirm("Clear both boy and girl images for this page? This cannot be undone.")) return;
    setError(null);
    try {
      await clearPageImages(story.id, page.id);
      setBoyUrl(null);
      setGirlUrl(null);
      onUpdate({ image_url: null, image_url_girl: null, image_approved: false });
      setApproved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // The hero is now a blank silhouette, shared by every order regardless of
  // gender -- there's only one scene per page anymore. This still takes a
  // "boy"/"girl" arg since it's invoked from two pre-existing buttons (not
  // yet collapsed to one), but both now produce and show the same single
  // regenerated image.
  async function handleRegenGender(gender: "boy" | "girl") {
    if (gender === "boy") setBoyGenerating(true);
    else setGirlGenerating(true);
    setError(null);
    try {
      await savePrompts(); // ensure latest prompts are in DB before generation fetches them
      const result = await generateSinglePageScene(story.id, page.id);
      const url = result.boyImageUrl ?? null;
      setBoyUrl(url);
      setGirlUrl(url);
      onUpdate({ image_url: url, image_url_girl: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gender === "boy") setBoyGenerating(false);
      else setGirlGenerating(false);
    }
  }

  async function handleToggleApproval() {
    const next = !approved;
    setApproved(next);
    onUpdate({ image_approved: next });
    try {
      await setPageApproval(story.id, page.id, next);
    } catch (e) {
      setApproved(!next);
      onUpdate({ image_approved: !next });
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleTogglePageCharacter(characterId: string) {
    const adding = !pageCastIds.has(characterId);
    setPageCastIds((prev) => {
      const next = new Set(prev);
      adding ? next.add(characterId) : next.delete(characterId);
      return next;
    });
    startTransition(async () => {
      try {
        await togglePageCharacter(story.id, page.id, characterId, adding);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPageCastIds((prev) => {
          const next = new Set(prev);
          adding ? next.delete(characterId) : next.add(characterId);
          return next;
        });
      }
    });
  }

  function handleHeroChange(gender: "boy" | "girl", characterId: string | null) {
    const nextBoy  = gender === "boy"  ? characterId : heroBoyCharId;
    const nextGirl = gender === "girl" ? characterId : heroGirlCharId;
    if (gender === "boy")  setHeroBoyCharId(characterId);
    if (gender === "girl") setHeroGirlCharId(characterId);
    onUpdate({ hero_boy_character_id: nextBoy, hero_girl_character_id: nextGirl });
    startTransition(async () => {
      try {
        await setPageHeroCharacters(story.id, page.id, nextBoy, nextGirl);
      } catch (e) {
        // Revert on error
        if (gender === "boy")  setHeroBoyCharId(heroBoyCharId);
        if (gender === "girl") setHeroGirlCharId(heroGirlCharId);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function handleComposite() {
    if (!boyUrl) { setError("Generate an image first"); return; }
    setCompositing(true);
    setError(null);
    try {
      const { textImageUrl: newUrl } = await compositePageText(story.id, page.id, textStyle);
      setTextImageUrl(newUrl);
      onUpdate({ text_image_url: newUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompositing(false);
    }
  }

  // ── Live layout preview ──────────────────────────────────────────────────
  const textStyleCss: React.CSSProperties = {
    fontFamily: textStyle.fontFamily,
    fontSize: `${textStyle.fontSizePct * 2.8}px`,
    color: textStyle.color,
    textAlign: textStyle.alignment,
    lineHeight: 1.6,
  };

  const isSpread = layoutType === "spread_left" || layoutType === "spread_right" || layoutType === "spread_left_clean" || layoutType === "spread_right_clean";

  const LayoutPreview = (
    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      {/* Gender toggle */}
      {(boyUrl || girlUrl) && (
        <div className="flex border-b border-gray-100 bg-gray-50 px-3 py-1.5 gap-2">
          {(["boy", "girl"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setPreviewGender(g)}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                previewGender === g ? "bg-white shadow-sm text-gray-700" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {g === "boy" ? "👦 Boy" : "👧 Girl"}
            </button>
          ))}
          <button
            onClick={() => setLightboxUrl(previewImageUrl)}
            disabled={!previewImageUrl}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30"
          >
            Expand ↗
          </button>
        </div>
      )}

      {isSpread ? (
        /* spread_left / spread_right — show full 2:1 thumbnail with text overlay */
        <div className="relative bg-gray-100 rounded-xl overflow-hidden" style={{ aspectRatio: "2/1", containerType: "size" }}>
          {previewImageUrl ? (
            <>
              <img src={previewImageUrl} alt="" className="w-full h-full object-cover" />
              {/* Text overlaid on text half — frosted pill behind text only */}
              <div
                className="absolute flex justify-center px-3 text-center"
                style={{
                  left:  (layoutType === "spread_right" || layoutType === "spread_right_clean") ? 0 : "50%",
                  right: (layoutType === "spread_right" || layoutType === "spread_right_clean") ? "50%" : 0,
                  ...(verticalAlign === "top"
                    ? { top: "8%", bottom: "auto", alignItems: "flex-start" }
                    : verticalAlign === "center"
                    ? { top: 0, bottom: 0, alignItems: "center" }
                    : { top: "auto", bottom: "8%", alignItems: "flex-end" }),
                }}
              >
                <p
                  className="whitespace-pre-wrap leading-relaxed rounded-2xl px-2.5 py-2"
                  style={{
                    ...textStyleCss,
                    fontSize: `${textStyle.fontSizePct}cqh`,
                    ...(textStyle.textBoxBg !== "none" ? {
                      backgroundColor: "rgba(255,255,255,0.55)",
                      backdropFilter: "blur(6px)",
                      WebkitBackdropFilter: "blur(6px)",
                    } : {}),
                  }}
                >
                  {text || <span className="text-gray-300 italic" style={{ fontSize: `${textStyle.fontSizePct * 1.4}cqh` }}>Story text appears here…</span>}
                </p>
              </div>
              {/* Seam indicator */}
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-2xl">?</div>
          )}
        </div>
      ) : (layoutType === "split_image_left" || layoutType === "split_image_right") ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          {/* Image half — square. For split_image_right, image goes second (CSS order) */}
          <div
            className="bg-gray-100 relative"
            style={{ aspectRatio: "1/1", order: layoutType === "split_image_right" ? 2 : 1 }}
          >
            {previewImageUrl ? (
              <img src={previewImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-3xl">?</div>
            )}
          </div>
          {/* Text panel half — square */}
          <div
            className="flex items-center justify-center p-5"
            style={{ aspectRatio: "1/1", order: layoutType === "split_image_right" ? 1 : 2, ...bgToCss(panelBg, textBgUrl) }}
          >
            <p style={textStyleCss} className="w-full whitespace-pre-wrap">
              {text || <span className="text-gray-300 italic text-xs">Story text appears here…</span>}
            </p>
          </div>
        </div>
      ) : (
        /* overlay_bottom */
        <div className="relative" style={{ aspectRatio: "1/1" }}>
          <div className="absolute inset-0 bg-gray-100">
            {previewImageUrl ? (
              <img src={previewImageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300 text-3xl">?</div>
            )}
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 px-5 py-4"
            style={{
              ...bgToCss(panelBg, textBgUrl),
              ...(panelBg.type === "solid" ? {
                backgroundColor: `${panelBg.color}${Math.round(
                  (textStyle.bgOpacity ?? 0.85) * 255
                ).toString(16).padStart(2, "0")}`,
              } : {}),
            }}
          >
            <p style={textStyleCss} className="whitespace-pre-wrap">
              {text || <span className="text-gray-300 italic text-xs">Story text appears here…</span>}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Page {page.page_number}</h2>
        <div className="flex items-center gap-3">
          {approved && (
            <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">
              ✓ Approved
            </span>
          )}
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600 transition-colors">
            Delete page
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          {error.includes("503") || error.includes("high demand") || error.includes("fetch failed")
            ? "Gemini is overloaded right now — please try again in a moment."
            : error.includes("No image")
            ? "Generation returned no image. Try again."
            : error}
          <button className="underline ml-3 shrink-0" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* ── Section 1: Story text ─────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Story text</h3>
          {text.trim() && (
            <TokenizeText currentValue={text} onApply={(v) => setText(v)} />
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleTextBlur}
          rows={6}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder={`Once upon a time, {{hero_name}} discovered…`}
        />
        <p className="text-xs text-gray-400">
          Use <code className="bg-gray-100 px-1 rounded">{"{{hero_name}}"}</code> where the child's name appears.
          Auto-saved on blur.
        </p>

        {/* Vertical alignment */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Text box position</p>
          <div className="flex gap-2">
            {(["top", "center", "bottom"] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setVerticalAlign(v);
                  startTransition(async () => {
                    try { await setPageVerticalAlign(story.id, page.id, v); }
                    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                  });
                }}
                className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  verticalAlign === v
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-gray-200 hover:border-gray-300 text-gray-500"
                }`}
              >
                {v === "top" ? "⬆ Top" : v === "center" ? "⬛ Mid" : "⬇ Bottom"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 2: Scene ──────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Scene</h3>
          <button
            onClick={handleSavePrompts}
            disabled={promptSaving}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {promptSaving ? "Saving…" : promptSaved ? "Saved ✓" : "Save prompts"}
          </button>
        </div>

        {/* Scene prompt — boy / default */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-xs font-medium text-gray-500">Prompt</label>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">👦 Boy</span>
            <button
              onClick={handleCopySceneGptContext}
              className="text-[11px] text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded px-2 py-0.5 transition-colors"
              title="Copy prompt context for ChatGPT / Claude"
            >
              {sceneCopied ? "✓ Copied!" : "Copy GPT context"}
            </button>
            {scenePrompt.trim() && (
              <EnhancePrompt type="scene" currentValue={scenePrompt} onApply={setScenePrompt} />
            )}
          </div>
          <textarea
            value={scenePrompt}
            onChange={(e) => setScenePrompt(e.target.value)}
            onBlur={handleScenePromptBlur}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="e.g. standing at the edge of a cliff looking out at a misty valley, wide shot"
          />
        </div>

        {/* Scene prompt — girl override */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-xs font-medium text-gray-500">Prompt</label>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">👧 Girl</span>
            <span className="text-[10px] text-gray-400">· leave blank to use boy prompt</span>
            {scenePromptGirl.trim() && (
              <EnhancePrompt type="scene" currentValue={scenePromptGirl} onApply={setScenePromptGirl} />
            )}
          </div>
          <textarea
            value={scenePromptGirl}
            onChange={(e) => setScenePromptGirl(e.target.value)}
            onBlur={handleScenePromptGirlBlur}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="e.g. Priya wears a pink lehenga… (override for girl variant)"
          />
        </div>

        {/* Hero character pickers */}
        <div className="grid grid-cols-2 gap-3">
          {(["boy", "girl"] as const).map((gender) => {
            const currentId = gender === "boy" ? heroBoyCharId : heroGirlCharId;
            const current = allCharacters.find((c) => c.id === currentId);
            return (
              <div key={gender}>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {gender === "boy" ? "👦 Boy hero" : "👧 Girl hero"}
                  <span className="text-red-400 ml-0.5">*</span>
                </label>
                <select
                  value={currentId ?? ""}
                  onChange={(e) => handleHeroChange(gender, e.target.value || null)}
                  className={`w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white ${
                    !currentId ? "border-red-300 text-gray-400" : "border-gray-300 text-gray-700"
                  }`}
                >
                  <option value="">— Select hero —</option>
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

        {/* Other characters on this page */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Characters on this page</label>
          <div className="flex flex-wrap gap-1.5">
            {allCharacters.map((c) => {
                const sel = pageCastIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => handleTogglePageCharacter(c.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                      sel
                        ? "bg-brand-50 border-brand-400 text-brand-700"
                        : "bg-white border-gray-200 text-gray-500 hover:border-gray-400"
                    }`}
                  >
                    {c.reference_url && (
                      <img src={c.reference_url} alt="" className="w-4 h-4 rounded-full object-cover" />
                    )}
                    {c.name}
                    {sel && <span className="text-brand-500 text-[10px]">✓</span>}
                  </button>
                );
              })}
          </div>
        </div>

        {/* Continuity reference — popover trigger */}
        {(() => {
          const otherPages = allPages.filter((p) => p.id !== page.id && (p.image_url || p.image_url_girl));
          const refPage = allPages.find((p) => p.id === continuityRefPageId);
          const refThumb = refPage?.image_url ?? refPage?.image_url_girl;
          return (
            <div className="relative" ref={continuityPopoverRef}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setContinuityPopoverOpen((o) => !o)}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    continuityRefPageId
                      ? "border-brand-400 bg-brand-50 text-brand-700"
                      : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
                >
                  {refThumb ? (
                    <img src={refThumb} alt="" className="w-4 h-4 rounded object-cover" />
                  ) : (
                    <span>🔗</span>
                  )}
                  {refPage ? `Continuity: P${refPage.page_number}` : "Continuity ref…"}
                </button>
                {continuityRefPageId && (
                  <button
                    onClick={() => handleContinuityRefChange(null)}
                    className="text-[11px] text-gray-400 hover:text-red-500 transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>

              {continuityPopoverOpen && (
                <div className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-white rounded-xl shadow-xl border border-gray-200 p-3">
                  <p className="text-[11px] text-gray-400 mb-2.5">
                    Pick a scene to anchor shared environment — materials, architecture, lighting — into this generation.
                  </p>
                  {otherPages.length === 0 ? (
                    <p className="text-[11px] text-gray-300 italic">No other scenes generated yet.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {otherPages.map((p) => {
                        const thumb = p.image_url ?? p.image_url_girl;
                        const selected = p.id === continuityRefPageId;
                        return (
                          <button
                            key={p.id}
                            onClick={() => {
                              handleContinuityRefChange(selected ? null : p.id);
                              setContinuityPopoverOpen(false);
                            }}
                            className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                              selected ? "border-brand-500 ring-2 ring-brand-200" : "border-gray-200 hover:border-gray-400"
                            }`}
                            title={`Page ${p.page_number}`}
                          >
                            {thumb ? (
                              <img src={thumb} alt={`Page ${p.page_number}`} className="w-full aspect-square object-cover" />
                            ) : (
                              <div className="w-full aspect-square bg-gray-100 flex items-center justify-center text-gray-300 text-xs">?</div>
                            )}
                            <div className={`absolute bottom-0 inset-x-0 text-center text-[9px] font-medium py-0.5 ${
                              selected ? "bg-brand-500 text-white" : "bg-black/40 text-white"
                            }`}>
                              P{p.page_number}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Character description override (collapsed by default) */}
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
            Override hero description for this page
          </summary>
          <textarea
            value={charDesc}
            onChange={(e) => setCharDesc(e.target.value)}
            onBlur={handleCharDescBlur}
            rows={2}
            className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="e.g. wearing a spacesuit instead of the usual red t-shirt…"
          />
        </details>

        {/* Images row */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            {(["boy", "girl"] as const).map((gender) => {
              // girlUrl is null after a regen under the new single-template
              // system -- fall back to boyUrl so the thumbnail doesn't look
              // like generation never happened.
              const url = gender === "boy" ? boyUrl : (girlUrl ?? boyUrl);
              const generating = isSpread
                ? (gender === "boy" ? spreadBoyGenerating : spreadGirlGenerating)
                : (gender === "boy" ? boyGenerating : girlGenerating);
              return (
                <div key={gender} className="space-y-1">
                  <div className="text-xs font-medium text-gray-400 text-center">
                    {gender === "boy" ? "👦 Boy" : "👧 Girl"}
                  </div>
                  <div className="relative aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                    {generating ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-50">
                        <span className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
                        <span className="text-xs text-gray-400">Generating…</span>
                      </div>
                    ) : url ? (
                      <>
                        <img
                          src={url} alt=""
                          className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setLightboxUrl(url)}
                        />
                        <button
                          onClick={() => isSpread
                            ? (() => {
                                if (gender === "boy") setSpreadBoyGenerating(true);
                                else setSpreadGirlGenerating(true);
                                setError(null);
                                startTransition(async () => {
                                  try {
                                    await savePrompts();
                                    const sceneDir = (layoutType === "spread_left" || layoutType === "spread_left_clean") ? "left" : "right";
                                    const withBleed = layoutType === "spread_left" || layoutType === "spread_right";
                                    const { url: newUrl, characterCountVerified: verified } = await generateSpreadScene(story.id, page.id, sceneDir, withBleed);
                                    setBoyUrl(newUrl); setGirlUrl(newUrl);
                                    setCharacterCountVerified(verified);
                                    onUpdate({ image_url: newUrl, image_url_girl: newUrl, character_count_verified: verified });
                                  } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                                  finally {
                                    if (gender === "boy") setSpreadBoyGenerating(false);
                                    else setSpreadGirlGenerating(false);
                                  }
                                });
                              })()
                            : handleRegenGender(gender)
                          }
                          disabled={isGenerating || spreadBoyGenerating || spreadGirlGenerating}
                          className="absolute bottom-1.5 right-1.5 text-[10px] bg-black/60 hover:bg-black/80 text-white px-2 py-0.5 rounded-md disabled:opacity-40"
                        >
                          {isSpread ? "Regen spread" : "Regen"}
                        </button>
                      </>
                    ) : isSpread ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <span className="text-gray-300 text-2xl">?</span>
                        <button
                          onClick={() => {
                            if (gender === "boy") setSpreadBoyGenerating(true);
                            else setSpreadGirlGenerating(true);
                            setError(null);
                            startTransition(async () => {
                              try {
                                await savePrompts();
                                const sceneDir = (layoutType === "spread_left" || layoutType === "spread_left_clean") ? "left" : "right";
                                const withBleed = layoutType === "spread_left" || layoutType === "spread_right";
                                const { url: newUrl, characterCountVerified: verified } = await generateSpreadScene(story.id, page.id, sceneDir, withBleed);
                                setBoyUrl(newUrl); setGirlUrl(newUrl);
                                setCharacterCountVerified(verified);
                                onUpdate({ image_url: newUrl, image_url_girl: newUrl, character_count_verified: verified });
                              } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                              finally {
                                if (gender === "boy") setSpreadBoyGenerating(false);
                                else setSpreadGirlGenerating(false);
                              }
                            });
                          }}
                          disabled={spreadBoyGenerating || spreadGirlGenerating || !scenePrompt.trim()}
                          className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1 rounded-lg disabled:opacity-40 transition-colors"
                        >
                          Generate spread
                        </button>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <span className="text-gray-300 text-2xl">?</span>
                        <button
                          onClick={() => handleRegenGender(gender)}
                          disabled={
                            isGenerating ||
                            !scenePrompt.trim() ||
                            (gender === "girl" && !boyUrl) ||
                            (gender === "boy" && !heroBoyCharId) ||
                            (gender === "girl" && !heroGirlCharId)
                          }
                          className="text-xs bg-brand-500 hover:bg-brand-600 text-white px-3 py-1 rounded-lg disabled:opacity-40 transition-colors"
                          title={
                            gender === "girl" && !boyUrl ? "Generate boy first" :
                            gender === "boy" && !heroBoyCharId ? "Select a boy hero first" :
                            gender === "girl" && !heroGirlCharId ? "Select a girl hero first" :
                            undefined
                          }
                        >
                          Generate
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {characterCountVerified === false && (
            <div className="flex items-center gap-1.5 pt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              ⚠ Unexpected character count — a quality check flagged this render as having the wrong number of people. Spot-check it and regen if needed.
            </div>
          )}

          {/* Age-band variant preview */}
          <div className="flex items-center gap-1.5 pt-1">
            {geminiCallCount !== null && (
              <span className="text-xs text-gray-400 mr-2" title="Total logged Gemini calls for this page (template + order-time)">
                🔢 {geminiCallCount} call{geminiCallCount === 1 ? "" : "s"}
              </span>
            )}
            <span className="text-xs text-gray-400 mr-1">Age bands:</span>
            {(["1-4", "5-8", "9-12"] as const).map((band) => {
              const url = ageVariantUrls[band];
              return (
                <button
                  key={band}
                  type="button"
                  onClick={() => url && setLightboxUrl(url)}
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
              onClick={handleGenerateAgeVariants}
              disabled={generatingAgeVariants || !boyUrl}
              title={!boyUrl ? "Generate the base scene first" : "Generate the 1-4 and 9-12 age-band variants (2 Gemini calls)"}
              className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent transition-colors flex items-center gap-1"
            >
              {generatingAgeVariants && <span className="w-2.5 h-2.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />}
              {generatingAgeVariants ? "Generating…" : "⚙ Generate age bands"}
            </button>
          </div>

          {/* Actions row */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleToggleApproval}
              disabled={isGenerating || !boyUrl}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 ${
                approved
                  ? "bg-green-50 border-green-400 text-green-700"
                  : "bg-white border-gray-300 text-gray-500 hover:border-gray-400"
              }`}
            >
              {approved ? "Approved ✓" : "Approve"}
            </button>
            <button
              onClick={() => {
                const next = !previewEligible;
                setPreviewEligible(next);
                onUpdate({ preview_eligible: next });
                startTransition(async () => {
                  try {
                    await setPreviewEligibleAction(story.id, page.id, next);
                  } catch {
                    setPreviewEligible(!next);
                    onUpdate({ preview_eligible: !next });
                  }
                });
              }}
              disabled={!boyUrl}
              className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 ${
                previewEligible
                  ? "bg-purple-50 border-purple-400 text-purple-700"
                  : "bg-white border-gray-300 text-gray-500 hover:border-gray-400"
              }`}
            >
              {previewEligible ? "Preview ✓" : "Preview"}
            </button>
            {/* Split layout: existing bleed button */}
            {!isSpread && panelBg.type === "scene_bleed" && boyUrl && (
              <button
                onClick={() => {
                  setBleedGenerating(true);
                  startTransition(async () => {
                    try {
                      const bleedFrom = layoutType === "split_image_left" ? "left" : "right";
                      const url = await generateSceneBleed(story.id, page.id, bleedFrom);
                      setTextBgUrl(url);
                    } finally {
                      setBleedGenerating(false);
                    }
                  });
                }}
                disabled={bleedGenerating}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 ${
                  textBgUrl
                    ? "bg-indigo-50 border-indigo-400 text-indigo-700"
                    : "bg-white border-gray-300 text-gray-500 hover:border-gray-400"
                }`}
              >
                {bleedGenerating ? "Generating…" : textBgUrl ? "✦ Bleed ✓" : "✦ Bleed"}
              </button>
            )}
            {(boyUrl || girlUrl) && (
              <button
                onClick={handleClearImages}
                disabled={isGenerating}
                className="ml-auto px-3 py-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium transition-colors disabled:opacity-40"
              >
                Clear images
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Section 3: Layout preview ─────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Preview</h3>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
            {layoutType === "split_image_left" ? "Split · image left"
              : layoutType === "split_image_right" ? "Split · image right"
              : layoutType === "spread_left" ? "Spread · scene left"
              : layoutType === "spread_left_clean" ? "Spread · scene left (clean)"
              : layoutType === "spread_right" ? "Spread · scene right"
              : layoutType === "spread_right_clean" ? "Spread · scene right (clean)"
              : "Overlay"} · live
          </span>
        </div>
        {LayoutPreview}
        <div className="flex items-center gap-2">
          <button
            onClick={handleComposite}
            disabled={compositing || !boyUrl}
            className="text-sm font-medium border border-gray-300 text-gray-600 hover:border-gray-400 hover:bg-gray-50 rounded-lg px-4 py-2 disabled:opacity-40 transition-colors flex items-center gap-2"
          >
            {compositing && <span className="w-3 h-3 border-2 border-gray-400/50 border-t-gray-600 rounded-full animate-spin" />}
            {compositing ? "Compositing…" : textImageUrl ? "Regenerate composite" : "Save composite"}
          </button>
          {textImageUrl && (
            <button onClick={() => setLightboxUrl(textImageUrl)} className="text-xs text-gray-400 hover:text-gray-600">
              View saved ↗
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">Required for publishing</span>
        </div>
      </section>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          {isSpread && lightboxUrl === previewImageUrl ? (
            <div
              className="relative rounded-lg shadow-2xl overflow-hidden"
              style={{ aspectRatio: "2/1", maxWidth: "90vw", maxHeight: "90vh", width: "90vw" }}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={lightboxUrl} alt="Preview" className="w-full h-full object-cover" />
              <div
                className="absolute flex justify-center px-3 text-center"
                style={{
                  left:  (layoutType === "spread_right" || layoutType === "spread_right_clean") ? 0 : "50%",
                  right: (layoutType === "spread_right" || layoutType === "spread_right_clean") ? "50%" : 0,
                  ...(verticalAlign === "top"
                    ? { top: "8%", bottom: "auto", alignItems: "flex-start" }
                    : verticalAlign === "center"
                    ? { top: 0, bottom: 0, alignItems: "center" }
                    : { top: "auto", bottom: "8%", alignItems: "flex-end" }),
                }}
              >
                <p
                  className="whitespace-pre-wrap leading-relaxed rounded-2xl px-2.5 py-2"
                  style={{
                    ...textStyleCss,
                    fontSize: `${textStyle.fontSizePct * 0.45}vh`,
                    ...(textStyle.textBoxBg !== "none" ? {
                      backgroundColor: "rgba(255,255,255,0.55)",
                      backdropFilter: "blur(6px)",
                      WebkitBackdropFilter: "blur(6px)",
                    } : {}),
                  }}
                >
                  {text}
                </p>
              </div>
            </div>
          ) : (
            <img
              src={lightboxUrl} alt="Preview"
              className="max-w-4xl max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-gray-300">×</button>
        </div>
      )}
    </div>
  );
}
