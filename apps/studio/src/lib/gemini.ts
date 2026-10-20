import { GoogleGenerativeAI } from "@google/generative-ai";

// Lazy so importing this module doesn't throw at build/import time when
// GOOGLE_GEMINI_API_KEY isn't set (Next collects route data at build time,
// which evaluates this module even though no request is being served then).
let cachedGemini: GoogleGenerativeAI | null = null;
export function getGemini(): GoogleGenerativeAI {
  if (!cachedGemini) {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      throw new Error("GOOGLE_GEMINI_API_KEY environment variable is not set");
    }
    cachedGemini = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
  }
  return cachedGemini;
}

// Nano Banana 2 — Google's current recommended default image model. Used for
// every identity-preservation edit (order-time fill-in, age-band resize,
// costumed-sheet generation, character sheet/cartoon), every judge/verify
// call, AND (as of this session) base scene/cover generation again
// (generateSpreadScene, generateNanaBananaScene, generateCoverSpread,
// generateCoverSwapTemplate) -- Pro was trialed for scene gen to fix
// multi-character hallucination but a real production regen (page 17, 3
// cast refs) still hallucinated a 5th person on Pro, so scene gen moved
// back here.
export const NANO_BANANA_2_MODEL = "gemini-3.1-flash-image";
// Nano Banana Pro — the higher tier. Confirmed via direct side-by-side
// testing this session: Flash was unreliable at holding an exact headcount
// across multiple simultaneous character references (hallucinating/
// duplicating people even with an explicit "exact cast" rule), and Pro
// reduced but did NOT eliminate this -- a real production regen (page 17,
// 3 cast refs) still hallucinated a 5th person on Pro. Currently unused;
// kept in case it's worth reinstating.
export const NANO_BANANA_PRO_MODEL = "gemini-3-pro-image-preview";
// Nano Banana Lite -- cheapest/fastest tier, normally reserved for
// high-volume lightweight tasks. Trialed for base scene/cover generation
// after Pro failed to reliably fix the multi-character hallucination
// problem; currently unused (scene gen is back on NANO_BANANA_2_MODEL)
// but kept for reference.
export const NANO_BANANA_LITE_MODEL = "gemini-3.1-flash-lite-image";
// Google's current recommended default text model.
export const GEMINI_TEXT_MODEL = "gemini-3.1-flash";

/**
 * Fetch a URL and return it as a base64-encoded inline data part for Gemini.
 */
export async function urlToInlineData(
  url: string,
  mimeType: string = "image/webp"
): Promise<{ inlineData: { data: string; mimeType: string } }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image from ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const data = Buffer.from(buffer).toString("base64");
  return { inlineData: { data, mimeType } };
}

export const CHARACTER_SHEET_SYSTEM_PROMPT = `You are an expert character designer for children's storybooks.
Generate a character identity reference turnaround sheet in Pixar 3D animated movie style — vibrant, polished, child-friendly.
The output must be a single wide image containing exactly four equal panels arranged side by side, left to right:
1. FRONT VIEW — character facing directly toward the viewer, arms relaxed at sides
2. LEFT SIDE VIEW — character's left profile, full body
3. RIGHT SIDE VIEW — character's right profile, full body
4. BACK VIEW — character facing directly away from viewer, full body
Each panel shows the full character on a plain white background with soft even studio lighting.
The character MUST look identical across all four panels — same face, same hair, same skin tone, same proportions.
IMPORTANT: Dress the character in a simple, neutral, but COMPLETE outfit — a plain white or light grey t-shirt, plain trousers, and simple plain white sneakers/shoes. The character must always be wearing shoes — never barefoot, never with bare or undefined feet.
Do NOT invent story costumes or elaborate outfits. This sheet is for face and identity reference only; costumes will be applied per scene separately.
Label each panel with small text at the bottom: FRONT, LEFT, RIGHT, BACK.`;

