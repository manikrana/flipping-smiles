"use server";

import { createServerClient } from "@/lib/supabase/server";
import { signAsset } from "@/lib/supabase/assets";
import { revalidatePath } from "next/cache";
import { getGemini, NANO_BANANA_2_MODEL, extractImageBuffer, urlToInlineData } from "@/lib/gemini";
import { STYLE_TOKEN, STYLE_TOKEN_SHARP, FORBIDDEN_STYLES, DISSOLVE_FUNCTION } from "@/lib/scenePromptParts";
import { HERO_SILHOUETTE_INSTRUCTION, storeAgeVariants, judgeCharacterCount } from "@/lib/heroSilhouette";
import { logGeminiCall } from "@/lib/geminiLog";

// Signed URLs for all 3 age-band variants of a page's template, for the
// admin band-switcher preview in StoryPagePanel.tsx. "5-8" is always resolved
// from the page's current base image (never from a stored row -- see the
// comment on storeAgeVariants for why a stored "5-8" row goes stale). "1-4"
// and "9-12" return null when not yet generated.
export async function getPageAgeVariantUrls(pageId: string): Promise<Record<"1-4" | "5-8" | "9-12", string | null>> {
  const supabase = createServerClient();
  const [{ data: page }, { data: variants }] = await Promise.all([
    supabase.from("story_pages").select("image_url").eq("id", pageId).single(),
    supabase.from("story_page_age_variants").select("age_band, image_url").eq("page_id", pageId).in("age_band", ["1-4", "9-12"]),
  ]);

  const result: Record<"1-4" | "5-8" | "9-12", string | null> = {
    "1-4": null,
    "5-8": page?.image_url ? await signAsset(supabase, page.image_url) : null,
    "9-12": null,
  };
  await Promise.all(
    (variants ?? []).map(async (row) => {
      if (row.image_url) result[row.age_band as "1-4" | "9-12"] = await signAsset(supabase, row.image_url);
    })
  );
  return result;
}

// Total logged Gemini calls attributed to this page (template regens across
// all bands + every order-time fill-in/judge attempt that used it), for the
// small call-count badge in StoryPagePanel.tsx.
export async function getPageGeminiCallCount(pageId: string): Promise<number> {
  const supabase = createServerClient();
  const { count } = await supabase
    .from("gemini_call_log")
    .select("id", { count: "exact", head: true })
    .eq("page_id", pageId);
  return count ?? 0;
}

// Manually triggers the 1-4/9-12 age-band derivation for a page's EXISTING
// base image -- no base regeneration, just the two resize-edit calls. Was
// automatic on every base regen; split out into its own explicit action so
// testing the core pipeline doesn't triple the Gemini cost of every "Regen
// spread" click. Works for any layout (spread, square/split) since it
// operates directly on story_pages.image_url rather than knowing which
// generator produced it.
export async function generateAgeVariantsForPage(storyId: string, pageId: string): Promise<void> {
  const supabase = createServerClient();

  const { data: page, error } = await supabase
    .from("story_pages")
    .select("image_url")
    .eq("id", pageId)
    .eq("story_id", storyId)
    .single();

  if (error || !page) throw new Error("Page not found");
  if (!page.image_url) throw new Error("Generate the base scene first");

  const mimeType = page.image_url.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
  const ext = mimeType === "image/webp" ? "webp" : "jpg";
  const baseDir = page.image_url.substring(0, page.image_url.lastIndexOf("/"));
  const baseSignedUrl = await signAsset(supabase, page.image_url);

  await storeAgeVariants({
    supabase,
    table: "story_page_age_variants",
    keyColumn: "page_id",
    keyValue: pageId,
    baseSignedUrl,
    mimeType,
    uploadDerivative: async (buffer, band) => {
      await logGeminiCall(supabase, { callType: "template_age_band_resize", storyId, pageId });
      const path = `${baseDir}/variant-${band}-${Date.now()}.${ext}`;
      const { error: derivError } = await supabase.storage
        .from("assets")
        .upload(path, buffer, { contentType: mimeType, upsert: true });
      if (derivError) throw new Error(`Upload failed: ${derivError.message}`);
      return path;
    },
  });

  revalidatePath(`/stories/${storyId}`);
}

