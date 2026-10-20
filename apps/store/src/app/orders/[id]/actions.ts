"use server";

import { createServerClient } from "@/lib/supabase/server";
import { signAsset, signAssets } from "@/lib/supabase/assets";
import { getGemini, NANO_BANANA_2_MODEL, urlToInlineData, extractImageBuffer, generateCostumedSheetBuffer, generateHeadSheetBuffer, GeminiNoImageError } from "@/lib/gemini";
import { logGeminiCall } from "@/lib/geminiLog";
import { trackServer } from "@/lib/track-server";
import { getGoogleFontName } from "@/lib/fonts";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_PANEL_BG, type LayoutType, type TextStyle, type TextPanelBg } from "@/lib/supabase/types";

const PREVIEW_PAGE_COUNT = 3;

// The template's hero is a blank white silhouette (baked in at
// template-generation time by apps/studio). This step is a pure fill-in --
// there's no other character in the scene that could be confused for the
// hero, since nothing else is a flat white shape. Likeness fidelity is
// still a separate, real problem (any generative fill has some chance of
// not looking enough like the reference), so every fill is checked by a
// second Gemini call (judgeIdentityMatch) and retried up to
// MAX_SWAP_ATTEMPTS times. Mirrors apps/studio/src/app/orders/generate/actions.ts.
//
// Briefly lowered to 2 for cost, then raised back to 3 -- real customer
// feedback called identity preservation unacceptable, which reprioritizes
// this over the ~$0.09/retry cost. The judge-noise finding that justified
// the cut still holds, but the fix for that is better reference material
// (cartoonHeadshotUrl is now actually anchored in the judge prompt, not
// just silently attached) and the cheap "Re-verify identity" admin action,
// not fewer chances to get a genuinely bad fill-in right.

const MAX_SWAP_ATTEMPTS = 3;
const COSTUME_SHEET_ATTEMPTS = 2;

// Normalizes a story_pages.scene_prompt's placeholder tokens into plain
// gender-correct text before it's handed to the fill-in prompt as scene
// context -- mirrors apps/studio's personalizeText, duplicated here per this
// codebase's existing convention of not sharing logic between the two apps.
function personalizeSceneContext(text: string, heroGender: "boy" | "girl"): string {
  const he = heroGender === "girl" ? "she" : "he";
  const him = heroGender === "girl" ? "her" : "him";
  const his = heroGender === "girl" ? "her" : "his";
  const himself = heroGender === "girl" ? "herself" : "himself";
  return text
    .replace(/{{hero_name}}/g, "the hero")
    .replace(/{{hero_he}}/g, he)
    .replace(/{{hero_him}}/g, him)
    .replace(/{{hero_his}}/g, his)
    .replace(/{{hero_himself}}/g, himself);
}

// Full placeholder personalization for text actually SHOWN to the customer
// (live preview + PDF export) -- unlike personalizeSceneContext above (which
// deliberately substitutes the generic "the hero" for Gemini prompts), this
// puts the real hero_name in and also resolves the pronoun placeholders,
// which two call sites here used to skip entirely (a bare
// .replace(/{{hero_name}}/g, ...)), leaving any {{hero_he}}/{{hero_him}}/
// {{hero_his}}/{{hero_himself}} in the story text rendered completely
// literally to the customer, e.g. "Anika rolled {{hero_his}} eyes."
function personalizeText(text: string, heroName: string, gender: "boy" | "girl"): string {
  const he = gender === "girl" ? "she" : "he";
  const him = gender === "girl" ? "her" : "him";
  const his = gender === "girl" ? "her" : "his";
  const himself = gender === "girl" ? "herself" : "himself";
  return text
    .replace(/{{hero_name}}/g, heroName)
    .replace(/{{hero_he}}/g, he)
    .replace(/{{hero_him}}/g, him)
    .replace(/{{hero_his}}/g, his)
    .replace(/{{hero_himself}}/g, himself);
}

// Maps the order's child_age (1-12, collected on the storefront order form)
// to the matching template band -- mirrors apps/studio's ageToBand. Falls
// back to the "5-8" mid-band for legacy orders with no child_age recorded.
function ageToBand(age: number | null | undefined): "1-4" | "5-8" | "9-12" {
  const a = age ?? 6;
  if (a <= 4) return "1-4";
  if (a <= 8) return "5-8";
  return "9-12";
}

function buildFillInSystemPrompt(): string {
  return (
    `You are a forensic character-identity illustrator. Your ONLY job is precise likeness reproduction, not general scene art.\n` +
    `You will receive a scene image with one blank white silhouette placeholder, and a 4-view identity reference sheet (FRONT, LEFT, RIGHT, BACK) of a specific real child.\n` +
    `The final render must be recognizable as THIS SPECIFIC CHILD to someone who knows them, not a generic or approximate likeness.\n` +
    `RENDER STYLE: the filled-in character must match the scene's own rendering style exactly -- Pixar-style cinematic 3D rendering, physically based lighting, soft global illumination, photorealistic materials. It must look like it came from the same 3D engine as the rest of the image, not a painted, flat, or 2D-illustrated character pasted into a 3D scene. Likeness accuracy and render style are both non-negotiable, not a tradeoff.`
  );
}

function buildJudgeSystemPrompt(): string {
  return (
    `You are an identity-verification judge for children's book illustration QA. You compare a rendered character's face against a reference identity sheet and decide if they are the SAME specific child.\n` +
    `Match on the big, stable features -- face shape, skin tone, hair colour and rough style, eye shape. This is a full image regeneration, not a pixel copy, so minor rendering variance (slightly different angle, lighting, exact hair strand placement, small proportion drift) between attempts is normal and NOT grounds for rejection. Only reject if a different child's defining features are clearly present -- a notably different face shape, hair colour, or skin tone, the kind of difference a parent would immediately notice.`
  );
}

