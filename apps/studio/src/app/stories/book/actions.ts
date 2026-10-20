"use server";

import { createServerClient } from "@/lib/supabase/server";
import { signAsset, signAssets, resolveStoragePath } from "@/lib/supabase/assets";
import { revalidatePath } from "next/cache";
import { getGemini, NANO_BANANA_2_MODEL, extractImageBuffer, urlToInlineData } from "@/lib/gemini";
import { getCoverDimensions, GELATO_MIN_PAGES, GELATO_MAX_PAGES } from "@/lib/gelato";
import type { GelatoCoverDimensions } from "@/lib/gelato";
import type { CoverLayout, TextStyle } from "@/lib/supabase/types";
import { HERO_SILHOUETTE_INSTRUCTION, storeAgeVariants } from "@/lib/heroSilhouette";
import { logGeminiCall } from "@/lib/geminiLog";

// Signed URLs for all 3 age-band variants of a story's cover swap template,
// for the admin band-switcher preview in CoverEditor.tsx. "5-8" is always
// resolved from the story's current swap template (never from a stored row
// -- see the comment on storeAgeVariants). "1-4" and "9-12" return null when
// not yet generated.
export async function getCoverAgeVariantUrls(storyId: string): Promise<Record<"1-4" | "5-8" | "9-12", string | null>> {
  const supabase = createServerClient();
  const [{ data: story }, { data: variants }] = await Promise.all([
    supabase.from("stories").select("cover_swap_template_url").eq("id", storyId).single(),
    supabase.from("story_cover_age_variants").select("age_band, image_url").eq("story_id", storyId).in("age_band", ["1-4", "9-12"]),
  ]);

  const result: Record<"1-4" | "5-8" | "9-12", string | null> = {
    "1-4": null,
    "5-8": story?.cover_swap_template_url ? await signAsset(supabase, story.cover_swap_template_url) : null,
    "9-12": null,
  };
  await Promise.all(
    (variants ?? []).map(async (row) => {
      if (row.image_url) result[row.age_band as "1-4" | "9-12"] = await signAsset(supabase, row.image_url);
    })
  );
  return result;
}

export type CoverPreviewData = {
  dims: GelatoCoverDimensions | null;
  innerPageCount: number;
  backCover: {
    websiteQrDataUrl: string | null;
    instagramQrDataUrl: string | null;
    companyName: string | null;
    leadingText: string | null;
    featuredBooks: { title: string; coverUrl: string | null }[];
  };
};

// Shared by every "show the real wraparound cover" preview surface
// (CoverEditor, PreviewPanel, BookPagesEditor, OrderBookPreview) so they all
// derive the same real geometry + back-cover content the same way, instead
// of four separate re-implementations drifting apart. `dims` is null when
// the story's page count falls outside Gelato's valid 28-200 range (e.g. an
// in-progress draft) or the live lookup fails -- callers should fall back to
// a plain (non-spread) preview in that case, not treat it as an error.
//
// Website/Instagram QR targets come from the single global brand_settings
// row now, not per-story columns -- every book shares the same two QR codes.
export async function getCoverPreviewData(storyId: string): Promise<CoverPreviewData> {
  const supabase = createServerClient();

  const { data: rawStory } = await supabase
    .from("stories")
    .select("id, layout_type, dedication_text, end_page_image_url, back_cover_featured_story_ids, back_cover_tagline, story_pages ( id )")
    .eq("id", storyId)
    .single();
  if (!rawStory) throw new Error("Story not found");
  const story = rawStory as unknown as {
    layout_type: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean" | null;
    dedication_text: string | null;
    end_page_image_url: string | null;
    back_cover_featured_story_ids: string[] | null;
    back_cover_tagline: string | null;
    story_pages: { id: string }[];
  };

  const { estimateInnerPageCount } = await import("@/lib/pdf");
  const innerPageCount = estimateInnerPageCount({
    layoutType: story.layout_type ?? "overlay_bottom",
    storyPageCount: (story.story_pages ?? []).length,
    hasEndPage: !!story.end_page_image_url,
  });

  let dims: GelatoCoverDimensions | null = null;
  if (innerPageCount >= GELATO_MIN_PAGES && innerPageCount <= GELATO_MAX_PAGES) {
    try {
      dims = await getCoverDimensions(innerPageCount);
    } catch {
      dims = null;
    }
  }

  const featuredIds = story.back_cover_featured_story_ids ?? [];
  let featuredBooks: { title: string; coverUrl: string | null }[] = [];
  if (featuredIds.length > 0) {
    const { data: featured } = await supabase.from("stories").select("id, title, cover_image_url").in("id", featuredIds);
    const byId = new Map((featured ?? []).map((f: { id: string; title: string; cover_image_url: string | null }) => [f.id, f]));
    const paths = (featured ?? [])
      .map((f: { cover_image_url: string | null }) => f.cover_image_url)
      .filter((p): p is string => !!p)
      .map(resolveStoragePath);
    const signedMap = await signAssets(supabase, [...new Set(paths)]);
    featuredBooks = featuredIds
      .map((id) => byId.get(id))
      .filter((f): f is { id: string; title: string; cover_image_url: string | null } => !!f)
      .map((f) => ({
        title: f.title,
        coverUrl: f.cover_image_url ? (signedMap[resolveStoragePath(f.cover_image_url)] ?? null) : null,
      }));
  }

  const { getBrandSettings } = await import("@/app/settings/actions");
  const brand = await getBrandSettings();

  const { toDataURL } = await import("qrcode");
  const websiteQrDataUrl = brand.website_url ? await toDataURL(brand.website_url, { margin: 1 }) : null;
  const instagramQrDataUrl = brand.instagram_url ? await toDataURL(brand.instagram_url, { margin: 1 }) : null;

  return {
    dims,
    innerPageCount,
    backCover: {
      websiteQrDataUrl,
      instagramQrDataUrl,
      companyName: brand.company_name ? `${brand.company_name}™` : null,
      leadingText: story.back_cover_tagline || brand.back_cover_leading_text || null,
      featuredBooks,
    },
  };
}

