import { getGemini, NANO_BANANA_2_MODEL, urlToInlineData, extractImageBuffer } from "@/lib/gemini";
import type { createServerClient } from "@/lib/supabase/server";

// Shared blank-silhouette hero instruction, used by every template-generation
// path (spread pages, square/split pages, covers). Validated this session
// across scenes of increasing complexity (calm family photo, a 10+ character
// market scene, a scene where the hero touches two other characters) with
// zero wrong-character or hallucinated-extra-child failures -- because
// nothing else in a real scene is a flat white shape, there's no ambiguity
// left for the order-time identity swap to get wrong.

export type AgeBand = "1-4" | "5-8" | "9-12";

// The order's child_age (orders.child_age, 1-12, collected on the storefront
// order form) maps to one of these bands -- see ageToBand in the order-time
// swap actions (duplicated per-app, same convention as personalizeText etc.).
const AGE_BAND_DESCRIPTIONS: Record<AgeBand, string> = {
  "1-4": "a 2- to 3-year-old toddler/preschooler -- a noticeably larger head-to-body ratio than an older child, short limbs, small stature -- clearly shorter than any adult standing nearby, and shorter than an elementary-school-age child would be",
  "5-8": "a 7- to 8-year-old elementary-school-age child -- not a toddler, not a teenager, not an adult",
  "9-12": "a 10- to 11-year-old -- taller and leaner than a younger child, a head-to-body ratio closer to an adult's but still clearly a child, not a teenager or adult",
};

export function buildHeroSilhouetteInstruction(band: AgeBand): string {
  return (
    `CHARACTER RENDERING RULES:\n` +
    `- EXACT CAST, no more, no fewer: render ONLY the character(s) shown in the reference sheet(s) provided, plus THE HERO as the blank silhouette described below. If the scene text refers to a group collectively (e.g. "the family," "they," "everyone"), that group consists of exactly the reference character(s) provided plus THE HERO -- nothing more. Do not invent, duplicate, or add any additional people, even if the scene's wording could imply a headcount -- count the reference sheets provided, add exactly one for THE HERO, and render precisely that many people.\n` +
    `- Any other characters described in the scene: render them fully and normally, using their reference sheets where provided.\n` +
    `- THE HERO: this is the one character with NO reference sheet provided. Render THE HERO as a completely blank, featureless, pure solid white (#FFFFFF) humanoid silhouette -- a plain unpainted mannequin or flat white paper cutout of a child, correctly posed and positioned in the scene exactly as described, but with ABSOLUTELY NO face, no facial features, no eyes, no mouth, no hair, no skin tone, no clothing texture or pattern, and no color at all -- pure flat white, matte, featureless. Every other element and person should be fully detailed and richly rendered as normal -- only THE HERO is the blank white silhouette.\n` +
    `- THE HERO'S AGE AND SIZE (must be consistent every single time, in every scene): THE HERO is ${AGE_BAND_DESCRIPTIONS[band]}. Use body proportions appropriate for that age -- head-to-body ratio and limb length must match. For height, anchor THE HERO against any adult standing nearby -- adults are noticeably taller. If no adult is present in this particular scene, size THE HERO as if that same adult-relative height held true. This exact age, build, and relative height must not vary from image to image -- THE HERO is the same physical child in every scene of this band.`
  );
}

// Backward-compatible default -- the "5-8" band is today's existing template
// generation behavior (unchanged), used wherever a single base scene is
// generated before deriving the other two bands.
export const HERO_SILHOUETTE_INSTRUCTION = buildHeroSilhouetteInstruction("5-8");

function buildResizeSystemPrompt(): string {
  return (
    `You are a precise image editor. Your ONLY job is resizing and reproportioning ONE specific character within an existing image -- not general scene art, not a new composition.\n` +
    `You will receive an existing illustration containing one blank, featureless, pure white silhouette character among other fully-rendered characters and a background.`
  );
}