async function fillInHeroIdentity(
  characterImageUrl: string,
  cartoonHeadshotUrl: string | null,
  approvedSceneUrl: string,
  heroGender: "boy" | "girl",
  // The page's scene_prompt (pronoun-normalized), so the fill has some
  // textual signal for the hero's expression/mood -- without it the blank
  // silhouette carries zero facial information and Gemini can only guess
  // from visually inferring the rest of the already-rendered scene.
  sceneContext?: string,
  // True when characterImageUrl is already a costumed identity sheet (see
  // getOrCreateCostumedSheet) -- the outfit is then part of the reference
  // image itself, reproduced like any other likeness detail. Mirrors
  // apps/studio.
  usingCostumedSheet?: boolean,
  // Six large head views (front, 3/4, profiles, back) -- the body sheet's
  // face is only ~10% of panel height, too small to copy faithfully at any
  // angle. See generateHeadSheetBuffer. Mirrors apps/studio.
  headSheetUrl?: string | null,
): Promise<Buffer> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildFillInSystemPrompt(),
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [];

  parts.push(await urlToInlineData(characterImageUrl, "image/png"));
  // When a head turnaround exists it is the ONLY face/hair authority. The body
  // sheet's face renders at ~10% of panel height and drifts from the portrait
  // (measured on real orders), so telling the model to also copy the face
  // from it created two conflicting face references.
  parts.push(
    headSheetUrl
      ? `BODY & OUTFIT SHEET (4 full-body panels -- FRONT, LEFT, RIGHT, BACK). Use this sheet ONLY for body proportions and build, limb skin tone${usingCostumedSheet ? ", and the exact outfit (front, side and back). WARDROBE LOCK: this sheet is the SOLE authority for every garment, garment colour, pattern/graphic, bottom, shoe, and accessory. No later reference may alter or override its clothing" : ""}. DO NOT take the face or hair from this sheet: the faces on it are tiny and unreliable and can disagree with the child's real likeness. This child's face and hair come ONLY from the portrait and the head turnaround.`
      : (
    `IDENTITY REFERENCE SHEET (study all views before rendering anything). ` +
      `This is a specific individual child, not a generic character archetype. Note precisely, from the reference:\n` +
      `- Face shape and proportions (viewed from front AND side profiles)\n` +
      `- Exact hairstyle: length, part direction, texture, volume, and hair colour\n` +
      `- Eye shape, eye colour, and eyebrow shape\n` +
      `- Nose shape and mouth/lip shape\n` +
      `- Skin tone and undertone\n` +
      `- Any distinguishing features (ear shape, chin shape, cheek fullness)\n` +
      (usingCostumedSheet ? `- Exact clothing/outfit as shown in the reference — this is the hero's defined costume for this book\n` : "") +
      `You will reproduce THIS EXACT child's face, hair${usingCostumedSheet ? ", and outfit" : ""}, not a similar-looking or generic substitute.`
      )
  );

  // The cartoon portrait this sheet was itself generated from -- the closest
  // thing to ground truth still available (the raw uploaded photo is never
  // persisted, by design, for privacy). The sheet is already one AI-
  // generation hop removed from that portrait (two if costumed); comparing
  // against only the sheet means drift that already happened upstream goes
  // unnoticed. This was previously pushed as an unlabeled inline image with
  // no text ever telling the model what it was or that it should take
  // priority -- fixed here.
  if (cartoonHeadshotUrl && cartoonHeadshotUrl !== characterImageUrl) {
    parts.push(await urlToInlineData(cartoonHeadshotUrl, "image/png"));
    parts.push(
      `ORIGINAL PORTRAIT (above): generated before the sheet, and before any costume edit -- the single most faithful likeness reference for this child's actual face available. The sheet is derived from this portrait, but each edit hop has some chance of drifting slightly. If the sheet's face ever looks even slightly different from this portrait in shape, proportions, or features, TRUST THIS PORTRAIT over the sheet for the face specifically. ${usingCostumedSheet ? "ZERO WARDROBE AUTHORITY: ignore and do not copy any shirt, dress, graphic, colour, bottom, shoe, or accessory visible in this portrait. Those belong to the source photo, not this book. The BODY & OUTFIT SHEET is the sole wardrobe authority." : "Use the sheet for the side/back angles and pose."}`
    );
  }

  if (headSheetUrl) {
    parts.push(await urlToInlineData(headSheetUrl, "image/png"));
    parts.push(
      `HEAD TURNAROUND (above): six large views of this child's head -- FRONT, 3/4 LEFT, LEFT PROFILE, BACK, 3/4 RIGHT, RIGHT PROFILE. This is the best reference for how this exact face looks at each angle. Look at which way the blank silhouette's head is turned in the scene, find the closest view on this turnaround, and copy that view's face exactly: same face shape, jaw, cheeks, eyes, brows, nose, lips, ears, hairline and hair. Use it for angle-specific shape (profile nose/chin line, ear, hair at the sides and back); use the portrait for frontal likeness and the body sheet for body proportions and outfit.${usingCostumedSheet ? " ZERO WARDROBE AUTHORITY: ignore any clothing fragments visible at the neck or shoulders; never extend them into the scene." : ""}`
    );
  }

  parts.push(await urlToInlineData(approvedSceneUrl));
  parts.push(
    `SCENE IMAGE: contains one character rendered as a blank, featureless, pure white silhouette (no face, hair, or clothing detail). ` +
    `Every other character and element is already fully rendered and must be preserved exactly as-is — do not change background, lighting, composition, other characters, or anything outside the blank silhouette.\n\n` +
    `TASK: replace ONLY the blank silhouette with the exact child from ${headSheetUrl ? "the portrait and head turnaround above" : "the identity reference above"} — same face shape, same hairstyle and hair colour, same eye shape/colour, same skin tone, same distinguishing features. This is a strict likeness match, not "a child who looks similar" — imagine the reference child's own parent looking at the result and immediately recognizing them, not just seeing "some kid". Keep the silhouette's existing pose, position, and scale exactly. ${usingCostumedSheet
      ? `WARDROBE LOCK: reproduce the complete outfit from the BODY & OUTFIT SHEET exactly. Match garment types, dominant colours, patterns/graphics, bottoms, shoes, and accessories. Never use, blend with, or borrow clothing from the ORIGINAL PORTRAIT or HEAD TURNAROUND. Before finalizing, compare the rendered outfit against the body sheet item by item and correct every mismatch.`
      : `Add simple clothing consistent with the rest of the scene and appropriate for a ${heroGender}, since the silhouette has none.`}` +
    (sceneContext
      ? `\n\nSCENE MOMENT (guides the hero's facial expression and body energy ONLY — never let this override the identity likeness rules above): "${sceneContext}"\n` +
        `Give the hero a facial expression and posture that authentically fits this specific moment — the kind of genuine reaction a real child would have (e.g. wonder, delight, curiosity, surprise, calm focus) — while keeping the exact face shape, features, and likeness from the identity reference, and the silhouette's existing pose, position, and scale.`
      : "") +
    `\n\nPerform a strict-likeness fill-in of the blank silhouette only. Preserve every other pixel of the scene image exactly.`
  );

  const result = await model.generateContent(parts);
  return extractImageBuffer(result.response);
}