// Thin wrapper over lib/layout.ts's computeSpineAppearance -- lets
// CoverEditor and OrderBookPreview (both client components, re-fetching
// whenever the active cover image changes) show the real sampled spine
// color + contrast-matched text color instead of a flat gray placeholder.
// Pure image math (sharp), no Gemini cost.
export async function getSpineAppearance(coverImageUrl: string, dims: GelatoCoverDimensions) {
  const { computeSpineAppearance } = await import("@/lib/layout");
  return computeSpineAppearance(coverImageUrl, dims);
}

// Fixed template-generation canvas for the wraparound cover. Not tied to any
// specific order's exact Gelato dimensions (those vary slightly with spine
// width, resolved live at print time) -- just close enough (1.882:1, inside
// Gelato's real 1.862-1.915 range) to minimize crop distortion later.
const COVER_CANVAS_WIDTH = 4800;
const COVER_CANVAS_HEIGHT = 2550;
const COVER_PANEL_WIDTH = COVER_CANVAS_WIDTH / 2;

// Generates one continuous wraparound cover image (back cover + spine gap +
// front cover, one seamless scene, both halves full detail) via Nano Banana,
// modeled on generateSpreadScene (backgrounds/approve/actions.ts) -- same
// "one wide image, one seamless scene" technique and the same region-aware
// split + force-resize post-processing so the output is immune to the model
// not preserving exact requested dimensions.
//
// `finalPrompt` is the fully-assembled (and possibly hand-edited) prompt text
// from CoverEditor's prompt-preview box -- see lib/coverPrompt.ts's
// buildCoverPrompt, which the client calls to seed that preview using the
// same live Gelato geometry (getCoverPreviewData) it already has. This action
// no longer builds the prompt itself, so whatever the admin sees in the
// preview box is exactly what gets sent to Gemini.
//
// `heroCharacterId`, when set, anchors the depicted hero to a real
// cast_characters reference instead of Gemini inventing a generic child --
// same "reference sheet image + caption, then the text prompt" technique as
// generateSpreadScene (backgrounds/approve/actions.ts), just applied to the
// cover instead of a page. Null falls back to the original text-only call.
//
// Pure scene generation -- no title/subtitle/company-name text is asked for
// here at all (see lib/coverPrompt.ts). That's composited afterward as real
// SVG text in the story's actual font file (renderCoverSpread), which sidesteps
// two problems at once: font fidelity (Gemini can only approximate a named
// font, never reproduce its real letterforms) and back-cover continuity (an
// earlier attempt at baking text in caused the model to echo/duplicate the
// title across the seam when the back cover was regenerated). The back-cover
// zone itself uses buildCoverPrompt's dissolve treatment rather than asking
// for an equally-detailed, independently-composed scene that has to visually
// agree with the front -- a single Gemini call naturally shares scene context
// across the whole canvas, which is what makes this reliable in one shot
// (generateSpreadScene proves this pattern works for story pages already).
export async function generateCoverSpread(
  storyId: string,
  gender: "boy" | "girl",
  finalPrompt: string,
  heroCharacterId: string | null,
): Promise<string> {
  const supabase = createServerClient();

  if (!finalPrompt?.trim()) throw new Error("Cover prompt is required");

  let heroSheetUrl: string | null = null;
  let heroDescription = "";
  if (heroCharacterId) {
    const { data: hero } = await supabase
      .from("cast_characters")
      .select("description, sheet_url")
      .eq("id", heroCharacterId)
      .single();
    heroSheetUrl = hero?.sheet_url ? await signAsset(supabase, hero.sheet_url) : null;
    heroDescription = hero?.description ?? "";
  }

  // For girl: fetch the existing boy cover as a scene lock reference, same
  // technique as generateSpreadScene (backgrounds/approve/actions.ts) -- keeps
  // the environment, lighting, and camera identical across genders, only the
  // hero swaps. No typography to lock anymore -- there isn't any baked in.
  let boyCoverBuffer: Buffer | undefined;
  if (gender === "girl") {
    const { data: story } = await supabase.from("stories").select("cover_image_url").eq("id", storyId).single();
    if (story?.cover_image_url) {
      try {
        const signedBoyUrl = await signAsset(supabase, story.cover_image_url);
        const res = await fetch(signedBoyUrl);
        if (res.ok) boyCoverBuffer = Buffer.from(await res.arrayBuffer());
      } catch { /* non-fatal */ }
    }
  }

  // imageConfig.aspectRatio set for real, not just requested in prose --
  // same fix that eliminated the story-spread seam bug (see coverPrompt.ts's
  // top-of-file comment for the full explanation). 16:9 is the closest
  // Gemini-supported ratio to the true ~1.88:1 print canvas.
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "16:9" } } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [];
  if (heroSheetUrl) {
    parts.push(await urlToInlineData(heroSheetUrl));
    parts.push(`Hero reference sheet (face, hair, body type, clothing): ${heroDescription || "the main child protagonist"}`);
  }
  if (boyCoverBuffer) {
    parts.push({ inlineData: { data: boyCoverBuffer.toString("base64"), mimeType: "image/jpeg" } });
    parts.push(
      "━━━ SCENE LOCK — CHARACTER SWAP ONLY ━━━\n" +
      "The image above is the MASTER REFERENCE (boy version) for this same wraparound cover. Reproduce it with exact fidelity:\n" +
      "• EVERYTHING is locked: back cover environment, front cover environment, lighting, camera framing, spine gap\n" +
      "• THE ONE CHANGE: replace the boy protagonist with the girl hero from her reference sheet above\n" +
      "• Place her in the identical position, pose, and scale on the front cover"
    );
  }
  parts.push(finalPrompt);

  const result = await model.generateContent(parts);
  const geminiBuffer = extractImageBuffer(result.response);

  const sharp = (await import("sharp")).default;
  const { width: gw = COVER_CANVAS_WIDTH, height: gh = COVER_CANVAS_HEIGHT } = await sharp(geminiBuffer).metadata();
  const midX = Math.floor(gw / 2);

  const backHalf = await sharp(geminiBuffer)
    .extract({ left: 0, top: 0, width: midX, height: gh })
    .resize(COVER_PANEL_WIDTH, COVER_CANVAS_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .toBuffer();

  const frontHalf = await sharp(geminiBuffer)
    .extract({ left: midX, top: 0, width: gw - midX, height: gh })
    .resize(COVER_PANEL_WIDTH, COVER_CANVAS_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .sharpen({ sigma: 0.6 })
    .toBuffer();

  const finalBuffer = await sharp({
    create: { width: COVER_CANVAS_WIDTH, height: COVER_CANVAS_HEIGHT, channels: 3, background: "#ffffff" },
  })
    .composite([
      { input: backHalf, left: 0, top: 0 },
      { input: frontHalf, left: COVER_PANEL_WIDTH, top: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();

  const storagePath = `story-covers/${storyId}/cover-${gender}-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("assets")
    .upload(storagePath, finalBuffer, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  await logGeminiCall(supabase, { callType: "template_cover_display", storyId });

  const updatePayload = gender === "girl"
    ? { cover_image_url_girl: storagePath }
    : { cover_image_url: storagePath };
  await supabase.from("stories").update(updatePayload).eq("id", storyId);

  revalidatePath(`/stories/${storyId}`);
  return signAsset(supabase, storagePath);
}

// ── generateCoverSwapTemplate ──────────────────────────────────────────────────
// A second, separate cover: the hero rendered as a blank silhouette, used
// only by the order-time identity swap. Never shown to customers -- the
// nice-looking display covers above (cover_image_url/cover_image_url_girl)
// are completely untouched and still what the storefront shows while
// browsing. One template now serves every order regardless of gender, same
// as generateSpreadScene for story pages -- buildCoverPrompt already takes
// no gender parameter, so there's nothing else to make gender-agnostic here.
//
// Built as a SCENE-LOCK EDIT of the existing boy display cover (same
// technique generateCoverSpread already uses for its own boy->girl swap),
// not an independent from-scratch generation. Generating it independently --
// even from the same finalPrompt text -- let the environment, landmark
// placement, and composition drift from what customers actually saw on the
// storefront, since two separate generateContent calls have no guarantee of
// agreeing on anything beyond what the prose says. Locking onto the real
// display cover pixels guarantees the order-time personalized cover renders
// into the exact same scene the customer browsed.
export async function generateCoverSwapTemplate(
  storyId: string,
  finalPrompt: string,
): Promise<string> {
  const supabase = createServerClient();

  if (!finalPrompt?.trim()) throw new Error("Cover prompt is required");

  const { data: story } = await supabase
    .from("stories")
    .select("cover_image_url, cover_hero_boy_character_id")
    .eq("id", storyId)
    .single();
  if (!story?.cover_image_url) throw new Error("Generate the boy display cover first");

  const signedDisplayCoverUrl = await signAsset(supabase, story.cover_image_url);
  const displayCoverRes = await fetch(signedDisplayCoverUrl);
  if (!displayCoverRes.ok) throw new Error("Failed to fetch the display cover to lock onto");
  const displayCoverBuffer = Buffer.from(await displayCoverRes.arrayBuffer());

  let heroSheetUrl: string | null = null;
  let heroDescription = "";
  if (story.cover_hero_boy_character_id) {
    const { data: hero } = await supabase
      .from("cast_characters")
      .select("description, sheet_url")
      .eq("id", story.cover_hero_boy_character_id)
      .single();
    heroSheetUrl = hero?.sheet_url ? await signAsset(supabase, hero.sheet_url) : null;
    heroDescription = hero?.description ?? "";
  }

  // imageConfig.aspectRatio set for real, not just requested in prose -- see
  // generateCoverSpread above and coverPrompt.ts's top-of-file comment.
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "16:9" } } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [];
  if (heroSheetUrl) {
    parts.push(await urlToInlineData(heroSheetUrl));
    parts.push(`This is the boy hero character (${heroDescription || "the main child protagonist"}) as he appears in the reference sheet, for identification only -- he is the character to remove below.`);
  }
  parts.push({ inlineData: { data: displayCoverBuffer.toString("base64"), mimeType: "image/jpeg" } });
  parts.push(
    "━━━ SCENE LOCK — SILHOUETTE SWAP ONLY ━━━\n" +
    "The image above is the MASTER REFERENCE for this exact wraparound cover -- the same book, reused as the base for order-time personalization. Reproduce it with exact fidelity:\n" +
    "• EVERYTHING is locked: back cover environment, front cover environment, lighting, camera framing, spine gap, every other character/animal/landmark and their exact positions and poses\n" +
    "• THE ONE CHANGE: remove the boy hero character shown on the front cover and replace him with a blank silhouette placeholder in the identical position, pose, and scale he currently occupies\n\n" +
    HERO_SILHOUETTE_INSTRUCTION
  );
  parts.push(finalPrompt);

  const result = await model.generateContent(parts);
  const geminiBuffer = extractImageBuffer(result.response);

  const sharp = (await import("sharp")).default;
  const { width: gw = COVER_CANVAS_WIDTH, height: gh = COVER_CANVAS_HEIGHT } = await sharp(geminiBuffer).metadata();
  const midX = Math.floor(gw / 2);

  const backHalf = await sharp(geminiBuffer)
    .extract({ left: 0, top: 0, width: midX, height: gh })
    .resize(COVER_PANEL_WIDTH, COVER_CANVAS_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .toBuffer();

  const frontHalf = await sharp(geminiBuffer)
    .extract({ left: midX, top: 0, width: gw - midX, height: gh })
    .resize(COVER_PANEL_WIDTH, COVER_CANVAS_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .sharpen({ sigma: 0.6 })
    .toBuffer();

  const finalBuffer = await sharp({
    create: { width: COVER_CANVAS_WIDTH, height: COVER_CANVAS_HEIGHT, channels: 3, background: "#ffffff" },
  })
    .composite([
      { input: backHalf, left: 0, top: 0 },
      { input: frontHalf, left: COVER_PANEL_WIDTH, top: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();

  const storagePath = `story-covers/${storyId}/swap-template-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("assets")
    .upload(storagePath, finalBuffer, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  await logGeminiCall(supabase, { callType: "template_cover_base", storyId });

  await supabase.from("stories").update({ cover_swap_template_url: storagePath }).eq("id", storyId);

  const signedBaseUrl = await signAsset(supabase, storagePath);

  // Age-band variants (1-4, 9-12) are no longer derived automatically here --
  // trigger them explicitly via generateAgeVariantsForCover once the base is
  // confirmed good (see the note on generateAgeVariantsForPage).

  revalidatePath(`/stories/${storyId}`);
  return signedBaseUrl;
}

// Manually triggers the 1-4/9-12 age-band derivation for a story's EXISTING
// cover swap template -- mirrors generateAgeVariantsForPage. No base
// regeneration, just the two resize-edit calls.
export async function generateAgeVariantsForCover(storyId: string): Promise<void> {
  const supabase = createServerClient();

  const { data: story, error } = await supabase
    .from("stories")
    .select("cover_swap_template_url")
    .eq("id", storyId)
    .single();

  if (error || !story) throw new Error("Story not found");
  if (!story.cover_swap_template_url) throw new Error("Generate the base swap template first");

  const baseSignedUrl = await signAsset(supabase, story.cover_swap_template_url);

  await storeAgeVariants({
    supabase,
    table: "story_cover_age_variants",
    keyColumn: "story_id",
    keyValue: storyId,
    baseSignedUrl,
    mimeType: "image/jpeg",
    uploadDerivative: async (buffer, band) => {
      await logGeminiCall(supabase, { callType: "template_age_band_resize", storyId });
      const path = `story-covers/${storyId}/swap-template-${band}-${Date.now()}.jpg`;
      const { error: derivError } = await supabase.storage
        .from("assets")
        .upload(path, buffer, { contentType: "image/jpeg", upsert: true });
      if (derivError) throw new Error(`Upload failed: ${derivError.message}`);
      return path;
    },
  });

  revalidatePath(`/stories/${storyId}`);
}

export async function setCoverImage(storyId: string, imageUrl: string, imageUrlGirl?: string | null) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ cover_image_url: imageUrl, cover_image_url_girl: imageUrlGirl ?? null })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

// `backLeadingText` is a per-story override of the global
// brand_settings.back_cover_leading_text default -- reuses the existing
// back_cover_tagline column (feeds the real back-cover overlay pill, see
// BackCoverOverlay.tsx / lib/layout.ts, not baked into the generated art).
export async function saveCoverLayout(storyId: string, layout: CoverLayout, backLeadingText: string | null) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ cover_layout: layout, back_cover_tagline: backLeadingText })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

// Which cast_characters (per-story hero pool) the cover art depicts, if any --
// see generateCoverSpread's heroCharacterId. Mirrors setPageHeroCharacters
// (page_cast/actions.ts) but on the story itself rather than one page.
export async function setCoverHeroCharacters(
  storyId: string,
  heroBoyCharacterId: string | null,
  heroGirlCharacterId: string | null,
) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ cover_hero_boy_character_id: heroBoyCharacterId, cover_hero_girl_character_id: heroGirlCharacterId })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function saveBookPages(
  storyId: string,
  fields: { dedication_text?: string | null; end_page_text?: string; back_cover_text?: string | null }
) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update(fields)
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function saveFrontSpreadTextStyle(storyId: string, style: TextStyle) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ front_spread_text_style: style })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function saveEndPagePrompt(storyId: string, prompt: string) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ end_page_prompt: prompt || null })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

