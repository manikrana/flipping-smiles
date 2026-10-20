"use server";

import Replicate from "replicate";
import { createServerClient } from "@/lib/supabase/server";
import { signAsset } from "@/lib/supabase/assets";
import { revalidatePath } from "next/cache";
import { getGemini, NANO_BANANA_2_MODEL, urlToInlineData, extractImageBuffer } from "@/lib/gemini";
import { getStyle, type GenerationStyle } from "@/lib/styles";
import { HERO_SILHOUETTE_INSTRUCTION } from "@/lib/heroSilhouette";
import { logGeminiCall } from "@/lib/geminiLog";

// Lazy so importing this module doesn't risk throwing at build/import time
// (Next collects route data at build time, evaluating this module even
// though no request is being served then).
let cachedReplicate: Replicate | null = null;
function getReplicate(): Replicate {
  if (!cachedReplicate) cachedReplicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  return cachedReplicate;
}

// Cache version lookups for the lifetime of the server process to avoid repeated API calls.
const versionCache = new Map<string, string>();
async function getLatestVersion(owner: string, name: string): Promise<string> {
  const key = `${owner}/${name}`;
  if (versionCache.has(key)) return versionCache.get(key)!;
  const model = await getReplicate().models.get(owner, name);
  if (!model.latest_version?.id) throw new Error(`No version found for ${key}`);
  versionCache.set(key, model.latest_version.id);
  return model.latest_version.id;
}

type LayoutType = "overlay_bottom" | "split_image_left" | "split_image_right";

interface StoryContext {
  layout_type: LayoutType;
  generation_style: GenerationStyle;
}

async function getStoryContext(storyId: string): Promise<StoryContext> {
  const supabase = createServerClient();
  const { data: story } = await supabase
    .from("stories")
    .select("layout_type, generation_style")
    .eq("id", storyId)
    .single();
  return {
    layout_type: (story?.layout_type ?? "split_image_left") as LayoutType,
    generation_style: (story?.generation_style ?? "pixar-3d") as GenerationStyle,
  };
}

interface PageCharacterInfo {
  description: string;
  lora_url: string | null;
  trigger_word: string | null;
  reference_urls: string[];
  sheet_url: string | null;
}

async function getPageCharacterInfo(pageId: string): Promise<PageCharacterInfo[]> {
  const supabase = createServerClient();

  type PageCastWithChar = {
    cast_characters: {
      description: string;
      lora_url: string | null;
      trigger_word: string | null;
      sheet_url: string | null;
      id: string;
    } | null;
  };
  const { data } = await supabase
    .from("page_cast")
    .select("cast_characters ( id, description, lora_url, trigger_word, sheet_url )")
    .eq("page_id", pageId);

  const rows = data as unknown as PageCastWithChar[] | null;
  const chars = (rows ?? []).map((r) => r.cast_characters).filter((c): c is NonNullable<typeof c> => !!c);

  // Fetch reference image URLs for each character (needed by nano-banana-pro)
  return Promise.all(
    chars.map(async (c) => {
      const { data: refs } = await supabase
        .from("cast_character_references")
        .select("image_url")
        .eq("character_id", c.id)
        .order("created_at", { ascending: false })
        .limit(6);
      const supabase2 = createServerClient();
      const sheetPath = c.sheet_url;
      const refPaths = (refs ?? []).map((r) => r.image_url).filter((p): p is string => !!p);
      const [signedSheet, ...signedRefs] = await Promise.all([
        sheetPath ? signAsset(supabase2, sheetPath) : Promise.resolve(null),
        ...refPaths.map((p) => signAsset(supabase2, p)),
      ]);
      return {
        description: c.description,
        lora_url: c.lora_url,
        trigger_word: c.trigger_word,
        sheet_url: signedSheet,
        reference_urls: signedRefs as string[],
      };
    })
  );
}

// ── Flux prompt builder ───────────────────────────────────────────────────────