async function judgeIdentityMatch(
  characterImageUrl: string,
  resultBuffer: Buffer,
  // Same ground-truth anchor fillInHeroIdentity takes -- judging the result
  // against ONLY the sheet means a good match to an already-drifted sheet
  // still passes. Comparing against the earlier, less-removed portrait too
  // catches drift the sheet itself already has, not just drift introduced by
  // this one fill-in call.
  groundTruthPortraitUrl?: string | null,
  // Multi-angle head reference: lets the judge compare the rendered face
  // against the view closest to the angle actually shown.
  headSheetUrl?: string | null
): Promise<{ isMatch: boolean; reason: string }> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildJudgeSystemPrompt(),
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [
    await urlToInlineData(characterImageUrl, "image/png"),
    headSheetUrl
      ? "BODY SHEET above: full-body views of a specific child, useful for body and outfit only. Its faces are tiny and unreliable -- judge the FACE against the portrait and head turnaround below, not this sheet."
      : "IDENTITY REFERENCE above: a specific child.",
  ];
  if (groundTruthPortraitUrl) {
    parts.push(
      await urlToInlineData(groundTruthPortraitUrl, "image/png"),
      "ORIGINAL PORTRAIT above: generated before the sheet, the single most faithful likeness reference for this child's actual face available. If the sheet and this portrait ever disagree on the face, trust this portrait as the stronger signal."
    );
  }
  if (headSheetUrl) {
    parts.push(
      await urlToInlineData(headSheetUrl, "image/png"),
      "HEAD TURNAROUND above: six large views of this child's head (front, 3/4, profiles, back). Compare the rendered face against the view closest to the angle shown in the rendered image."
    );
  }
  const multiRef = !!(groundTruthPortraitUrl || headSheetUrl);
  parts.push(
    { inlineData: { data: resultBuffer.toString("base64"), mimeType: "image/webp" } },
    `RENDERED IMAGE above: a generated illustration, possibly containing several characters, including one claimed to be the same child as the identity reference — the hero of the scene, usually the most central/foregrounded child. Find that child and compare their face against the identity reference${multiRef ? "(s)" : ""}.\n\n` +
    `Does that child's face match the identity reference${multiRef ? "s" : ""} closely enough that this child's own parent would recognize them at a glance (same face shape, hair colour, skin tone)? Minor rendering differences in exact hairstyle shape, lighting, or angle between generations don't count against a match -- only a clearly different face shape, hair colour, or skin tone does. Ignore differences in clothing, pose, expression, and art rendering angle — judge identity likeness only.\n\n` +
    `Respond in EXACTLY this format, nothing else:\n` +
    `VERDICT: MATCH or NO_MATCH\n` +
    `REASON: <one short sentence>`,
  );

  const result = await model.generateContent(parts);
  const text = result.response.text().trim();
  const isMatch = /VERDICT:\s*MATCH/i.test(text) && !/VERDICT:\s*NO_MATCH/i.test(text);
  const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? text;
  return { isMatch, reason };
}

// Kept separate from identity QA because that judge deliberately ignores
// clothing. This gate catches the common failure where the face is right but
// the portrait's original clothes override the story's costume sheet.
async function judgeWardrobeMatch(
  costumedSheetUrl: string,
  resultBuffer: Buffer
): Promise<{ isMatch: boolean; reason: string }> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction:
      `You are a strict wardrobe-continuity judge for a children's book. Compare the hero's outfit in a rendered scene with the authoritative full-body costume sheet. Judge garment identity, not art-style or lighting differences.`,
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });
  const result = await model.generateContent([
    await urlToInlineData(costumedSheetUrl, "image/png"),
    `AUTHORITATIVE COSTUME SHEET above. It is the sole wardrobe source. Record the garment types, dominant colours, patterns or graphics, bottoms, footwear, and accessories shown across its views.`,
    { inlineData: { data: resultBuffer.toString("base64"), mimeType: "image/webp" } },
    `RENDERED SCENE above. Find the filled-in hero and compare only their visible wardrobe with the costume sheet. Allow normal pose, perspective, lighting, folds, and genuine occlusion. Reject if any visible garment type, dominant colour, pattern/graphic, bottom, footwear, or accessory conflicts with the sheet, if clothing from another reference was substituted, or if two outfits were blended. Do not judge face likeness.\n\nRespond in EXACTLY this format, nothing else:\nVERDICT: MATCH or NO_MATCH\nREASON: <one short sentence>`,
  ]);
  const text = result.response.text().trim();
  const isMatch = /VERDICT:\s*MATCH/i.test(text) && !/VERDICT:\s*NO_MATCH/i.test(text);
  const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? text;
  return { isMatch, reason };
}

// Mirrors apps/studio's judgeScenePreserved -- the fill-in prompt tells
// Gemini to preserve every other character and pixel exactly, but that's an
// instruction, not a guarantee: confirmed on a real order where filling in
// the hero's silhouette also quietly redrew a sibling character standing
// next to her (different face, different outfit), even though the sibling
// was already fully rendered in the source scene. Diffs before/after and
// retries if any OTHER character changed. Applies to every fill-in.
function buildPreserveJudgeSystemPrompt(): string {
  return (
    `You are a compositing-fidelity judge for a children's book illustration pipeline. You compare a "before" scene image (with one blank white silhouette placeholder) against an "after" image where only that silhouette should have been filled in.\n` +
    `This is a full image regeneration, not a pixel-perfect edit, so minor rendering variance in other characters (slightly different lighting, a subtly different pose, small proportion drift) is normal and NOT a violation. Only flag a clear case where another character's face, hairstyle, or outfit was substantively redrawn into someone recognizably different from the before image.`
  );
}

async function judgeScenePreserved(
  approvedSceneUrl: string,
  resultBuffer: Buffer
): Promise<{ isPreserved: boolean; reason: string }> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildPreserveJudgeSystemPrompt(),
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [
    await urlToInlineData(approvedSceneUrl),
    `BEFORE image above: the approved scene, with exactly one blank white silhouette (the hero placeholder) and every other character/element already finished.`,
    { inlineData: { data: resultBuffer.toString("base64"), mimeType: "image/webp" } },
    `AFTER image above: the same scene with the silhouette filled in. The former silhouette is expected to change -- that's the fill-in. Every OTHER character should still be recognizably the same person in the same outfit; small rendering variance between generations (lighting, pose, minor proportions) is normal and not a violation.\n\n` +
      `Compare every OTHER character in the scene (not the one that was a blank silhouette) between the two images. Is any of them now a clearly DIFFERENT, recognizably different person, or wearing a substantively different outfit -- not just minor rendering variance?\n\n` +
      `Respond in EXACTLY this format, nothing else:\n` +
      `VERDICT: PRESERVED or CHANGED\n` +
      `REASON: <one short sentence>`,
  ];

  const result = await model.generateContent(parts);
  const text = result.response.text().trim();
  const isPreserved = /VERDICT:\s*PRESERVED/i.test(text) && !/VERDICT:\s*CHANGED/i.test(text);
  const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? text;
  return { isPreserved, reason };
}

// Mirrors apps/studio's judgeSingleHero -- the fill-in prompt only describes
// ONE blank silhouette to replace, but a generative fill can still
// hallucinate a second copy of the hero elsewhere in the scene. This is the
// general case of the duplication failure (judgeTextZoneClear below only
// catches it in the spread-layout text half specifically).
function buildSingleHeroJudgeSystemPrompt(): string {
  return (
    `You are a duplication judge for a children's book illustration pipeline. You check whether the same specific child (matched against an identity reference) appears more than once as a distinct, separate figure in a single rendered scene.\n` +
    `Only flag a genuine second appearance of the hero as their own separate figure elsewhere in the frame. Do not flag the hero's one correct appearance, or another character who merely shares similar coloring or build.`
  );
}