// Generates the End Page image -- same prompt-only, single flat square
// illustration as generateBrandPageImage. Any closing text (e.g. "The End")
// is baked into the generated art via the prompt itself, not composited
// separately.
export async function generateEndPageImage(storyId: string, prompt: string): Promise<string> {
  const supabase = createServerClient();

  if (!prompt?.trim()) throw new Error("A prompt is required");

  const fullPrompt =
    `OUTPUT: a single flat, edge-to-edge square illustration filling the entire canvas -- no border, no surrounding background or table, no drop shadow, no mockup, no depiction of a book page or cover.\n\n` +
    `${prompt}\n\n` +
    `ABSOLUTE RULES:\n` +
    `  - The art fills the canvas edge to edge, nothing framing it\n` +
    `  - No mockup, no 3D book rendering, no rounded corners\n` +
    `  - No watermark or placeholder text of any kind`;

  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });
  const result = await model.generateContent([fullPrompt]);
  const buffer = extractImageBuffer(result.response);

  const sharp = (await import("sharp")).default;
  const { PAGE_SIZE_PX } = await import("@/lib/layout");
  const squareBuffer = await sharp(buffer)
    .resize(PAGE_SIZE_PX, PAGE_SIZE_PX, { fit: "cover" })
    .jpeg({ quality: 92 })
    .toBuffer();

  const storagePath = `story-end-page/${storyId}/end-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("assets")
    .upload(storagePath, squareBuffer, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { error } = await supabase
    .from("stories")
    .update({ end_page_prompt: prompt, end_page_image_url: storagePath })
    .eq("id", storyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/stories/${storyId}`);
  return signAsset(supabase, storagePath);
}