export async function setPageVerticalAlign(storyId: string, pageId: string, verticalAlign: "top" | "center" | "bottom") {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("story_pages")
    .update({ vertical_align: verticalAlign } as never)
    .eq("id", pageId)
    .eq("story_id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function setPageApproval(storyId: string, pageId: string, approved: boolean) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("story_pages")
    .update({ image_approved: approved })
    .eq("id", pageId)
    .eq("story_id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function setPreviewEligible(storyId: string, pageId: string, eligible: boolean) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("story_pages")
    .update({ preview_eligible: eligible })
    .eq("id", pageId)
    .eq("story_id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function generateSceneBleed(
  storyId: string,
  pageId: string,
  bleedFrom: "left" | "right" = "right",
): Promise<string> {
  const supabase = createServerClient();

  const { data: page } = await supabase
    .from("story_pages")
    .select("id, image_url")
    .eq("id", pageId)
    .eq("story_id", storyId)
    .single();

  if (!page?.image_url) throw new Error("Page has no scene image");

  const sharp = (await import("sharp")).default;
  const res = await fetch(page.image_url);
  const originalBuffer = Buffer.from(await res.arrayBuffer());
  const { width = 1024, height = 1024 } = await sharp(originalBuffer).metadata();

  // gutterEdge = side of the text panel that touches the scene page (dense/continued)
  // outerEdge  = far side of the text panel (fully dissolved, text lives here)
  const gutterEdge = bleedFrom === "right" ? "RIGHT" : "LEFT";
  const outerEdge  = bleedFrom === "right" ? "LEFT"  : "RIGHT";

  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: originalBuffer.toString("base64"),
      },
    },
    `You are performing a precise image transformation for a children's storybook spread.\n\n` +

    `INPUT: the provided image is the facing scene page illustration.\n` +
    `OUTPUT: generate a text-page background that continues the same visual world and gradually dissolves.\n\n` +

    `SPATIAL TRANSFORMATION — follow this strictly:\n\n` +

    `${gutterEdge} EDGE (book gutter — connects directly to the scene page):\n` +
    `  Exact continuation of the environmental structure, lighting, and spatial composition.\n` +
    `  Same geometry, perspective, and material rendering. No style changes here.\n\n` +

    `MIDDLE SECTION:\n` +
    `  Environmental structure begins dissolving into volumetric fog, glowing dust particles,\n` +
    `  soft light diffusion, atmospheric mist, and cinematic energy dispersion.\n` +
    `  This must feel like the physics of light scattering — NOT brushwork or painting.\n\n` +

    `${outerEdge} EDGE (outer page edge — story text will be placed here):\n` +
    `  Fully abstract magical atmosphere. No recognizable objects or structures.\n` +
    `  Only light, fog, and particles consistent with the original scene lighting.\n` +
    `  Very low contrast, near-white — must not compete with black story text.\n\n` +

    `STYLE LOCK (non-negotiable throughout the entire output):\n` +
    `  Pixar-style cinematic 3D rendering, physically based lighting, soft global illumination, depth of field.\n` +
    `  ABSOLUTELY FORBIDDEN: watercolor, ink wash, paint splashes, sketch, 2D illustration, flat gradients, any style shift.\n\n` +

    `CONTENT RULES:\n` +
    `  - Remove ALL characters, faces, animals — completely, with no trace\n` +
    `  - Do NOT introduce new objects, scenery, or environments\n` +
    `  - Do NOT reinterpret the scene — transform it, do not reinvent it\n` +
    `  - Do NOT change camera angle or lighting direction\n` +
    `  - Use ONLY colors and lighting already present in the input image\n` +
    `  - NO text, letters, numbers, symbols, or writing anywhere in the output`,
  ]);

  const imageBuffer = await sharp(extractImageBuffer(result.response))
    .resize(width, height, { fit: "fill" })
    .jpeg({ quality: 90 })
    .toBuffer();

  const storagePath = `story-pages/${pageId}/text-bg-${Date.now()}.webp`;
  const { error } = await supabase.storage
    .from("assets")
    .upload(storagePath, imageBuffer, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  await supabase.from("story_pages").update({ text_bg_url: storagePath }).eq("id", pageId);

  revalidatePath(`/stories/${storyId}`);
  return signAsset(supabase, storagePath);
}