async function judgeSingleHero(
  characterImageUrl: string,
  resultBuffer: Buffer
): Promise<{ isSingle: boolean; reason: string }> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildSingleHeroJudgeSystemPrompt(),
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [
    await urlToInlineData(characterImageUrl, "image/png"),
    "IDENTITY REFERENCE above: a specific child -- the hero.",
    { inlineData: { data: resultBuffer.toString("base64"), mimeType: "image/webp" } },
    `RENDERED IMAGE above: a generated illustration that may contain several characters. Find every character in the image who matches the identity reference (the hero) -- same face shape, hairstyle, and skin tone.\n\n` +
      `How many times does the hero appear in this image AS A SEPARATE, DISTINCT FIGURE? A correct scene has the hero exactly ONCE. Only answer DUPLICATE if you can point to two clearly separate instances of the hero's full figure in the frame -- not one correct hero plus an incidental similarity in another character.\n\n` +
      `Respond in EXACTLY this format, nothing else:\n` +
      `VERDICT: SINGLE or DUPLICATE\n` +
      `REASON: <one short sentence>`,
  ];

  const result = await model.generateContent(parts);
  const text = result.response.text().trim();
  const isSingle = /VERDICT:\s*SINGLE/i.test(text) && !/VERDICT:\s*DUPLICATE/i.test(text);
  const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? text;
  return { isSingle, reason };
}

// Mirrors apps/studio's judgeTextZoneClear/spreadSceneDir exactly -- spread
// layouts crop ONE shared wide image in half at render time (one half
// becomes the scene, the other becomes the text panel), and the identity
// fill-in step can hallucinate a second copy of the hero standing in what
// should be the empty text half even when the source template is clean.
// Reuses the same vision+text-only call pattern as judgeIdentityMatch (no
// image OUTPUT tokens -- a judge call runs roughly 0.5% of the cost of one
// actual image generation).
function buildZoneJudgeSystemPrompt(): string {
  return (
    `You are a layout-violation judge for a children's book illustration pipeline. You check whether any part of a person has bled into a zone of the image that must stay empty of characters, since text will be composited there later.\n` +
    `Flag a real intrusion -- a clearly visible face, hand, limb, or substantial piece of clothing or hair inside the forbidden zone. Don't flag faint motion blur, a soft shadow, or background scenery (trees, buildings, sky) extending into the zone -- only people count.`
  );
}

async function judgeTextZoneClear(
  resultBuffer: Buffer,
  sceneDir: "left" | "right"
): Promise<{ isClear: boolean; reason: string }> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildZoneJudgeSystemPrompt(),
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });

  const forbiddenHalf = sceneDir === "left" ? "RIGHT half" : "LEFT half";
  const parts: Parameters<typeof model.generateContent>[0] = [
    { inlineData: { data: resultBuffer.toString("base64"), mimeType: "image/webp" } },
    `This is a single wide illustration split into two halves by an imaginary vertical line down the middle. All characters belong in the ${sceneDir.toUpperCase()} half. The ${forbiddenHalf} of the image is reserved for text that gets composited on top later, and should be free of people -- a clearly visible face, hand, limb, or substantial piece of clothing or hair crossing into it is a violation; background scenery is fine.\n\n` +
    `Look specifically at the ${forbiddenHalf} of the image (everything to the ${sceneDir === "left" ? "right" : "left"} of the vertical midline). Is there a clearly visible part of a person there?\n\n` +
    `Respond in EXACTLY this format, nothing else:\n` +
    `VERDICT: CLEAR or VIOLATION\n` +
    `REASON: <one short sentence>`,
  ];

  const result = await model.generateContent(parts);
  const text = result.response.text().trim();
  const isClear = /VERDICT:\s*CLEAR/i.test(text) && !/VERDICT:\s*VIOLATION/i.test(text);
  const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? text;
  return { isClear, reason };
}

function spreadSceneDir(layoutType: string | null | undefined): "left" | "right" | null {
  if (layoutType === "spread_left" || layoutType === "spread_left_clean") return "left";
  if (layoutType === "spread_right" || layoutType === "spread_right_clean") return "right";
  return null;
}