// Shared fidelity rules for both identity sheets. Measured on real orders: the
// old one-sentence "match the face precisely" produced sheets whose faces
// drifted from the portrait (a rounder, fuller face came back slimmer with
// smaller features, plus hairstyles the portrait never had, e.g. invented
// pigtails in profile) -- and every page fill-in then copies the sheet.
const CHARACTER_FIDELITY_RULES = `FACE FIDELITY -- the whole point of this image:
The face in EVERY panel must be the exact same face as the portrait, not a redesign, not a "cuter" or generic child. Copy these from the portrait exactly: overall face shape and width, jaw and chin shape, cheek fullness, forehead height, eye shape/size/spacing/color, eyebrow shape and thickness, nose shape and size, lip shape and fullness, ear shape and size, skin tone, freckles/marks, and any earrings or glasses. Do not slim the face, shrink the features, enlarge the eyes, or change the age.
HAIR: reproduce the visible hairstyle, color, length, texture and parting exactly. For areas the portrait cannot show (sides, back), continue the visible hair naturally at the SAME length, color and texture. NEVER add ponytails, pigtails, buns, braids, clips or bangs that are not visible in the portrait.
STYLE: same 3D render style, lighting and skin rendering as the portrait. Neutral soft studio light, plain white background.`;

/**
 * Given a Pixar-style cartoon portrait, generate the 4-view (front/left/right/back)
 * full-body sheet used for body proportions, pose and outfit. The face is
 * tiny on this sheet (~10% of panel height) -- generateHeadSheetBuffer is the
 * real face reference.
 */
export async function generateCharacterSheetBuffer(cartoonImageUrl: string): Promise<Buffer> {
  const cartoonData = await urlToInlineData(cartoonImageUrl, "image/png");
  const sheetModel = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: CHARACTER_SHEET_SYSTEM_PROMPT,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "16:9" } } as never,
  });

  const { response } = await sheetModel.generateContent([
    { text: "Identity reference portrait:" },
    cartoonData,
    {
      text: `Generate the four-panel full-body identity sheet (FRONT, LEFT, RIGHT, BACK) of this exact child, side by side, same scale, neutral standing pose. Dress the character in a simple, neutral, but complete outfit -- plain white or light grey t-shirt, plain trousers, and simple plain white sneakers/shoes. No story costumes. The character must be wearing shoes in every panel -- never barefoot. Label panels FRONT, LEFT, RIGHT, BACK.
${CHARACTER_FIDELITY_RULES}
The head in the FRONT panel must look like a faithful miniature of the portrait's face; do not simplify or genericize it just because it is smaller.`,
    },
  ]);

  return extractImageBuffer(response);
}

/**
 * Head turnaround: six large head-and-shoulders views (front, 3/4 left, left
 * profile, back, 3/4 right, right profile). On the full-body sheet the face is
 * too small for the model to copy faithfully, so this is the face reference
 * for every angle -- fill-ins pick the view closest to the scene's pose.
 */
export async function generateHeadSheetBuffer(cartoonImageUrl: string): Promise<Buffer> {
  const cartoonData = await urlToInlineData(cartoonImageUrl, "image/png");
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "3:2" } } as never,
  });

  const { response } = await model.generateContent([
    { text: "Identity reference portrait of a specific child:" },
    cartoonData,
    {
      text: `Create a HEAD TURNAROUND reference sheet of this exact child: six equal panels in two rows of three, each showing head, neck and shoulders large in frame (the head fills most of each panel), all at identical scale and camera height. Labels under each panel in small clean text.
Row 1: FRONT, 3/4 LEFT, LEFT PROFILE.   Row 2: BACK, 3/4 RIGHT, RIGHT PROFILE.
The FRONT panel should look like the portrait itself, same expression. Other angles use a relaxed neutral expression.
Wear a plain neutral crew-neck tee (no costume).
${CHARACTER_FIDELITY_RULES}`,
    },
  ]);

  return extractImageBuffer(response);
}