export async function saveFrontSpreadPageStyles(
  storyId: string,
  dedicationStyle: TextStyle,
  titlePageStyle: TextStyle
) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ dedication_text_style: dedicationStyle, title_page_text_style: titlePageStyle })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function saveBrandPagePrompt(storyId: string, prompt: string) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ brand_page_prompt: prompt || null })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

// Generates the image for the "brand" page (right-hand page of the first
// interior spread, facing the always-blank front endpaper) -- e.g. company
// branding / line art. A single flat square illustration, not tied to any
// character or scene, so this is a much simpler prompt-only generation than
// generateCoverSpread.
export async function generateBrandPageImage(storyId: string, prompt: string): Promise<string> {
  const supabase = createServerClient();

  if (!prompt?.trim()) throw new Error("A prompt is required");

  const fullPrompt =
    `OUTPUT: a single flat, edge-to-edge square illustration filling the entire canvas -- no border, no surrounding background or table, no drop shadow, no mockup, no depiction of a book page or cover.\n\n` +
    `${prompt}\n\n` +
    `ABSOLUTE RULES:\n` +
    `  - The art fills the canvas edge to edge, nothing framing it\n` +
    `  - No mockup, no 3D book rendering, no rounded corners\n` +
    `  - No watermark or placeholder text of any kind`;

  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });
  const result = await model.generateContent([fullPrompt]);
  const buffer = extractImageBuffer(result.response);

  const sharp = (await import("sharp")).default;
  const { PAGE_SIZE_PX } = await import("@/lib/layout");
  const squareBuffer = await sharp(buffer)
    .resize(PAGE_SIZE_PX, PAGE_SIZE_PX, { fit: "cover" })
    .jpeg({ quality: 92 })
    .toBuffer();

  const storagePath = `story-brand-page/${storyId}/brand-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("assets")
    .upload(storagePath, squareBuffer, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { error } = await supabase
    .from("stories")
    .update({ brand_page_prompt: prompt, brand_page_image_url: storagePath })
    .eq("id", storyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/stories/${storyId}`);
  return signAsset(supabase, storagePath);
}

export async function setStoryStatus(storyId: string, status: "draft" | "ready") {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ status })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
  revalidatePath("/stories");
}