async function generateScene(
  supabase: ReturnType<typeof createServerClient>,
  characterImageUrl: string,
  cartoonHeadshotUrl: string | null,
  approvedSceneUrl: string,
  heroGender: "boy" | "girl",
  storagePath: string,
  sceneContext?: string,
  usingCostumedSheet?: boolean,
  // Purely for gemini_call_log attribution -- mirrors apps/studio.
  logCtx?: { orderId: string; storyId?: string; pageId?: string },
  // Set only for spread-layout story pages -- see judgeTextZoneClear's
  // comment. Covers and non-spread pages skip the extra judge call entirely.
  textZoneSceneDir?: "left" | "right",
  // Signed URL of characters.head_sheet_url -- see generateHeadSheetBuffer.
  headSheetUrl?: string | null
): Promise<{ path: string; identityVerified: boolean }> {
  // Keep every attempt so the closest likeness ships if retries run out
  // (mirrors apps/studio's pickBestCandidate).
  const candidates: { buffer: Buffer; structuralFail: boolean }[] = [];
  for (let attempt = 1; attempt <= MAX_SWAP_ATTEMPTS; attempt++) {
    const buffer = await fillInHeroIdentity(characterImageUrl, cartoonHeadshotUrl, approvedSceneUrl, heroGender, sceneContext, usingCostumedSheet, headSheetUrl);
    if (logCtx) await logGeminiCall(supabase, { callType: "order_fillin_page", storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId });
    const cand = { buffer, structuralFail: false };
    candidates.push(cand);
    const { isMatch, reason } = await judgeIdentityMatch(characterImageUrl, buffer, cartoonHeadshotUrl, headSheetUrl);
    if (logCtx) await logGeminiCall(supabase, { callType: "order_judge_page", storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId });
    if (!isMatch) {
      console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed identity judge: ${reason}`);
      continue;
    }

    if (usingCostumedSheet) {
      const { isMatch: wardrobeMatches, reason: wardrobeReason } = await judgeWardrobeMatch(characterImageUrl, buffer);
      if (logCtx) await logGeminiCall(supabase, { callType: "order_wardrobe_judge_page", storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId });
      if (!wardrobeMatches) {
        console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed wardrobe judge: ${wardrobeReason}`);
        cand.structuralFail = true;
        continue;
      }
    }

    const { isPreserved, reason: preserveReason } = await judgeScenePreserved(approvedSceneUrl, buffer);
    if (logCtx) await logGeminiCall(supabase, { callType: "order_preserve_judge_page", storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId });
    if (!isPreserved) {
      console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed scene-preservation judge: ${preserveReason}`);
      cand.structuralFail = true;
      continue;
    }

    const { isSingle, reason: dupeReason } = await judgeSingleHero(characterImageUrl, buffer);
    if (logCtx) await logGeminiCall(supabase, { callType: "order_dupe_judge_page", storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId });
    if (!isSingle) {
      console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed single-hero judge: ${dupeReason}`);
      cand.structuralFail = true;
      continue;
    }

    // Only spend the zone-check call once the cheaper checks already passed.
    if (textZoneSceneDir) {
      const { isClear, reason: zoneReason } = await judgeTextZoneClear(buffer, textZoneSceneDir);
      if (logCtx) await logGeminiCall(supabase, { callType: "order_zone_judge_page", storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId });
      if (!isClear) {
        console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed text-zone judge: ${zoneReason}`);
        cand.structuralFail = true;
        continue;
      }
    }
    const { error } = await supabase.storage.from("assets").upload(storagePath, buffer, { contentType: "image/webp", upsert: true });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return { path: storagePath, identityVerified: true };
  }

  // Exhausted retries -- ship the closest likeness among the attempts anyway
  // (don't block the pipeline) but flag it unverified so admins can see and
  // retry manually.
  const best = await pickBestCandidate(supabase, candidates, characterImageUrl, cartoonHeadshotUrl, headSheetUrl, logCtx);
  const { error } = await supabase.storage.from("assets").upload(storagePath, best, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path: storagePath, identityVerified: false };
}

// Mirrors apps/studio's pickBestCandidate / judgePairwiseLikeness: structural
// failures lose to identity-only failures; ties among the rest are broken by a
// position-swapped pairwise likeness comparison (two cheap judge calls, no
// extra image generation). A split vote goes to the later attempt.
async function pickBestCandidate(
  supabase: ReturnType<typeof createServerClient>,
  candidates: { buffer: Buffer; structuralFail: boolean }[],
  characterImageUrl: string,
  cartoonHeadshotUrl: string | null,
  headSheetUrl: string | null | undefined,
  logCtx?: { orderId: string; storyId?: string; pageId?: string }
): Promise<Buffer> {
  const clean = candidates.filter((c) => !c.structuralFail);
  const pool = clean.length > 0 ? clean : candidates;
  let best = pool[0].buffer;
  for (let i = 1; i < pool.length; i++) {
    try {
      const winner = await judgePairwiseLikeness(characterImageUrl, best, pool[i].buffer, cartoonHeadshotUrl, headSheetUrl);
      if (logCtx) {
        for (let n = 0; n < 2; n++) await logGeminiCall(supabase, { callType: "order_rank_judge_page", storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId });
      }
      best = winner === "first" ? best : pool[i].buffer;
    } catch (err) {
      console.warn("[order-scene] pairwise ranking failed, keeping the later attempt:", err);
      best = pool[i].buffer;
    }
  }
  return best;
}

async function judgePairwiseLikeness(
  characterImageUrl: string,
  first: Buffer,
  second: Buffer,
  cartoonHeadshotUrl?: string | null,
  headSheetUrl?: string | null
): Promise<"first" | "second"> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });
  const refs: Parameters<typeof model.generateContent>[0] = [];
  if (cartoonHeadshotUrl) refs.push(await urlToInlineData(cartoonHeadshotUrl, "image/png"), "REFERENCE: portrait of the child.");
  if (headSheetUrl) refs.push(await urlToInlineData(headSheetUrl, "image/png"), "REFERENCE: head views of the same child.");
  if (refs.length === 0) refs.push(await urlToInlineData(characterImageUrl, "image/png"), "REFERENCE: identity sheet of the child.");
  const ask = async (x: Buffer, y: Buffer): Promise<"A" | "B" | null> => {
    const result = await model.generateContent([
      ...refs,
      { inlineData: { data: x.toString("base64"), mimeType: "image/webp" } }, "IMAGE A.",
      { inlineData: { data: y.toString("base64"), mimeType: "image/webp" } }, "IMAGE B.",
      "Both images are generated illustrations meant to depict this exact child, who is the main character that was filled into the scene (usually the most central child). Which one shows the closer likeness to the references (face shape, eyes, nose, mouth, skin tone, hair)? Ignore pose, expression, clothing, head angle and rendering style. Pick one even if close. Answer ONLY: A or B",
    ]);
    const t = result.response.text().trim().toUpperCase();
    return t.startsWith("A") ? "A" : t.startsWith("B") ? "B" : null;
  };
  const [r1, r2] = await Promise.all([ask(first, second), ask(second, first)]);
  const firstVotes = (r1 === "A" ? 1 : 0) + (r2 === "B" ? 1 : 0);
  const secondVotes = (r1 === "B" ? 1 : 0) + (r2 === "A" ? 1 : 0);
  return firstVotes > secondVotes ? "first" : "second";
}

// Mirrors apps/studio's getOrCreateHeadSheet: generates (or reuses) the
// character's head turnaround, cached on characters.head_sheet_url so it runs
// once per character. cartoonize creates it in the background; characters
// that predate it (or whose background run failed) get one lazily here.
// Non-fatal: any failure returns null and generation proceeds without it. A
// missing column (migration not applied yet) is also "skip" -- never
// generate blind, since the result couldn't be cached and would be re-billed
// on every call.
async function getOrCreateHeadSheet(
  supabase: ReturnType<typeof createServerClient>,
  orderId: string
): Promise<string | null> {
  try {
    const { data: order } = await supabase.from("orders").select("character_id").eq("id", orderId).single();
    if (!order?.character_id) return null;
    const { data: ch, error } = await supabase
      .from("characters")
      .select("head_sheet_url, cartoon_image_url")
      .eq("id", order.character_id)
      .single();
    if (error || !ch) return null;
    if (ch.head_sheet_url) return ch.head_sheet_url;
    if (!ch.cartoon_image_url) return null;

    const portraitUrl = await signAsset(supabase, ch.cartoon_image_url);
    const MAX_SAFETY_ATTEMPTS = 3;
    let buffer: Buffer | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_SAFETY_ATTEMPTS; attempt++) {
      try {
        buffer = await generateHeadSheetBuffer(portraitUrl);
        break;
      } catch (err) {
        lastError = err;
        const isSafetyBlock = err instanceof GeminiNoImageError && err.finishReason === "IMAGE_SAFETY";
        if (!isSafetyBlock || attempt === MAX_SAFETY_ATTEMPTS) break;
      }
    }
    if (!buffer) throw lastError;
    await logGeminiCall(supabase, { callType: "character_head_sheet", orderId });
    const path = `characters/${order.character_id}/head-sheet-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage.from("assets").upload(path, buffer, { contentType: "image/png", upsert: true });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
    await supabase.from("characters").update({ head_sheet_url: path }).eq("id", order.character_id);
    return path;
  } catch (err) {
    console.error("[order/head-sheet] head sheet unavailable, continuing without it:", err);
    return null;
  }
}