function buildFluxPrompt(
  characterDescription: string,
  characters: PageCharacterInfo[],
  scenePrompt: string,
  styleId: GenerationStyle
): string {
  const style = getStyle(styleId);
  const triggerWords = characters
    .map((c) => c.trigger_word)
    .filter(Boolean)
    .join(", ");
  const descriptions = [
    characterDescription,
    ...characters.filter((c) => !c.trigger_word).map((c) => c.description),
  ].filter(Boolean).join(", ");

  return (
    `${triggerWords ? triggerWords + ", " : ""}${style.fluxPromptPrefix}, ` +
    `${descriptions ? descriptions + ", " : ""}${scenePrompt}, ` +
    `vibrant colors, cinematic lighting, highly detailed, 4k, ` +
    `bottom 30 percent of image is a soft uncluttered area with minimal detail and gentle lighting, ` +
    `no characters or busy elements in the lower third, clean space for text overlay`
  );
}

// ── Flux prediction (Replicate) ───────────────────────────────────────────────

async function startFluxPrediction(
  prompt: string,
  characters: PageCharacterInfo[]
): Promise<{ id: string }> {
  const loraCharacters = characters.filter((c) => c.lora_url);
  console.log(`[scene/flux] characters=${characters.length} withLora=${loraCharacters.length}`);

  if (loraCharacters.length > 0) {
    const version = await getLatestVersion("black-forest-labs", "flux-dev-lora");
    return getReplicate().predictions.create({
      version,
      input: {
        prompt,
        lora_weights: loraCharacters[0].lora_url,
        lora_scale: 1.0,
        ...(loraCharacters[1] ? {
          extra_lora: loraCharacters[1].lora_url,
          extra_lora_scale: 1.2,
        } : {}),
        aspect_ratio: "4:3",
        output_format: "webp",
        output_quality: 90,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        disable_safety_checker: true,
      },
    });
  }

  const version = await getLatestVersion("black-forest-labs", "flux-1.1-pro");
  return getReplicate().predictions.create({
    version,
    input: {
      prompt,
      aspect_ratio: "4:3",
      output_format: "webp",
      output_quality: 90,
      safety_tolerance: 3,
      prompt_upsampling: false,
    },
  });
}

// ── Nano Banana Pro scene generation (Gemini) ─────────────────────────────────

function buildSceneSystemPrompt(
  styleId: GenerationStyle,
  layoutType: LayoutType
): string {
  const style = getStyle(styleId);
  if (layoutType === "split_image_left" || layoutType === "split_image_right") {
    return (
      `You are an expert illustrator for children's storybooks.\n` +
      `Generate a single scene illustration in ${style.sceneStyleInstruction}.\n` +
      `The image must have a 1:1 square aspect ratio (equal width and height).\n` +
      `Fill the entire frame with scene content — characters, environment, and action. There is no text overlay on this image.\n` +
      `Compose the scene dynamically; characters may appear anywhere in the frame.\n` +
      `Follow the scene description precisely for composition, action, and setting.`
    );
  }
  return (
    `You are an expert illustrator for children's storybooks.\n` +
    `Generate a single scene illustration in ${style.sceneStyleInstruction}.\n` +
    `The image must have a 4:3 landscape aspect ratio.\n` +
    `The bottom 30% of the image should be a soft, uncluttered area with minimal detail and gentle lighting — clean space for text overlay.\n` +
    `Do not place characters or busy elements in the lower third.\n` +
    `Follow the scene description precisely for composition, action, and setting.`
  );
}