// ── generateSpreadScene ───────────────────────────────────────────────────────
// Generates a single 2:1 spread image (scene + atmospheric bleed in one pass).
// sceneDir: which half holds the illustrated scene ("left" | "right").
//
// The hero is rendered as a blank white silhouette, not a specific-looking
// child -- validated this session across scenes of increasing complexity with
// zero wrong-character or hallucinated-extra-child failures, since nothing
// else in a real scene is a flat white shape for the order-time identity
// swap to confuse. This also means one template now serves every order
// regardless of gender -- no more image_url/image_url_girl split, no hero
// reference sheet needed here at all. Gender only re-enters at swap time
// (for the hero's clothing, which this blank shape carries none of).

export async function generateSpreadScene(
  storyId: string,
  pageId: string,
  sceneDir: "left" | "right",
  withBleed = true,
): Promise<{ url: string; characterCountVerified: boolean | null }> {
  const supabase = createServerClient();

  const { data: page } = await supabase
    .from("story_pages")
    .select("id, scene_prompt")
    .eq("id", pageId)
    .eq("story_id", storyId)
    .single();

  if (!page) throw new Error("Page not found");

  const scenePrompt = page.scene_prompt?.replace(/{{hero_name}}/g, "THE HERO");
  if (!scenePrompt?.trim()) throw new Error("Page has no scene prompt");

  // ── Fetch page cast character sheets ───────────────────────────────────────
  type PageCastRow = { cast_characters: { id: string; description: string; sheet_url: string | null } | null };
  const { data: pageCastRows } = await supabase
    .from("page_cast")
    .select("cast_characters ( id, description, sheet_url )")
    .eq("page_id", pageId);

  const rawCastChars = ((pageCastRows ?? []) as unknown as PageCastRow[])
    .map((r) => r.cast_characters)
    .filter((c): c is NonNullable<typeof c> => !!c);
  const castChars = await Promise.all(rawCastChars.map(async (c) => ({
    ...c,
    sheet_url: c.sheet_url ? await signAsset(supabase, c.sheet_url) : null,
  })));

  const SCENE_HALF = sceneDir === "left" ? "LEFT" : "RIGHT";
  const TEXT_HALF  = sceneDir === "left" ? "RIGHT" : "LEFT";

  // STYLE_TOKEN includes "subtle depth of field", which directly contradicts
  // the !withBleed branch's own "no soft depth of field, sharp edge to edge"
  // rule below -- a real self-contradiction a colleague's review caught by
  // reading the fully-resolved prompt. STYLE_TOKEN_SHARP (scenePromptParts.ts)
  // is the shared fix; the withBleed branch below still uses plain STYLE_TOKEN
  // on purpose (that layout's dissolve treatment wants the softness).

  // Extract key nouns (landmarks, objects, places) from the scene prompt so
  // Gemini knows to keep them anchored in the scene zone.
  const SCENE_NOUNS = (() => {
    // Strip common filler words and pull out capitalised / quoted subjects
    const stopWords = new Set([
      "the","a","an","and","or","of","in","on","at","to","by","as","is","are","was","were",
      "be","been","being","with","from","for","into","through","across","among","beside",
      "beside","between","toward","around","about","over","under","upon","along","within",
      "her","his","their","its","she","he","they","we","you","it","this","that","these",
      "those","each","every","all","some","any","no","not","but","so","yet","also","while",
      "where","when","who","which","what","how","there","here","just","can","do","did",
      "has","have","had","will","would","could","should","may","might","must","shall",
      "mom","dad","papa","mama","something","wonderful","warmth","wonder","sun","fills",
      "rise","rises","rises","glance","glances","smiles","smile","peers","discovers",
      "discovering","exploring","explore","visit","visits","walks","walks","looks","look",
    ]);
    const words = scenePrompt.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g) ?? [];
    const unique = [...new Set(words.map((w) => w.trim()).filter((w) => {
      const lower = w.toLowerCase();
      return !stopWords.has(lower) && w.length > 2;
    }))];
    return unique.slice(0, 8); // cap at 8 to avoid bloating prompt
  })();

  const sceneNounLine = SCENE_NOUNS.length > 0
    ? `Key scene subjects that must stay in the ${SCENE_HALF} zone: ${SCENE_NOUNS.join(", ")}.\n`
    : "";

  const prompt = withBleed
    ? `OUTPUT: one single continuous wide image in 16:9 widescreen (landscape). NOT two separate images side by side — one seamless photograph.\n\n` +

      `━━━ SCENE ━━━\n` +
      `${scenePrompt}\n\n` +
      `Render this as a single wide-angle shot. The camera is at ground level, looking across the scene at eye height.\n` +
      `Same camera, same lighting, same ground plane across the entire width — as if photographed with one wide lens.\n\n` +

      `━━━ SCENE ZONE LAYOUT ━━━\n` +
      (sceneDir === "left"
        ? `The LEFT zone (X 0%–60%) is the scene zone — all characters, landmarks, and focal subjects must be here.\n` +
          `The RIGHT zone (X 60%–100%) must be empty background only: sky, foliage, atmospheric depth — no characters, no landmarks.\n` +
          `Characters may naturally bleed up to X 65% but faces and main bodies must stay left of 60%.\n`
        : `The RIGHT zone (X 40%–100%) is the scene zone — all characters, landmarks, and focal subjects must be here.\n` +
          `The LEFT zone (X 0%–40%) must be empty background only: sky, foliage, atmospheric depth — no characters, no landmarks.\n` +
          `Characters may naturally bleed down to X 35% but faces and main bodies must stay right of 40%.\n`) +
      sceneNounLine +
      `The ${TEXT_HALF} half is the background of the same scene — same ground, same sky, same environment — just without any focal subjects.\n\n` +

      `━━━ CHARACTERS ━━━\n` +
      `${HERO_SILHOUETTE_INSTRUCTION}\n\n` +

      `━━━ STYLE ━━━\n` +
      `Style: ${STYLE_TOKEN}\n` +
      `Forbidden: ${FORBIDDEN_STYLES}\n\n` +

      `━━━ TEXT HALF TREATMENT ━━━\n` +
      `Apply the following dissolve to the ${TEXT_HALF} half:\n\n` +
      `${DISSOLVE_FUNCTION}\n\n` +

      `ABSOLUTE RULES:\n` +
      `  - No text, letters, numbers, symbols anywhere in the image\n` +
      `  - One continuous scene — identical ground plane, sky, lighting, and camera angle across the full width\n` +
      `  - Do not introduce new objects or environments not implied by the scene`

    : `Create one continuous panoramic children's storybook illustration, rendered from a single wide-angle virtual camera in 16:9 widescreen landscape — not two separate images, panels, tiles, or compositions.\n\n` +

      `━━━ SCENE ━━━\n` +
      `${scenePrompt}\n\n` +

      `━━━ COMPOSITION ━━━\n` +
      `Place the family and focal subjects together in the ${SCENE_HALF} portion of the panorama, leaving generous open environmental space on the ${TEXT_HALF} side — give the subjects real room, not a cramped half-width space. The ${TEXT_HALF} side is part of the exact same physical landscape, simply with fewer objects in it; it is not a different place.\n\n` +
      `Identify the single most prominent continuous physical feature already implied by the scene above — a path, trail, shoreline, riverbank, canal, or ridge line — and render it running unbroken across the full width of the frame, physically connecting the two sides as one continuous piece of ground. If nothing like that is implied by the scene, use the horizon and mountain/tree line itself as that unbroken connecting thread instead. Maintain one continuous terrain, sky, horizon, and lighting across the full width.\n\n` +
      `Render the ${TEXT_HALF} side exactly as sharp, crisp, and identically color-graded (same exposure, white balance, color temperature, contrast, saturation) as the ${SCENE_HALF} side. Nothing about either side should look like a separately generated patch stitched to the other.\n\n` +

      `━━━ CHARACTERS ━━━\n` +
      `${HERO_SILHOUETTE_INSTRUCTION}\n\n` +

      `━━━ STYLE ━━━\n` +
      `Style: ${STYLE_TOKEN_SHARP}\n` +
      `Forbidden: ${FORBIDDEN_STYLES}\n\n` +

      `ABSOLUTE RULES:\n` +
      `  - No text, letters, numbers, symbols anywhere in the image\n` +
      `  - One continuous terrain, sky, and horizon line across the full width — the connecting feature identified above must remain unbroken exactly where it crosses the center of the frame\n` +
      `  - The entire image is in sharp focus, edge to edge — no blur, no soft depth of field, no dissolve, no gradient, no vignette, anywhere. An uncluttered side is uncluttered because there is simply nothing else in it, not because it is out of focus.\n` +
      `  - Identical color grading edge to edge — same exposure, same white balance/color temperature, same contrast, same saturation everywhere in the frame. If you overlaid a strip from the far left and a strip from the far right, a colorist should not be able to tell them apart in tone.\n` +
      `  - Do not introduce new objects or environments not implied by the scene`;

  // The real root cause of the recurring seam, confirmed by testing: "2:1" is
  // not a supported Gemini image aspect ratio (the model only supports 1:1,
  // 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9), and this call never set
  // the actual imageConfig.aspectRatio field -- only asked for "2:1" in prose.
  // With no valid target to hit, the model was evidently satisfying "twice as
  // wide as tall" by generating two joined tiles instead of one camera shot,
  // which is exactly why the seam always landed at a pixel-precise 50%
  // regardless of scene content or prompt wording. Requesting a real
  // supported ratio (16:9, the closest to our 2:1 print canvas) eliminated
  // the seam completely in testing against this exact page's prompt and
  // reference images. The final compositing below already reads the actual
  // returned width/height dynamically, so the mild 16:9 -> 2:1 stretch to fit
  // the print canvas is harmless -- no seam-prone split logic depends on the
  // source already being 2:1.
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "16:9" } } as never,
  });

  // Build parts: cast sheets (mom/dad/sibling etc.) → text prompt. No hero
  // reference sheet -- the hero renders as a blank silhouette, described
  // entirely in the text prompt above.
  const parts: Parameters<typeof model.generateContent>[0] = [];

  for (const char of castChars.filter((c) => c.sheet_url).slice(0, 6)) {
    parts.push(await urlToInlineData(char.sheet_url!));
    // cast_characters.description ends with the story's generic render
    // boilerplate ("3D Pixar animation style... Unreal Engine 5 render"),
    // baked in from whatever originally generated the character sheet --
    // redundant once per character when it's already stated once in the
    // ━━━ STYLE ━━━ section below, so it's stripped here rather than passed
    // through verbatim.
    const identityOnly = char.description.replace(/\.?\s*3D Pixar animation style.*$/is, "").trim();
    parts.push(`REFERENCE CHARACTER: use this image only to preserve this character's exact identity, appearance, and clothing — ${identityOnly}`);
  }

  parts.push(prompt);

  const result = await model.generateContent(parts);
  const geminiBuffer = extractImageBuffer(result.response);

  const sharp = (await import("sharp")).default;

  // The prompt asks Gemini for an asymmetric zone split (the scene zone is
  // 60% of the width, and characters are explicitly allowed to bleed a bit
  // past the halfway point -- "may bleed down to X 35%"/"up to X 65%").
  // Splitting the raw output at a hardcoded 50% midpoint and independently
  // resizing/sharpening each half then tears anything that legitimately
  // bled across that point in two, each half scaled slightly differently --
  // this is exactly what produced the hard vertical seam through the
  // mother's body on the Taj Mahal page. withBleed layouts still need a
  // real split (the far half gets a deliberate blur/dissolve treatment that
  // can't be expressed as a single pass), but !withBleed ("_clean") layouts
  // now require identical treatment across the whole width anyway (see the
  // color-grading rules above) -- so there's no reason to split them at
  // all. One unified resize+sharpen of the whole image removes the seam
  // entirely, since there's no boundary left to misalign across.
  let finalBuffer: Buffer;

  if (withBleed) {
    const { width: gw = 1024, height: gh = 512 } = await sharp(geminiBuffer).metadata();
    const midX = Math.floor(gw / 2);

    const sceneExtract = { left: sceneDir === "left" ? 0 : midX, top: 0, width: midX, height: gh };
    const bleedExtract = { left: sceneDir === "left" ? midX : 0, top: 0, width: midX, height: gh };

    const sceneHalf = await sharp(geminiBuffer)
      .extract(sceneExtract)
      .resize(2550, 2550, { fit: "fill", kernel: "lanczos3" })
      .sharpen({ sigma: 0.6 })
      .toBuffer();

    const bleedHalf = await sharp(geminiBuffer)
      .extract(bleedExtract)
      .resize(2550, 2550, { fit: "fill", kernel: "lanczos3" })
      .blur(0.4)
      .toBuffer();

    finalBuffer = await sharp({
      create: { width: 5100, height: 2550, channels: 3, background: "#ffffff" },
    })
      .composite([
        { input: sceneDir === "left" ? sceneHalf : bleedHalf, left: 0,    top: 0 },
        { input: sceneDir === "left" ? bleedHalf : sceneHalf, left: 2550, top: 0 },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  } else {
    finalBuffer = await sharp(geminiBuffer)
      .resize(5100, 2550, { fit: "fill", kernel: "lanczos3" })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  const storagePath = `story-pages/${pageId}/spread-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from("assets")
    .upload(storagePath, finalBuffer, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  await logGeminiCall(supabase, { callType: "template_page_base", storyId, pageId });

  // Verify the render has exactly the expected headcount (every cast
  // character on this page + THE HERO) -- confirmed this session that Gemini
  // sometimes hallucinates an extra person despite the EXACT CAST rule, as
  // pure generation variance (same prompt + references, different outcome
  // across calls). Flag-only, no auto-retry -- an admin decides whether to
  // regenerate, same as identity_verified does for the order-time swap.
  const expectedCharacterCount = castChars.length + 1;
  let characterCountVerified: boolean | null = null;
  try {
    const { isMatch, actualCount, reason } = await judgeCharacterCount(finalBuffer, "image/jpeg", expectedCharacterCount);
    await logGeminiCall(supabase, { callType: "template_character_count_judge", storyId, pageId });
    characterCountVerified = isMatch;
    if (!isMatch) console.warn(`[template/character-count] page ${pageId}: expected ${expectedCharacterCount}, got ${actualCount ?? "?"} -- ${reason}`);
  } catch (err) {
    console.error("[template/character-count] judge call failed:", err);
  }

  // Null out image_url_girl -- every existing "girl" preview across the admin
  // UI falls back to image_url_girl ?? image_url, so leaving stale pre-migration
  // content there would silently show an outdated image for "girl" while "boy"
  // shows the new shared template.
  //
  // Written as its own update, separate from character_count_verified below --
  // a real regen (page 17) proved that combining them silently loses the
  // generated image: character_count_verified's column doesn't exist until
  // its migration is run, PostgREST then rejects the WHOLE update, and since
  // the result wasn't checked, image_url never persisted even though the
  // Gemini call and storage upload both succeeded. The critical write must
  // never depend on the optional flag succeeding.
  const { error: imageUpdateError } = await supabase
    .from("story_pages")
    .update({ image_url: storagePath, image_url_girl: null })
    .eq("id", pageId);
  if (imageUpdateError) throw new Error(`Failed to save generated image: ${imageUpdateError.message}`);

  try {
    const { error: flagError } = await supabase
      .from("story_pages")
      .update({ character_count_verified: characterCountVerified })
      .eq("id", pageId);
    if (flagError) console.error("[template/character-count] failed to persist flag:", flagError.message);
  } catch (err) {
    console.error("[template/character-count] failed to persist flag:", err);
  }

  const signedBaseUrl = await signAsset(supabase, storagePath);

  // Age-band variants (1-4, 9-12) are no longer derived automatically here --
  // each extra derivation is its own Gemini call, and during active E2E
  // testing of the core pipeline that cost isn't worth paying on every single
  // regen. Trigger them explicitly via the "Generate age bands" button
  // (generateAgeVariantsForPage) once the base is confirmed good.

  revalidatePath(`/stories/${storyId}`);
  return { url: signedBaseUrl, characterCountVerified };
}