/**
 * Given a character's neutral identity sheet, edit ONLY the clothing across
 * all four panels to a specific, book-defined costume -- reusing the sheet's
 * own reliability (editing one image) instead of re-describing an outfit in
 * text on every independent per-scene fill-in call, which drifts across
 * calls the same way any independent generation does.
 */
export async function generateCostumedSheetBuffer(
  neutralSheetUrl: string,
  costumeDescription: string,
  heroGender: "boy" | "girl",
  // The cartoon portrait this sheet was itself generated from -- the closest
  // thing to ground truth still available (the raw uploaded photo is never
  // persisted, by design, for privacy). Every edit hop after the original
  // cartoonize call has a chance to drift a little from the real child; this
  // gives the model something to double-check the face against instead of
  // only re-deriving it from the sheet it's already editing, so a costume
  // edit can't quietly degrade the face along with it.
  groundTruthPortraitUrl?: string | null
): Promise<Buffer> {
  const sheetData = await urlToInlineData(neutralSheetUrl, "image/png");
  const portraitData = groundTruthPortraitUrl ? await urlToInlineData(groundTruthPortraitUrl, "image/png") : null;
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: `You are a precise image editor. Your ONLY job is changing the clothing on an existing 4-panel character identity reference sheet -- not general character design, not a new sheet.`,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [
    { text: "Here is the existing 4-panel identity reference sheet (FRONT, LEFT, RIGHT, BACK) of a specific child, currently in plain neutral clothing:" },
    sheetData,
  ];
  if (portraitData) {
    parts.push(
      { text: "Here is the original portrait this sheet was generated from -- the most faithful likeness reference for this child's actual face. If the sheet's face ever looks even slightly different from this portrait, trust this portrait:" },
      portraitData
    );
  }
  parts.push({
    text: `TASK: re-render the 4-panel sheet -- same face, same hairstyle, same skin tone, same eye shape, same body proportions, same pose in each panel, same 4-panel layout and labels, same plain white background -- but change ONLY the clothing in all four panels to this outfit, adapted naturally for a ${heroGender}: "${costumeDescription}". The outfit must look identical and consistent across all four panels. Do not change anything about the face, hair, or body -- this is a clothing edit only.${portraitData ? " Use the original portrait above to keep the face precisely anchored to the real child while you edit the clothing." : ""}`,
  });

  const { response } = await model.generateContent(parts);
  return extractImageBuffer(response);
}

/**
 * Thrown when Gemini returns no image. Carries the finish/block reason so
 * callers (and logs) can tell IMAGE_SAFETY blocks and other refusals apart
 * from real errors -- the old bare "No image in Gemini response" hid all of it.
 */
export class GeminiNoImageError extends Error {
  constructor(message: string, readonly finishReason: string) {
    super(message);
    this.name = "GeminiNoImageError";
  }
}

/**
 * Extract the first image from a Gemini response and return it as a Buffer.
 */
export function extractImageBuffer(
  response: Awaited<ReturnType<ReturnType<ReturnType<typeof getGemini>["getGenerativeModel"]>["generateContent"]>>["response"]
): Buffer {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }
  const finishReason = String(candidate?.finishReason ?? response.promptFeedback?.blockReason ?? "UNKNOWN");
  const flagged = (candidate?.safetyRatings ?? [])
    .filter((r) => String(r.probability) !== "NEGLIGIBLE")
    .map((r) => `${r.category}=${r.probability}`);
  const refusalText = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 200);
  console.error(
    `[gemini] no image returned: finishReason=${finishReason}` +
    (flagged.length ? ` safety=[${flagged.join(", ")}]` : "") +
    (refusalText ? ` text="${refusalText}"` : "")
  );
  throw new GeminiNoImageError(`No image in Gemini response (finishReason=${finishReason})`, finishReason);
}