// Derives an age-band variant of a template by editing ONLY the blank hero
// silhouette's size/proportions in an already-generated base scene (the
// "5-8" band), preserving every other pixel exactly -- background, other
// characters, composition, lighting, colors. This is the same edit-in-place
// technique as fillInHeroIdentity (apps/studio/src/app/orders/generate/actions.ts),
// applied to a shape resize instead of a face fill-in. Reusing one base
// generation and editing derivatives from it (rather than generating 3
// independent scenes) is what makes "identical environment across bands"
// achievable -- independent Gemini calls reliably drift, even with an
// identical prompt (see the left/right compositing consistency work earlier
// this session).
export async function resizeHeroForBand(
  baseImageUrl: string,
  targetBand: AgeBand,
  // Callers store the base image as jpeg (spread pages, covers) or webp
  // (square/split pages) -- urlToInlineData defaults to webp, which would be
  // wrong for the jpeg callers, so this must be passed explicitly.
  mimeType: string
): Promise<Buffer> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildResizeSystemPrompt(),
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [];
  parts.push(await urlToInlineData(baseImageUrl, mimeType));
  parts.push(
    `IMAGE: contains one blank white silhouette character (the hero placeholder, no face/hair/clothing/color) among other fully-rendered characters and a background.\n\n` +
    `TASK: resize and reproportion ONLY the blank white silhouette to look like ${AGE_BAND_DESCRIPTIONS[targetBand]} instead of its current size, keeping it in the exact same pose and standing position -- just scaled and reproportioned to the new age/height -- while preserving every other pixel of the image exactly: same background, same other characters, same composition, same lighting, same colors, same camera angle. The silhouette must remain pure solid white (#FFFFFF), featureless, and matte -- do not add a face, hair, clothing, or any color to it.\n\n` +
    `Perform this resize only. Do not regenerate, restyle, or alter any other part of the image.`
  );

  const result = await model.generateContent(parts);
  return extractImageBuffer(result.response);
}

function buildCharacterCountJudgeSystemPrompt(): string {
  return (
    `You are a strict quality-control judge for children's book illustration QA. Your ONLY job is counting distinct human characters in an image precisely.`
  );
}

// Verifies the base template rendered the exact expected headcount (every
// reference character + the blank-silhouette hero, no more, no fewer) --
// confirmed empirically this session that Gemini sometimes hallucinates an
// extra person despite the EXACT CAST rule above, and this is generation
// variance rather than a deterministic prompt bug (the same prompt+references
// produced the correct count on one call and an extra person on another).
// No auto-retry -- this just flags the result so an admin can decide whether
// to regenerate, same as identity_verified does for the order-time swap.
export async function judgeCharacterCount(
  resultBuffer: Buffer,
  resultMimeType: string,
  expectedCount: number
): Promise<{ isMatch: boolean; actualCount: number | null; reason: string }> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildCharacterCountJudgeSystemPrompt(),
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [
    { inlineData: { data: resultBuffer.toString("base64"), mimeType: resultMimeType } },
    `Count the number of distinct human characters visible in this image -- children and adults, including any blank white featureless silhouette figure (count it as one person). This scene is expected to contain EXACTLY ${expectedCount} people, no more and no fewer.\n\n` +
    `Respond in EXACTLY this format, nothing else:\n` +
    `COUNT: <number>\n` +
    `VERDICT: MATCH or NO_MATCH\n` +
    `REASON: <one short sentence>`,
  ];

  const result = await model.generateContent(parts);
  const text = result.response.text().trim();
  const actualCount = (() => {
    const m = text.match(/COUNT:\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  })();
  const isMatch = /VERDICT:\s*MATCH/i.test(text) && !/VERDICT:\s*NO_MATCH/i.test(text);
  const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? text;
  return { isMatch, actualCount, reason };
}

// Shared orchestration for every template-generation call site: derive the
// "1-4" and "9-12" variants (via resizeHeroForBand) from the base image and
// write both rows into the age-variant table. Callers supply their own
// upload function since storage-path naming differs per call site
// (story-pages/, scene-images/, story-covers/).
//
// "5-8" is deliberately NOT written here (and never was generated -- it
// used to just copy the base path into a third row). The base image IS the
// 5-8 band already, so there's nothing to derive; readers (getPageAgeVariantUrls
// / getCoverAgeVariantUrls) resolve "5-8" straight from the current base
// image instead. Writing a snapshot copy of the base path was actively
// harmful: it goes stale the moment the base is regenerated without also
// re-running age-band generation, silently serving an old scene to any order
// whose age falls in the default band -- exactly what happened on this story
// (a real regen, page 17: 12 of 20 pages had a "5-8" row pointing at a base
// image that no longer matched the current one).
export async function storeAgeVariants(params: {
  supabase: ReturnType<typeof createServerClient>;
  table: "story_page_age_variants" | "story_cover_age_variants";
  keyColumn: "page_id" | "story_id";
  keyValue: string;
  baseSignedUrl: string;
  mimeType: string;
  uploadDerivative: (buffer: Buffer, band: AgeBand) => Promise<string>;
}): Promise<void> {
  const bands: Exclude<AgeBand, "5-8">[] = ["1-4", "9-12"];
  await Promise.all(
    bands.map(async (band) => {
      const imagePath = await params.uploadDerivative(await resizeHeroForBand(params.baseSignedUrl, band, params.mimeType), band);
      await params.supabase
        .from(params.table)
        .upsert({ [params.keyColumn]: params.keyValue, age_band: band, image_url: imagePath } as never);
    })
  );
}