// Generates (or reuses) a costumed variant of the character's identity sheet
// for this order -- mirrors apps/studio's getOrCreateCostumedSheet. Cached on
// orders.costumed_sheet_url so it only runs once per order. Returns null
// (caller falls back to the neutral sheet) when no costume is configured for
// this gender, or if generation can't produce a face-faithful result.
async function getOrCreateCostumedSheet(
  supabase: ReturnType<typeof createServerClient>,
  orderId: string,
  existingCostumedSheetPath: string | null,
  neutralSheetPath: string,
  costumeDescription: string | null | undefined,
  heroGender: "boy" | "girl",
  // character.cartoon_image_url -- see fillInHeroIdentity's comment on the
  // ORIGINAL PORTRAIT reference. Keeps the costume edit from quietly
  // drifting the face along with the clothing.
  groundTruthPortraitPath?: string | null
): Promise<string | null> {
  if (existingCostumedSheetPath) return existingCostumedSheetPath;
  if (!costumeDescription?.trim()) return null;

  try {
    const [neutralSheetUrl, groundTruthPortraitUrl] = await Promise.all([
      signAsset(supabase, neutralSheetPath),
      groundTruthPortraitPath ? signAsset(supabase, groundTruthPortraitPath) : Promise.resolve(null),
    ]);
    let lastBuffer: Buffer | null = null;
    for (let attempt = 1; attempt <= COSTUME_SHEET_ATTEMPTS; attempt++) {
      const buffer = await generateCostumedSheetBuffer(neutralSheetUrl, costumeDescription, heroGender, groundTruthPortraitUrl);
      await logGeminiCall(supabase, { callType: "costumed_sheet_generate", orderId });
      lastBuffer = buffer;
      const { isMatch, reason } = await judgeIdentityMatch(neutralSheetUrl, buffer, groundTruthPortraitUrl);
      await logGeminiCall(supabase, { callType: "costumed_sheet_judge", orderId });
      if (isMatch) {
        const path = `order-sheets/${orderId}/costumed-sheet-${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage.from("assets").upload(path, buffer, { contentType: "image/png", upsert: true });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
        await supabase.from("orders").update({ costumed_sheet_url: path }).eq("id", orderId);
        return path;
      }
      console.warn(`[order/costume] attempt ${attempt}/${COSTUME_SHEET_ATTEMPTS} failed identity judge: ${reason}`);
    }
    console.warn(`[order/costume] Costumed sheet identity check failed after ${COSTUME_SHEET_ATTEMPTS} attempts — order ${orderId}, falling back to neutral sheet`);
    void lastBuffer;
    return null;
  } catch (err) {
    console.error("[order/costume] Costumed sheet generation failed:", err);
    return null;
  }
}

export async function getPreviewPages(orderId: string) {
  const supabase = createServerClient();

  const { data: pages } = await supabase
    .from("order_pages")
    .select("page_number, image_url, generation_status")
    .eq("order_id", orderId)
    .order("page_number", { ascending: true });

  const paths = (pages ?? []).map((p) => p.image_url).filter((p): p is string => !!p);
  const signedMap = await signAssets(supabase, paths);

  return (pages ?? []).map((p) => ({
    ...p,
    image_url: p.image_url ? (signedMap[p.image_url] ?? p.image_url) : null,
  }));
}

export async function startPreviewGeneration(orderId: string): Promise<{ totalPages: number; templateUrls: string[]; texts: string[]; textBgUrls: (string | null)[] }> {
  const supabase = createServerClient();

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, hero_name, gender, story_id, character_id")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) throw new Error("Order not found");

  const { data: character } = await supabase
    .from("characters")
    .select("cartoon_image_url, sheet_url")
    .eq("id", order.character_id)
    .single();

  if (!character) throw new Error("Character not found");

  const characterImagePath = character.sheet_url ?? character.cartoon_image_url;
  if (!characterImagePath) throw new Error("Character image not ready");

  // Prefer pages marked as preview-eligible; fall back to first pages with images
  const { data: previewPages } = await supabase
    .from("story_pages")
    .select("page_number, image_url, text, text_bg_url")
    .eq("story_id", order.story_id)
    .eq("preview_eligible", true)
    .not("image_url", "is", null)
    .order("page_number", { ascending: true })
    .limit(PREVIEW_PAGE_COUNT);

  let storyPages = previewPages ?? [];

  if (!storyPages.length) {
    const { data: fallbackPages } = await supabase
      .from("story_pages")
      .select("page_number, image_url, text, text_bg_url")
      .eq("story_id", order.story_id)
      .not("image_url", "is", null)
      .order("page_number", { ascending: true })
      .limit(PREVIEW_PAGE_COUNT);
    storyPages = fallbackPages ?? [];
  }

  if (!storyPages.length) {
    throw new Error("No pages available for preview — scene images haven't been generated yet.");
  }

  // Delete existing order_pages for this order (in case of retry)
  await supabase.from("order_pages").delete().eq("order_id", orderId);

  // Insert placeholder rows
  await supabase.from("order_pages").insert(
    storyPages.map((p) => ({
      order_id: orderId,
      page_number: p.page_number,
      scene_prompt: "",
      hero_name: order.hero_name,
      generation_status: "processing" as const,
      image_url: null,
      upscaled_image_url: null,
      text_image_url: null,
      replicate_job_id: null,
      upscale_job_id: null,
      error_message: null,
      identity_verified: null,
    }))
  );

  const templatePaths = storyPages.map((p) => p.image_url!);
  const textBgPaths = storyPages.map((p) => p.text_bg_url).filter((p): p is string => !!p);
  const signedMap = await signAssets(supabase, [...templatePaths, ...textBgPaths]);
  const templateUrls = templatePaths.map((path) => signedMap[path] ?? path);
  const previewGender: "boy" | "girl" = order.gender === "girl" ? "girl" : "boy";
  const texts = storyPages.map((p) => personalizeText(p.text, order.hero_name, previewGender));
  const textBgUrls = storyPages.map((p) => (p.text_bg_url ? (signedMap[p.text_bg_url] ?? p.text_bg_url) : null));

  return { totalPages: storyPages.length, templateUrls, texts, textBgUrls };
}

export async function generatePreviewPage(orderId: string, pageIndex: number): Promise<{ imageUrl: string; pageNumber: number }> {
  const supabase = createServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, hero_name, gender, story_id, character_id, child_age, costumed_sheet_url")
    .eq("id", orderId)
    .single();

  if (!order) throw new Error("Order not found");

  const { data: character } = await supabase
    .from("characters")
    .select("cartoon_image_url, sheet_url")
    .eq("id", order.character_id)
    .single();

  if (!character?.sheet_url && !character?.cartoon_image_url) {
    throw new Error("Character image not ready");
  }

  const { data: story } = await supabase
    .from("stories")
    .select("hero_costume_description_boy, hero_costume_description_girl, layout_type")
    .eq("id", order.story_id)
    .single();

  const heroGender = order.gender === "girl" ? "girl" : "boy";
  const ageBand = ageToBand(order.child_age);

  const costumeDescription = heroGender === "girl"
    ? story?.hero_costume_description_girl
    : story?.hero_costume_description_boy;
  const costumedSheetPath = character.sheet_url
    ? await getOrCreateCostumedSheet(supabase, orderId, order.costumed_sheet_url, character.sheet_url, costumeDescription, heroGender, character.cartoon_image_url)
    : null;

  const { data: previewEligible } = await supabase
    .from("story_pages")
    .select("id, page_number, image_url, scene_prompt")
    .eq("story_id", order.story_id)
    .eq("preview_eligible", true)
    .not("image_url", "is", null)
    .order("page_number", { ascending: true })
    .limit(PREVIEW_PAGE_COUNT);

  let storyPages = previewEligible ?? [];

  if (!storyPages.length) {
    const { data: fallback } = await supabase
      .from("story_pages")
      .select("id, page_number, image_url, scene_prompt")
      .eq("story_id", order.story_id)
      .not("image_url", "is", null)
      .order("page_number", { ascending: true })
      .limit(PREVIEW_PAGE_COUNT);
    storyPages = fallback ?? [];
  }

  if (!storyPages.length || pageIndex >= storyPages.length) throw new Error("Page not found");

  const page = storyPages[pageIndex];
  if (!page.image_url) throw new Error(`Page ${page.page_number} has no approved scene`);

  const { data: orderPage } = await supabase
    .from("order_pages")
    .select("id")
    .eq("order_id", orderId)
    .eq("page_number", page.page_number)
    .single();

  if (!orderPage) throw new Error("Order page record not found");

  try {
    const { data: pageVariant } = await supabase
      .from("story_page_age_variants")
      .select("image_url")
      .eq("page_id", page.id)
      .eq("age_band", ageBand)
      .maybeSingle();
    const scenePath = pageVariant?.image_url ?? page.image_url;

    // Sign all input paths before passing to AI. The costumed sheet (when
    // available) replaces the primary identity reference only -- the raw
    // cartoon headshot below stays untouched, showing the child's actual
    // photographed outfit as a secondary reference.
    const charPath = costumedSheetPath ?? character.sheet_url ?? character.cartoon_image_url!;
    const headPath = character.cartoon_image_url ?? null;
    // Head turnaround: cartoonize generates it in the background; this
    // covers characters that predate it or whose background run failed.
    const headSheetPath = await getOrCreateHeadSheet(supabase, orderId);
    const pathsToSign = [charPath, scenePath, ...(headPath && headPath !== charPath ? [headPath] : []), ...(headSheetPath ? [headSheetPath] : [])];
    const signedInputs = await signAssets(supabase, pathsToSign);

    const sceneContext = page.scene_prompt?.trim()
      ? personalizeSceneContext(page.scene_prompt, heroGender)
      : undefined;

    const { path: imagePath, identityVerified } = await generateScene(
      supabase,
      signedInputs[charPath],
      headPath ? (signedInputs[headPath] ?? null) : null,
      signedInputs[scenePath],
      heroGender,
      `order-pages/${orderPage.id}/preview-${Date.now()}.webp`,
      sceneContext,
      !!costumedSheetPath,
      { orderId, storyId: order.story_id, pageId: page.id },
      spreadSceneDir(story?.layout_type) ?? undefined,
      headSheetPath ? (signedInputs[headSheetPath] ?? null) : null,
    );

    const imageUrl = await signAsset(supabase, imagePath);

    await supabase.from("order_pages").update({
      image_url: imagePath,
      generation_status: "done",
      identity_verified: identityVerified,
    }).eq("id", orderPage.id);

    trackServer("preview_generated", {
      orderId,
      properties: { page_number: page.page_number, used_sheet: !!character.sheet_url },
    });

    return { imageUrl, pageNumber: page.page_number };
  } catch (err) {
    await supabase.from("order_pages").update({
      generation_status: "failed",
      error_message: (err as Error).message,
    }).eq("id", orderPage.id);
    throw err;
  }
}

// Fetches a Google Font's TTF bytes directly (no disk cache -- this runs
// once per PDF export, not per render). Mirrors apps/studio's
// lib/composite.ts fetchFontPath, adapted to return bytes instead of a file
// path since pdf-lib/fontkit embeds directly from a buffer.
async function fetchGoogleFontBytes(cssFamily: string): Promise<Uint8Array | null> {
  const googleFontName = getGoogleFontName(cssFamily);
  if (!googleFontName) return null;
  try {
    // googleFontName is one of FONT_OPTIONS' hardcoded values (e.g.
    // "Amatic+SC:wght@700"), already in the literal syntax Google's CSS2 API
    // requires -- its '+' (space) and ':'/'@' (weight axis) are the query
    // format itself, not characters to URL-escape. encodeURIComponent()'ing
    // the whole string turns them into %2B/%3A/%40, which Google can't parse
    // -- it silently returns a bot-check HTML page instead of CSS, so every
    // multi-word font (Amatic SC, Baloo 2, Playfair Display, EB Garamond)
    // falls back to Helvetica. Confirmed live against the real API.
    const cssRes = await fetch(
      `https://fonts.googleapis.com/css2?family=${googleFontName}&display=swap`,
      { headers: { "User-Agent": "Mozilla/4.0 (compatible)" } } // old UA -> legacy TTF src, not WOFF2
    );
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    return new Uint8Array(await fontRes.arrayBuffer());
  } catch {
    return null;
  }
}

function isSpreadLayoutType(layoutType: LayoutType): boolean {
  return layoutType === "spread_left" || layoutType === "spread_right" || layoutType === "spread_left_clean" || layoutType === "spread_right_clean";
}

function isSplitLayoutType(layoutType: LayoutType): boolean {
  return layoutType === "split_image_left" || layoutType === "split_image_right";
}

// Word-wraps text to fit maxWidth at the given font/size, preserving explicit
// newlines. pdf-lib has no built-in text layout -- this mirrors the plain
// greedy wrap used everywhere else text gets laid out server-side (e.g.
// apps/studio's lib/layout.ts wrapWords), just measured with the real font.
function wrapPdfText(text: string, font: import("pdf-lib").PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) current = candidate;
      else { lines.push(current); current = word; }
    }
    lines.push(current);
  }
  return lines;
}