async function generateNanaBananaScene(
  characters: PageCharacterInfo[],
  scenePrompt: string,
  styleImageUrl: string | undefined,
  layoutType: LayoutType,
  generationStyle: GenerationStyle,
  /** A scene from a previous page — used to anchor environment continuity (materials, architecture, lighting) */
  continuityBuffer?: Buffer
): Promise<Buffer> {
  const systemPrompt = buildSceneSystemPrompt(generationStyle, layoutType);

  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      // @ts-expect-error responseModalities not yet in types
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  const parts: Parameters<typeof model.generateContent>[0] = [];

  // No hero reference sheet -- the hero renders as a blank silhouette
  // (HERO_SILHOUETTE_INSTRUCTION below), not a specific-looking child. One
  // scene now serves every order regardless of gender.

  // Character sheet references — up to 6 characters max
  const sheetCharacters = characters.filter((c) => c.sheet_url);
  const nonSheetCharacters = characters.filter((c) => !c.sheet_url && c.reference_urls.length > 0);

  for (const char of sheetCharacters.slice(0, 6)) {
    parts.push(await urlToInlineData(char.sheet_url!));
    parts.push(`Character reference sheet above: ${char.description}`);
  }

  // For non-sheet characters, pass up to 2 reference images each (keeps payload manageable)
  for (const char of nonSheetCharacters.slice(0, 6)) {
    for (const url of char.reference_urls.slice(0, 2)) {
      parts.push(await urlToInlineData(url));
    }
    parts.push(`Character reference images above: ${char.description}`);
  }

  // Style lock: pass first generated scene if available
  if (styleImageUrl) {
    parts.push(await urlToInlineData(styleImageUrl));
    parts.push("Use the art style, lighting, color palette, and rendering quality from the scene image above. Match it exactly in the new scene.");
  }

  // Continuity reference: anchor shared world elements from a previous scene
  if (continuityBuffer) {
    parts.push({ inlineData: { data: continuityBuffer.toString("base64"), mimeType: "image/webp" } });
    parts.push(
      "━━━ ENVIRONMENT CONTINUITY REFERENCE ━━━\n" +
      "The image above is from an earlier scene in the same story. Use it to maintain visual consistency for shared world elements:\n" +
      "• MATERIALS & SURFACES: stone type, wood grain, fabric texture, metal finish — match exactly\n" +
      "• ARCHITECTURE: building style, structural elements, doorways, columns, bridges — same design language\n" +
      "• LANDSCAPE: terrain type, vegetation style, sky mood, water colour — consistent\n" +
      "• LIGHTING MOOD: time of day, colour temperature, shadow quality — keep consistent unless the scene description specifies otherwise\n" +
      "• COLOUR PALETTE: overall tone and saturation — stay in the same world\n\n" +
      "This is NOT a composition lock — characters, camera angle, and action are defined by the scene description below.\n" +
      "Only the ENVIRONMENT and WORLD MATERIALS must feel like the same place and story."
    );
  }

  // Build the text prompt — include all (non-hero) characters so the model
  // knows every character that should appear in the scene, plus the
  // blank-silhouette hero instruction.
  const allDescriptions = characters.map((c) => c.description).filter(Boolean).join(", ");

  const bottomClearInstruction = (layoutType === "split_image_left" || layoutType === "split_image_right")
    ? ""
    : "Leave the bottom 30% of the image as a clean, uncluttered area.";

  parts.push(
    `Scene: ${scenePrompt.replace(/{{hero_name}}/g, "THE HERO")}\n` +
    (allDescriptions ? `Characters present (other than the hero): ${allDescriptions}\n` : "") +
    `Generate a single children's storybook illustration for this scene. ` +
    `Render the non-hero characters exactly as shown in their reference images above. ` +
    `Keep the art style consistent, vibrant, and in Pixar 3D animated movie style.` +
    (bottomClearInstruction ? ` ${bottomClearInstruction}` : "") +
    `\n\n${HERO_SILHOUETTE_INSTRUCTION}`
  );

  console.log(`[scene/nb] generating — sheetChars=${Math.min(sheetCharacters.length, 6)} nonSheetChars=${Math.min(nonSheetCharacters.length, 6)} hasStyleLock=${!!styleImageUrl}`);

  const result = await model.generateContent(parts);
  return extractImageBuffer(result.response);
}

// ── Shared helper: generate + upload one scene buffer ─────────────────────────