// Draws text centered vertically within box, wrapped to box.width, aligned
// per textStyle.alignment. pdf-lib's origin is bottom-left with y increasing
// upward (the opposite of the CSS/cqh math used everywhere else in this
// codebase), so box.y is the box's BOTTOM edge.
function drawWrappedPdfText(
  page: import("pdf-lib").PDFPage,
  text: string,
  font: import("pdf-lib").PDFFont,
  fontSize: number,
  color: ReturnType<typeof import("pdf-lib").rgb>,
  box: { x: number; y: number; width: number; height: number },
  alignment: "left" | "center" | "right"
) {
  const lineHeight = fontSize * 1.35;
  const lines = wrapPdfText(text, font, fontSize, box.width);
  const totalHeight = lines.length * lineHeight;
  let y = box.y + box.height / 2 + totalHeight / 2 - fontSize;
  for (const line of lines) {
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    const x = alignment === "left" ? box.x
      : alignment === "right" ? box.x + box.width - lineWidth
      : box.x + (box.width - lineWidth) / 2;
    page.drawText(line, { x, y, size: fontSize, font, color });
    y -= lineHeight;
  }
}

function hexToPdfColor(hex: string, rgb: typeof import("pdf-lib").rgb) {
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

// Background fill for a split-layout text-only page. Only solid/gradient
// translate cleanly to a flat pdf-lib rect fill -- pattern and scene_bleed
// (which need real raster compositing, unavailable here with no sharp/canvas
// in this app) fall back to a plain page-matched neutral, a reasonable
// simplification for this quick downloadable preview (not the real print PDF).
function panelBgPdfColor(bg: TextPanelBg, rgb: typeof import("pdf-lib").rgb) {
  if (bg.type === "solid") return hexToPdfColor(bg.color, rgb);
  if (bg.type === "gradient") return hexToPdfColor(bg.from, rgb);
  return rgb(0.98, 0.97, 0.94);
}

export async function exportPreviewPdf(orderId: string): Promise<string> {
  const supabase = createServerClient();
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;

  const { data: order } = await supabase.from("orders").select("hero_name, gender, story_id").eq("id", orderId).single();
  if (!order) throw new Error("Order not found");
  const exportGender: "boy" | "girl" = order.gender === "girl" ? "girl" : "boy";

  const { data: story } = await supabase.from("stories").select("layout_type, text_style, text_panel_bg").eq("id", order.story_id).single();
  const layoutType: LayoutType = story?.layout_type ?? "overlay_bottom";
  const textStyle: TextStyle = { ...DEFAULT_TEXT_STYLE, ...(story?.text_style ?? {}) };
  const textPanelBg: TextPanelBg = story?.text_panel_bg ?? DEFAULT_TEXT_PANEL_BG;

  const { data: pages } = await supabase
    .from("order_pages")
    .select("page_number, image_url")
    .eq("order_id", orderId)
    .eq("generation_status", "done")
    .order("page_number", { ascending: true });

  if (!pages?.length) throw new Error("No preview pages to export");

  const pageNumbers = pages.map((p) => p.page_number);
  const { data: storyPages } = await supabase
    .from("story_pages")
    .select("page_number, text")
    .eq("story_id", order.story_id)
    .in("page_number", pageNumbers);
  const textByNum = Object.fromEntries(
    (storyPages ?? []).map((p) => [p.page_number, personalizeText(p.text, order.hero_name, exportGender)])
  );

  const imagePaths = pages.map((p) => p.image_url).filter((p): p is string => !!p);
  const signedMap = await signAssets(supabase, imagePaths);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  // liga/calt/clig/dlig/rlig/ccmp disabled: fontkit's shaping of certain
  // Google variable fonts (confirmed with Fredoka) mangles specific letter
  // pairs -- e.g. "brilliant" rendered as "brill iant", "alleys" as
  // "all eys" -- when contextual substitution/ligature features are left on.
  // Turning them off renders each character as its own glyph, which is a
  // fine tradeoff for this quick preview PDF (not the real print pipeline).
  const fontBytes = await fetchGoogleFontBytes(textStyle.fontFamily);
  const font = fontBytes
    ? await pdf.embedFont(fontBytes, { features: { liga: false, calt: false, clig: false, dlig: false, rlig: false, ccmp: false } })
    : await pdf.embedFont(StandardFonts.Helvetica);
  const textColor = hexToPdfColor(textStyle.color, rgb);

  const spread = isSpreadLayoutType(layoutType);
  const split = isSplitLayoutType(layoutType);

  for (const p of pages) {
    if (!p.image_url) continue;
    const signedUrl = signedMap[p.image_url];
    if (!signedUrl) continue;
    const res = await fetch(signedUrl);
    const imgBytes = new Uint8Array(await res.arrayBuffer());
    const image = p.image_url.endsWith(".png") ? await pdf.embedPng(imgBytes) : await pdf.embedJpg(imgBytes);

    const aspectRatio = image.width / image.height;
    const pageWidth = 842;
    const pageHeight = pageWidth / aspectRatio;
    const text = textByNum[p.page_number] ?? "";

    if (split) {
      // Text lives on a genuinely separate page in print (no shared source
      // image) -- pdf pages are naturally paginated, so this is actually
      // more print-accurate here than the single-card storefront preview.
      // Build pages in the right order directly (split_image_left = image
      // then text; split_image_right = reverse) rather than adding then
      // reordering, which pdf-lib doesn't support cleanly mid-document.
      const fontSize = pageHeight * (textStyle.fontSizePct / 100);
      const drawImagePage = () => {
        const pg = pdf.addPage([pageWidth, pageHeight]);
        pg.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      };
      const drawTextPage = () => {
        const pg = pdf.addPage([pageWidth, pageHeight]);
        pg.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: panelBgPdfColor(textPanelBg, rgb) });
        drawWrappedPdfText(pg, text, font, fontSize, textColor,
          { x: pageWidth * 0.1, y: pageHeight * 0.1, width: pageWidth * 0.8, height: pageHeight * 0.8 },
          textStyle.alignment);
      };
      if (layoutType === "split_image_left") { drawImagePage(); drawTextPage(); }
      else { drawTextPage(); drawImagePage(); }
    } else {
      const pdfPage = pdf.addPage([pageWidth, pageHeight]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      if (!text) continue;

      const fontSize = pageHeight * (textStyle.fontSizePct / 100);

      if (spread) {
        // Text overlays the non-hero half (mirrors PreviewGenerator's spreadTextSide).
        const textOnLeft = layoutType === "spread_right" || layoutType === "spread_right_clean";
        const pad = pageWidth * 0.04;
        const halfX = textOnLeft ? 0 : pageWidth / 2;
        if (textStyle.textBoxBg !== "none") {
          pdfPage.drawRectangle({ x: halfX + pad * 0.5, y: pageHeight * 0.15, width: pageWidth / 2 - pad, height: pageHeight * 0.7, color: rgb(1, 1, 1), opacity: 0.55 });
        }
        drawWrappedPdfText(pdfPage, text, font, fontSize, textColor,
          { x: halfX + pad, y: pageHeight * 0.15, width: pageWidth / 2 - pad * 2, height: pageHeight * 0.7 },
          textStyle.alignment);
      } else {
        // overlay_bottom: percentages mirror apps/studio's composite.ts
        // buildSvgOverlay() math exactly (25% panel height, 4% bottom margin,
        // 3% horizontal padding, 6% vertical padding of the panel itself).
        const bandHeight = pageHeight * 0.25;
        const bandBottom = pageHeight * 0.04;
        const [br, bg, bb] = [textStyle.bgColor.slice(1, 3), textStyle.bgColor.slice(3, 5), textStyle.bgColor.slice(5, 7)].map((h) => parseInt(h, 16) / 255);
        pdfPage.drawRectangle({ x: 0, y: bandBottom, width: pageWidth, height: bandHeight, color: rgb(br, bg, bb), opacity: textStyle.bgOpacity });
        const vPad = bandHeight * 0.06;
        drawWrappedPdfText(pdfPage, text, font, fontSize, textColor,
          { x: pageWidth * 0.03, y: bandBottom + vPad, width: pageWidth * 0.94, height: bandHeight - vPad * 2 },
          textStyle.alignment);
      }
    }
  }

  const pdfBytes = await pdf.save();
  const storagePath = `preview-pdfs/${orderId}/preview-${Date.now()}.pdf`;
  const { error } = await supabase.storage
    .from("assets")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  return signAsset(supabase, storagePath);
}