async function uploadSceneBuffer(
  supabase: ReturnType<typeof createServerClient>,
  pageId: string,
  buffer: Buffer,
  suffix: string
): Promise<string> {
  const storagePath = `scene-images/${pageId}/${suffix}-${Date.now()}.webp`;
  const { error } = await supabase.storage
    .from("assets")
    .upload(storagePath, buffer, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

/** Fetch the boy scene image from a continuity reference page. */
async function fetchContinuityBuffer(refPageId: string): Promise<Buffer | undefined> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("story_pages")
    .select("image_url")
    .eq("id", refPageId)
    .single();
  if (!data?.image_url) return undefined;
  try {
    const signedUrl = await signAsset(supabase, data.image_url);
    const res = await fetch(signedUrl);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : undefined;
  } catch { return undefined; }
}

async function generateOneScene(
  ctx: StoryContext,
  characters: PageCharacterInfo[],
  scenePrompt: string,
  continuityRefPageId?: string | null,
): Promise<Buffer> {
  const continuityBuffer = continuityRefPageId
    ? await fetchContinuityBuffer(continuityRefPageId)
    : undefined;
  return generateNanaBananaScene(characters, scenePrompt, undefined, ctx.layout_type, ctx.generation_style, continuityBuffer);
}

// ── Public server actions ─────────────────────────────────────────────────────

export type SceneResult = {
  pageId: string;
  predictionId?: string;   // Flux only
  // NB Pro: single blank-silhouette scene, shared by every order regardless
  // of gender. boyImageUrl/girlImageUrl both point at the same image --
  // BackgroundGenerator.tsx's UI still reads two fields (pre-existing,
  // unrelated to this change), so both are populated rather than reworking
  // that grid.
  boyImageUrl?: string;
  girlImageUrl?: string;
};

/**
 * For Flux: returns predictionId — caller must poll (legacy).
 * For Nano Banana Pro: generates the single blank-silhouette-hero scene.
 */
export async function generateSinglePage(storyId: string, pageId: string): Promise<SceneResult> {
  console.log(`[scene] generateSinglePage storyId=${storyId} pageId=${pageId}`);
  const supabase = createServerClient();

  const { data: page, error } = await supabase
    .from("story_pages")
    .select("id, scene_prompt, continuity_reference_page_id")
    .eq("id", pageId)
    .eq("story_id", storyId)
    .single();

  if (error || !page) throw new Error("Page not found");

  const [ctx, characters] = await Promise.all([
    getStoryContext(storyId),
    getPageCharacterInfo(pageId),
  ]);

  const buffer = await generateOneScene(ctx, characters, page.scene_prompt, page.continuity_reference_page_id);
  const imagePath = await uploadSceneBuffer(supabase, pageId, buffer, "scene");
  await logGeminiCall(supabase, { callType: "template_page_base", storyId, pageId });

  // Null out image_url_girl -- existing "girl" previews fall back to
  // image_url_girl ?? image_url, so stale pre-migration content there would
  // silently outlive this regeneration.
  await supabase.from("story_pages").update({ image_url: imagePath, image_url_girl: null }).eq("id", pageId);

  const imageUrl = await signAsset(supabase, imagePath);
  return { pageId: page.id, boyImageUrl: imageUrl, girlImageUrl: imageUrl };
}

export async function startBackgroundGeneration(
  storyId: string,
  pageIds?: string[]
): Promise<SceneResult[]> {
  console.log(`[scene] startBackgroundGeneration storyId=${storyId} pageIds=${pageIds?.join(",") ?? "all"}`);
  const supabase = createServerClient();

  let query = supabase
    .from("story_pages")
    .select("id, scene_prompt, continuity_reference_page_id")
    .eq("story_id", storyId)
    .order("page_number");

  if (pageIds?.length) query = query.in("id", pageIds);

  const { data: pages, error } = await query;
  if (error || !pages?.length) throw new Error("No pages found for this story");

  const ctx = await getStoryContext(storyId);

  const results = await Promise.all(
    pages.map(async (page) => {
      const characters = await getPageCharacterInfo(page.id);
      const buffer = await generateOneScene(ctx, characters, page.scene_prompt, page.continuity_reference_page_id);
      const imagePath = await uploadSceneBuffer(supabase, page.id, buffer, "scene");
      await logGeminiCall(supabase, { callType: "template_page_base", storyId, pageId: page.id });

      await supabase.from("story_pages").update({ image_url: imagePath, image_url_girl: null }).eq("id", page.id);

      const imageUrl = await signAsset(supabase, imagePath);
      return { pageId: page.id, boyImageUrl: imageUrl, girlImageUrl: imageUrl };
    })
  );

  revalidatePath("/stories");
  return results;
}

export async function pollBackgroundGeneration(
  predictions: { pageId: string; predictionId: string }[]
): Promise<{ pageId: string; status: string; boyImageUrl?: string; error?: string }[]> {
  const supabase = createServerClient();

  const results = await Promise.all(
    predictions.map(async ({ pageId, predictionId }) => {
      try {
        const prediction = await getReplicate().predictions.get(predictionId);

        if (prediction.status === "succeeded") {
          const output = prediction.output;
          const replicateUrl = Array.isArray(output) ? String(output[0]) : String(output);

          const res = await fetch(replicateUrl);
          if (!res.ok) throw new Error(`Failed to download scene image (${res.status})`);
          const imageData = Buffer.from(await res.arrayBuffer());
          const storagePath = `scene-images/${pageId}/${predictionId}.webp`;
          const { error: uploadError } = await supabase.storage
            .from("assets")
            .upload(storagePath, imageData, { contentType: "image/webp", upsert: true });
          if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
          await supabase.from("story_pages").update({ image_url: storagePath }).eq("id", pageId);
          const boyImageUrl = await signAsset(supabase, storagePath);
          return { pageId, status: "done", boyImageUrl };
        }

        if (prediction.status === "failed" || prediction.status === "canceled") {
          const errorMsg = (prediction.error as string | null) ?? prediction.status;
          return { pageId, status: "failed", error: errorMsg };
        }

        return { pageId, status: "processing" };
      } catch (e) {
        return { pageId, status: "failed", error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  revalidatePath("/stories");
  return results;
}

// Renders the hero as a blank silhouette -- one scene now serves every
// order regardless of gender, so there's no gender parameter anymore.
export async function generateSinglePageScene(
  storyId: string,
  pageId: string,
): Promise<SceneResult> {
  console.log(`[scene] generateSinglePageScene storyId=${storyId} pageId=${pageId}`);
  const supabase = createServerClient();

  const { data: page, error } = await supabase
    .from("story_pages")
    .select("id, scene_prompt, continuity_reference_page_id")
    .eq("id", pageId)
    .eq("story_id", storyId)
    .single();

  if (error || !page) throw new Error("Page not found");

  const [ctx, characters] = await Promise.all([
    getStoryContext(storyId),
    getPageCharacterInfo(pageId),
  ]);

  const buffer = await generateOneScene(ctx, characters, page.scene_prompt, page.continuity_reference_page_id);
  const imagePath = await uploadSceneBuffer(supabase, pageId, buffer, "scene");
  await logGeminiCall(supabase, { callType: "template_page_base", storyId, pageId });

  // Null out image_url_girl -- existing "girl" previews fall back to
  // image_url_girl ?? image_url, so stale pre-migration content there would
  // silently outlive this regeneration.
  await supabase.from("story_pages").update({ image_url: imagePath, image_url_girl: null }).eq("id", pageId);

  const imageUrl = await signAsset(supabase, imagePath);
  return { pageId: page.id, boyImageUrl: imageUrl, girlImageUrl: imageUrl };
}

export async function clearPageImages(storyId: string, pageId: string) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("story_pages")
    .update({ image_url: null, image_url_girl: null, image_approved: false })
    .eq("id", pageId)
    .eq("story_id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function savePageCharacterDescription(pageId: string, description: string) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("story_pages")
    .update({ default_character_description: description.trim() || null })
    .eq("id", pageId);
  if (error) throw new Error(error.message);
}

