"use server";

import { createServerClient } from "@/lib/supabase/server";
import { signAsset, signAssets, resolveStoragePath } from "@/lib/supabase/assets";
import { revalidatePath } from "next/cache";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "@/lib/supabase/types";
import { compositeTextOntoImage, resolveFontPath } from "@/lib/composite";
import { getGemini, NANO_BANANA_2_MODEL, urlToInlineData, extractImageBuffer, generateCostumedSheetBuffer, generateHeadSheetBuffer, GeminiNoImageError } from "@/lib/gemini";
import { logGeminiCall } from "@/lib/geminiLog";
import sharp from "sharp";

// ── Text personalization ──────────────────────────────────────────────────────

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

// ── Age-band selection ────────────────────────────────────────────────────────
// Maps the order's child_age (1-12, collected on the storefront order form)
// to the matching template band -- see AGE_BAND_DESCRIPTIONS in
// @/lib/heroSilhouette for what each band actually looks like. Falls back to
// the "5-8" mid-band for legacy orders with no child_age recorded.

type AgeBand = "1-4" | "5-8" | "9-12";

function ageToBand(age: number | null | undefined): AgeBand {
  const a = age ?? 6;
  if (a <= 4) return "1-4";
  if (a <= 8) return "5-8";
  return "9-12";
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function uploadBufferToStorage(
  supabase: ReturnType<typeof createServerClient>,
  buffer: Buffer,
  storagePath: string,
  contentType = "image/webp"
): Promise<string> {
  const { error } = await supabase.storage
    .from("assets")
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

// ── Scene generation via Nano Banana Pro ─────────────────────────────────────
//
// The template's hero is a blank white silhouette (see HERO_SILHOUETTE_INSTRUCTION,
// baked in at template-generation time -- generateSpreadScene/generateSinglePageScene/
// generateCoverSwapTemplate). This step is a pure fill-in: there is no other
// character in the scene that could be confused for the hero, since nothing
// else is a flat white shape -- unlike the old "find and replace the right
// child among several" approach, there's no identification problem left to
// solve, only a likeness-fidelity one.
//
// Likeness fidelity is still a real, separate problem (any generative fill
// call has some chance of not looking enough like the reference), so every
// fill is checked by a second Gemini call (judgeIdentityMatch) and retried
// up to MAX_SWAP_ATTEMPTS times before falling back to best-effort -- both
// validated this session: the tightened fill-in prompt raised the hit rate
// from ~2/3 to ~3/3 in testing, and the judge-and-retry loop closed the rest
// of the gap across 4 independent end-to-end runs (100% eventual success,
// half needing exactly one retry).
//
// One retry (2 attempts). History: 3 -> 2 for cost, back to 3 when customer
// feedback called identity unacceptable, now 2 again because fill-ins moved
// to 4K (~$0.15 each vs ~$0.07), which more than doubled what a retry costs.
// Identity quality is now carried by better references (portrait + head
// turnaround) rather than by re-rolling, and a page that exhausts its retry
// is kept and flagged "Unverified identity", where the cheap "Re-verify
// identity" admin action re-checks it without paying for a new generation.
const MAX_SWAP_ATTEMPTS = 2;

// Fill-ins (pages + covers) are generated at 4K. Gelato's recommended print
// resolution is 300 DPI; a full spread needs ~4866px across, and the model's
// default 1K output (1440x720) is only ~90 DPI stretched to fit. At 4K a
// spread is 5760x2880 (~355 DPI). Cost: 2520 image-output tokens vs 1120 at
// 1K (~$0.15 vs ~$0.07 per fill-in). No aspectRatio is set on purpose --
// output follows the template's own aspect ratio.
const FILL_IN_IMAGE_SIZE = "4K";

// A 4K fill-in is a ~10MB JPEG, and Gemini caps inline request data at 20MB
// total -- the judges (which send the result alongside other reference
// images) would blow it, and they don't need print resolution anyway.
async function downscaleForJudge(buf: Buffer): Promise<Buffer> {
  return sharp(buf).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}
const COSTUME_SHEET_ATTEMPTS = 2;

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
  characterSheetUrl: string,
  approvedSceneUrl: string,
  heroGender: "boy" | "girl",
  // Cover generation only: swap one literal piece of rendered text (the
  // "{{hero_name}}" placeholder baked into the template art by
  // buildCoverPrompt) for the real child's name, in addition to the
  // identity fill-in below. Every other call site leaves this unset.
  textSwap?: { placeholder: string; replacement: string },
  // The page's scene_prompt (pronoun-normalized), passed through so the fill
  // has some textual signal for the hero's expression/mood. Without this the
  // blank silhouette carries zero facial information, and the only cue Gemini
  // has for how the hero should look is whatever it can visually infer from
  // the rest of the already-rendered scene -- unreliable in busier scenes.
  // Covers have no stored prompt text (buildCoverPrompt's result isn't
  // persisted), so cover calls leave this unset.
  sceneContext?: string,
  // True when characterSheetUrl is already a costumed identity sheet (see
  // getOrCreateCostumedSheet) -- the outfit is then part of the reference
  // image itself, so the fill-in should reproduce it like any other likeness
  // detail rather than improvising clothing. False/unset falls back to the
  // generic clothing line (no costume configured for this story/gender, or
  // costumed-sheet generation failed).
  usingCostumedSheet?: boolean,
  // The cartoon portrait the character sheet was itself generated from --
  // the closest thing to ground truth still available (the raw uploaded
  // photo is never persisted, by design, for privacy). The sheet is already
  // one AI-generation hop from that portrait, and a costumed sheet is two;
  // every page fill-in that only looks at the sheet is trusting however much
  // drift already happened upstream, with no way to catch it. Passing the
  // portrait too gives each fill-in an independent, less-removed check on
  // the face instead of compounding whatever the sheet already drifted.
  groundTruthPortraitUrl?: string | null,
  // Six large head views (front, 3/4, profiles, back) -- the body sheet's
  // face is only ~10% of panel height, too small to copy faithfully at any
  // angle. See generateHeadSheetBuffer.
  headSheetUrl?: string | null
): Promise<Buffer> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildFillInSystemPrompt(),
    generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { imageSize: FILL_IN_IMAGE_SIZE } } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [];

  parts.push(await urlToInlineData(characterSheetUrl, "image/png"));
  // When a head turnaround exists it is the ONLY face/hair authority. The body
  // sheet's face renders at ~10% of panel height and drifts from the portrait
  // (measured on real orders), so telling the model to also copy the face
  // from it created two conflicting face references.
  parts.push(
    headSheetUrl
      ? `BODY & OUTFIT SHEET (4 full-body panels -- FRONT, LEFT, RIGHT, BACK). Use this sheet ONLY for body proportions and build, limb skin tone${usingCostumedSheet ? ", and the exact outfit (front, side and back). WARDROBE LOCK: this sheet is the SOLE authority for every garment, garment colour, pattern/graphic, bottom, shoe, and accessory. No later reference may alter or override its clothing" : ""}. DO NOT take the face or hair from this sheet: the faces on it are tiny and unreliable and can disagree with the child's real likeness. This child's face and hair come ONLY from the portrait and the head turnaround.`
      : (
    `IDENTITY REFERENCE SHEET (study all 4 panels — FRONT, LEFT, RIGHT, BACK — before rendering anything). ` +
      `This is a specific individual child, not a generic character archetype. Note precisely, from the sheet:\n` +
      `- Face shape and proportions (viewed from front AND both side profiles)\n` +
      `- Exact hairstyle: length, part direction, texture, volume, and hair colour\n` +
      `- Eye shape, eye colour, and eyebrow shape\n` +
      `- Nose shape and mouth/lip shape\n` +
      `- Skin tone and undertone\n` +
      `- Any distinguishing features (ear shape, chin shape, cheek fullness)\n` +
      (usingCostumedSheet ? `- Exact clothing/outfit as shown in the sheet — this is the hero's defined costume for this book\n` : "") +
      `You will reproduce THIS EXACT child's face, hair${usingCostumedSheet ? ", and outfit" : ""}, not a similar-looking or generic substitute.`
      )
  );

  if (groundTruthPortraitUrl) {
    parts.push(await urlToInlineData(groundTruthPortraitUrl, "image/png"));
    parts.push(
      `ORIGINAL PORTRAIT (above): generated earlier, before the sheet, and before any costume edit -- the single most faithful likeness reference for this child's actual face available. The sheet is derived from this portrait, but each edit hop has some chance of drifting slightly. If the sheet's face ever looks even slightly different from this portrait in shape, proportions, or features, TRUST THIS PORTRAIT over the sheet for the face specifically. ${usingCostumedSheet ? "ZERO WARDROBE AUTHORITY: ignore and do not copy any shirt, dress, graphic, colour, bottom, shoe, or accessory visible in this portrait. Those belong to the source photo, not this book. The BODY & OUTFIT SHEET is the sole wardrobe authority." : "Use the sheet for the side/back angles and pose."}`
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
    `TASK: replace ONLY the blank silhouette with the exact child from ${headSheetUrl ? "the portrait and head turnaround above" : "the identity reference sheet above"} — same face shape, same hairstyle and hair colour, same eye shape/colour, same skin tone, same distinguishing features. This is a strict likeness match, not "a child who looks similar" — imagine the reference child's own parent looking at the result and immediately recognizing them, not just seeing "some kid". Keep the silhouette's existing pose, position, and scale exactly. ${usingCostumedSheet
      ? `WARDROBE LOCK: reproduce the complete outfit from the BODY & OUTFIT SHEET exactly. Match garment types, dominant colours, patterns/graphics, bottoms, shoes, and accessories. Never use, blend with, or borrow clothing from the ORIGINAL PORTRAIT or HEAD TURNAROUND. Before finalizing, compare the rendered outfit against the body sheet item by item and correct every mismatch.`
      : `Add simple clothing consistent with the rest of the scene and appropriate for a ${heroGender}, since the silhouette has none.`} ${headSheetUrl ? "Before finalizing, mentally re-check the rendered face against the closest view on the head turnaround (and the portrait) for proportions, and the hairstyle's actual 3D shape and volume at this angle." : "Before finalizing, mentally re-check the rendered face against the FRONT panel of the reference sheet for proportions, and against the LEFT/RIGHT panels for the hairstyle's actual 3D shape and volume."}` +
    (sceneContext
      ? `\n\nSCENE MOMENT (guides the hero's facial expression and body energy ONLY — never let this override the identity likeness rules above): "${sceneContext}"\n` +
        `Give the hero a facial expression and posture that authentically fits this specific moment — the kind of genuine reaction a real child would have (e.g. wonder, delight, curiosity, surprise, calm focus) — while keeping the exact face shape, features, and likeness from the identity reference sheet, and the silhouette's existing pose, position, and scale.`
      : "") +
    (textSwap
      ? `\n\nAlso replace one piece of rendered text, and ONLY this text — keep the exact same font, size, style, and position it already has in the image:\n- Replace the text "${textSwap.placeholder}" with "${textSwap.replacement}"`
      : "") +
    `\n\nPerform a strict-likeness fill-in of the blank silhouette only. Preserve every other pixel of the scene image exactly.`
  );

  const result = await model.generateContent(parts);
  return extractImageBuffer(result.response);
}

async function judgeIdentityMatch(
  characterSheetUrl: string,
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
  // Reuses the image model for text-only output -- GEMINI_TEXT_MODEL
  // ("gemini-3.1-flash") 404'd against this API key/SDK combo when tested
  // directly this session; this combo is confirmed working.
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildJudgeSystemPrompt(),
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [
    await urlToInlineData(characterSheetUrl, "image/png"),
    headSheetUrl
      ? "BODY SHEET above: full-body views of a specific child, useful for body and outfit only. Its faces are tiny and unreliable -- judge the FACE against the portrait and head turnaround below, not this sheet."
      : "IDENTITY REFERENCE SHEET above: FRONT, LEFT, RIGHT, BACK views of a specific child.",
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
    { inlineData: { data: (await downscaleForJudge(resultBuffer)).toString("base64"), mimeType: "image/jpeg" } },
    `RENDERED IMAGE above: a generated illustration, possibly containing several characters, including one claimed to be the same child as the identity reference — the hero of the scene, usually the most central/foregrounded child. Find that child and compare their face against the identity reference${multiRef ? "(s)" : ""}.\n\n` +
    `Does that child's face match the identity reference${multiRef ? "s" : " sheet"} closely enough that this child's own parent would recognize them at a glance (same face shape, hair colour, skin tone)? Minor rendering differences in exact hairstyle shape, lighting, or angle between generations don't count against a match -- only a clearly different face shape, hair colour, or skin tone does. Ignore differences in clothing, pose, expression, and art rendering angle — judge identity likeness only.\n\n` +
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

// Identity and wardrobe are intentionally judged separately. The identity
// judge ignores clothing, so without this gate a face-correct render can pass
// while silently copying the portrait's original clothes instead of the
// story's locked costume.
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
    { inlineData: { data: (await downscaleForJudge(resultBuffer)).toString("base64"), mimeType: "image/jpeg" } },
    `RENDERED SCENE above. Find the filled-in hero and compare only their visible wardrobe with the costume sheet. Allow normal pose, perspective, lighting, folds, and genuine occlusion. Reject if any visible garment type, dominant colour, pattern/graphic, bottom, footwear, or accessory conflicts with the sheet, if clothing from another reference was substituted, or if two outfits were blended. Do not judge face likeness.\n\nRespond in EXACTLY this format, nothing else:\nVERDICT: MATCH or NO_MATCH\nREASON: <one short sentence>`,
  ]);
  const text = result.response.text().trim();
  const isMatch = /VERDICT:\s*MATCH/i.test(text) && !/VERDICT:\s*NO_MATCH/i.test(text);
  const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? text;
  return { isMatch, reason };
}

// Which of two renders is the closer likeness to the reference child? Asked
// twice with the order swapped to cancel position bias; a split vote is a tie,
// reported as "second" so the later attempt wins ties (matches the old
// keep-the-last behaviour). Measured offline: picks the right child over a
// wrong one ~83% of the time, so it is a tiebreaker, not a gate.
async function judgePairwiseLikeness(
  characterSheetUrl: string,
  first: Buffer,
  second: Buffer,
  groundTruthPortraitUrl?: string | null,
  headSheetUrl?: string | null
): Promise<"first" | "second"> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });
  const refs: Parameters<typeof model.generateContent>[0] = [];
  if (groundTruthPortraitUrl) refs.push(await urlToInlineData(groundTruthPortraitUrl, "image/png"), "REFERENCE: portrait of the child.");
  if (headSheetUrl) refs.push(await urlToInlineData(headSheetUrl, "image/png"), "REFERENCE: head views of the same child.");
  if (refs.length === 0) refs.push(await urlToInlineData(characterSheetUrl, "image/png"), "REFERENCE: identity sheet of the child.");
  const toJpeg = (b: Buffer) => sharp(b).resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const [a, b] = await Promise.all([toJpeg(first), toJpeg(second)]);
  const ask = async (x: Buffer, y: Buffer): Promise<"A" | "B" | null> => {
    const result = await model.generateContent([
      ...refs,
      { inlineData: { data: x.toString("base64"), mimeType: "image/jpeg" } }, "IMAGE A.",
      { inlineData: { data: y.toString("base64"), mimeType: "image/jpeg" } }, "IMAGE B.",
      "Both images are generated illustrations meant to depict this exact child, who is the main character that was filled into the scene (usually the most central child). Which one shows the closer likeness to the references (face shape, eyes, nose, mouth, skin tone, hair)? Ignore pose, expression, clothing, head angle and rendering style. Pick one even if close. Answer ONLY: A or B",
    ]);
    const t = result.response.text().trim().toUpperCase();
    return t.startsWith("A") ? "A" : t.startsWith("B") ? "B" : null;
  };
  const [r1, r2] = await Promise.all([ask(a, b), ask(b, a)]);
  const firstVotes = (r1 === "A" ? 1 : 0) + (r2 === "B" ? 1 : 0);
  const secondVotes = (r1 === "B" ? 1 : 0) + (r2 === "A" ? 1 : 0);
  return firstVotes > secondVotes ? "first" : "second";
}

// The fill-in prompt already tells Gemini to preserve every other character
// and pixel exactly, but that's an instruction, not a guarantee -- confirmed
// on a real order where filling in the hero's silhouette also quietly
// redrew a sibling character standing next to her (different face, different
// outfit), even though the sibling was already fully rendered in the source
// scene and should never have been touched. This judge diffs the before/after
// scene at the level of "did any OTHER character change" and retries if so,
// the same way judgeIdentityMatch/judgeTextZoneClear do for their failure
// modes. Applies to every fill-in (not just spread layouts).
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
    { inlineData: { data: (await downscaleForJudge(resultBuffer)).toString("base64"), mimeType: "image/jpeg" } },
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

// The fill-in prompt only describes ONE blank silhouette to replace, but a
// generative fill can still hallucinate a second copy of the hero elsewhere
// in the scene (this is the same underlying failure mode judgeTextZoneClear
// catches for the spread-layout text half specifically -- this check is the
// general case, covering every layout and any location in the frame, not
// just the text zone).
function buildSingleHeroJudgeSystemPrompt(): string {
  return (
    `You are a duplication judge for a children's book illustration pipeline. You check whether the same specific child (matched against an identity reference sheet) appears more than once as a distinct, separate figure in a single rendered scene.\n` +
    `Only flag a genuine second appearance of the hero as their own separate figure elsewhere in the frame. Do not flag the hero's one correct appearance, or another character who merely shares similar coloring or build.`
  );
}

async function judgeSingleHero(
  characterSheetUrl: string,
  resultBuffer: Buffer
): Promise<{ isSingle: boolean; reason: string }> {
  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    systemInstruction: buildSingleHeroJudgeSystemPrompt(),
    generationConfig: { responseModalities: ["TEXT"] } as never,
  });

  const parts: Parameters<typeof model.generateContent>[0] = [
    await urlToInlineData(characterSheetUrl, "image/png"),
    "IDENTITY REFERENCE SHEET above: FRONT, LEFT, RIGHT, BACK views of a specific child -- the hero.",
    { inlineData: { data: (await downscaleForJudge(resultBuffer)).toString("base64"), mimeType: "image/jpeg" } },
    `RENDERED IMAGE above: a generated illustration that may contain several characters. Find every character in the image who matches the identity reference sheet (the hero) -- same face shape, hairstyle, and skin tone.\n\n` +
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

// Spread layouts (spread_left/right, clean or not) crop ONE shared wide
// image in half at render time -- one half becomes the scene page, the
// other becomes the text page (renderSpreadTextPage/buildSvgOverlay). The
// template's own scene-zone constraint doesn't re-apply automatically once
// fillInHeroIdentity edits the hero into the scene: confirmed on a real
// order (page 3, "Discovering Wonders of India") where the identity fill-in
// itself hallucinated a second copy of the hero standing alone in what
// should have been the empty text half, even though the source template
// was clean (single correctly-placed silhouette). This judge catches that
// specific failure mode -- reuses the same vision+text-only call pattern as
// judgeIdentityMatch (no image OUTPUT tokens, the expensive part -- a judge
// call runs roughly 0.5% of the cost of one actual image generation).
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
    { inlineData: { data: (await downscaleForJudge(resultBuffer)).toString("base64"), mimeType: "image/jpeg" } },
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

async function generateOrderScene(
  supabase: ReturnType<typeof createServerClient>,
  characterSheetPath: string,
  approvedScenePath: string,
  heroGender: "boy" | "girl",
  storagePath: string,
  textSwap?: { placeholder: string; replacement: string },
  sceneContext?: string,
  usingCostumedSheet?: boolean,
  // Purely for gemini_call_log attribution -- lets Analytics break real call
  // counts down per page and per book, not just theoretical bounds.
  logCtx?: { orderId: string; storyId?: string; pageId?: string; kind: "page" | "cover" },
  // Set only for spread-layout story pages -- see judgeTextZoneClear's
  // comment. Covers and non-spread pages don't share this failure mode, so
  // they skip the extra judge call entirely (no cost, not just no retry).
  textZoneSceneDir?: "left" | "right",
  // The character's AI-cartoonized portrait (character.cartoon_image_url,
  // NOT the real photo -- that's never persisted, by design). See
  // fillInHeroIdentity's comment on groundTruthPortraitUrl.
  groundTruthPortraitPath?: string | null,
  // characters.head_sheet_url -- see generateHeadSheetBuffer.
  headSheetPath?: string | null,
): Promise<{ path: string; identityVerified: boolean }> {
  const [characterSheetUrl, approvedSceneUrl, groundTruthPortraitUrl, headSheetUrl] = await Promise.all([
    signAsset(supabase, characterSheetPath),
    signAsset(supabase, approvedScenePath),
    groundTruthPortraitPath ? signAsset(supabase, groundTruthPortraitPath) : Promise.resolve(null),
    headSheetPath ? signAsset(supabase, headSheetPath) : Promise.resolve(null),
  ]);

  // Every failed attempt is kept, not just the last: when retries run out the
  // better of them ships (see pickBestCandidate), instead of whichever happened
  // to be generated last -- a retry is not guaranteed to look more like the child.
  const candidates: { buffer: Buffer; structuralFail: boolean }[] = [];
  for (let attempt = 1; attempt <= MAX_SWAP_ATTEMPTS; attempt++) {
    const buffer = await fillInHeroIdentity(characterSheetUrl, approvedSceneUrl, heroGender, textSwap, sceneContext, usingCostumedSheet, groundTruthPortraitUrl, headSheetUrl);
    if (logCtx) {
      await logGeminiCall(supabase, {
        callType: logCtx.kind === "cover" ? "order_fillin_cover" : "order_fillin_page",
        storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId,
      });
    }
    const cand = { buffer, structuralFail: false };
    candidates.push(cand);
    const { isMatch, reason } = await judgeIdentityMatch(characterSheetUrl, buffer, groundTruthPortraitUrl, headSheetUrl);
    if (logCtx) {
      await logGeminiCall(supabase, {
        callType: logCtx.kind === "cover" ? "order_judge_cover" : "order_judge_page",
        storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId,
      });
    }
    if (!isMatch) {
      console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed identity judge: ${reason}`);
      continue;
    }

    if (usingCostumedSheet) {
      const { isMatch: wardrobeMatches, reason: wardrobeReason } = await judgeWardrobeMatch(characterSheetUrl, buffer);
      if (logCtx) {
        await logGeminiCall(supabase, {
          callType: logCtx.kind === "cover" ? "order_wardrobe_judge_cover" : "order_wardrobe_judge_page",
          storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId,
        });
      }
      if (!wardrobeMatches) {
        console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed wardrobe judge: ${wardrobeReason}`);
        cand.structuralFail = true;
        continue;
      }
    }

    // Only spend the preserve/zone-check calls once identity already
    // passed -- no point checking a result we're rejecting anyway.
    const { isPreserved, reason: preserveReason } = await judgeScenePreserved(approvedSceneUrl, buffer);
    if (logCtx) {
      await logGeminiCall(supabase, {
        callType: logCtx.kind === "cover" ? "order_preserve_judge_cover" : "order_preserve_judge_page",
        storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId,
      });
    }
    if (!isPreserved) {
      console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed scene-preservation judge: ${preserveReason}`);
      cand.structuralFail = true;
      continue;
    }

    const { isSingle, reason: dupeReason } = await judgeSingleHero(characterSheetUrl, buffer);
    if (logCtx) {
      await logGeminiCall(supabase, {
        callType: logCtx.kind === "cover" ? "order_dupe_judge_cover" : "order_dupe_judge_page",
        storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId,
      });
    }
    if (!isSingle) {
      console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed single-hero judge: ${dupeReason}`);
      cand.structuralFail = true;
      continue;
    }

    if (textZoneSceneDir) {
      const { isClear, reason: zoneReason } = await judgeTextZoneClear(buffer, textZoneSceneDir);
      if (logCtx) {
        await logGeminiCall(supabase, {
          callType: "order_zone_judge_page",
          storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId,
        });
      }
      if (!isClear) {
        console.warn(`[order-scene] attempt ${attempt}/${MAX_SWAP_ATTEMPTS} failed text-zone judge: ${zoneReason}`);
        cand.structuralFail = true;
        continue;
      }
    }

    const path = await uploadBufferToStorage(supabase, buffer, storagePath, "image/webp");
    return { path, identityVerified: true };
  }

  // Exhausted retries -- ship the closest likeness among the attempts anyway
  // (don't block the pipeline) but flag it unverified so admins can see and
  // retry manually.
  const best = await pickBestCandidate(supabase, candidates, characterSheetUrl, groundTruthPortraitUrl, headSheetUrl, logCtx);
  const path = await uploadBufferToStorage(supabase, best, storagePath, "image/webp");
  return { path, identityVerified: false };
}

// Chooses which failed attempt to keep. Attempts that tripped a structural
// judge (another character redrawn, duplicate hero, text-zone violation) lose
// to ones that only failed the identity judge; among what's left, a
// position-swapped pairwise likeness comparison picks the closer face. Costs
// two cheap judge calls and no extra image generation.
async function pickBestCandidate(
  supabase: ReturnType<typeof createServerClient>,
  candidates: { buffer: Buffer; structuralFail: boolean }[],
  characterSheetUrl: string,
  groundTruthPortraitUrl: string | null,
  headSheetUrl: string | null,
  logCtx?: { orderId: string; storyId?: string; pageId?: string; kind: "page" | "cover" }
): Promise<Buffer> {
  const clean = candidates.filter((c) => !c.structuralFail);
  const pool = clean.length > 0 ? clean : candidates;
  let best = pool[0].buffer;
  for (let i = 1; i < pool.length; i++) {
    try {
      const winner = await judgePairwiseLikeness(characterSheetUrl, best, pool[i].buffer, groundTruthPortraitUrl, headSheetUrl);
      if (logCtx) {
        for (let n = 0; n < 2; n++) {
          await logGeminiCall(supabase, {
            callType: logCtx.kind === "cover" ? "order_rank_judge_cover" : "order_rank_judge_page",
            storyId: logCtx.storyId, pageId: logCtx.pageId, orderId: logCtx.orderId,
          });
        }
      }
      best = winner === "first" ? best : pool[i].buffer;
    } catch (err) {
      console.warn("[order-scene] pairwise ranking failed, keeping the later attempt:", err);
      best = pool[i].buffer;
    }
  }
  return best;
}

// Generates (or reuses) the character's head turnaround (see
// generateHeadSheetBuffer), cached on characters.head_sheet_url so it runs
// once per character, ever. Characters created before this existed get one
// lazily the first time an order needs it. Non-fatal: any failure returns
// null and generation proceeds on the portrait + body sheet as before.
// Missing column (migration not applied yet) is also treated as "skip" --
// never generate blind, since the result couldn't be cached and would be
// re-billed on every call.
async function getOrCreateHeadSheet(
  supabase: ReturnType<typeof createServerClient>,
  orderId: string,
  opts: { createIfMissing: boolean } = { createIfMissing: true }
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
    if (!opts.createIfMissing || !ch.cartoon_image_url) return null;

    const portraitUrl = await signAsset(supabase, ch.cartoon_image_url);
    // Close-up child faces get intermittently blocked by Gemini's
    // IMAGE_SAFETY classifier; retry only that.
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
    await uploadBufferToStorage(supabase, buffer, path, "image/png");
    await supabase.from("characters").update({ head_sheet_url: path }).eq("id", order.character_id);
    return path;
  } catch (err) {
    console.error("[order/head-sheet] head sheet unavailable, continuing without it:", err);
    return null;
  }
}

// Generates (or reuses) a costumed variant of the character's identity sheet
// for this order -- an edit of the neutral sheet with the story's gendered
// costume baked in, so every page + cover swap in this order references the
// SAME costumed image instead of each independently re-describing the
// outfit in text (which drifts across calls the same way any independent
// generation does). Cached on orders.costumed_sheet_url so it only runs
// once per order. Returns null (caller falls back to the neutral sheet) when
// no costume is configured for this gender, or if generation can't produce
// a face-faithful result after retrying.
async function getOrCreateCostumedSheet(
  supabase: ReturnType<typeof createServerClient>,
  orderId: string,
  existingCostumedSheetPath: string | null,
  neutralSheetPath: string,
  costumeDescription: string | null | undefined,
  heroGender: "boy" | "girl",
  // character.cartoon_image_url -- see fillInHeroIdentity's comment on
  // groundTruthPortraitUrl. Keeps the costume edit from quietly drifting the
  // face along with the clothing.
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
        await uploadBufferToStorage(supabase, buffer, path, "image/png");
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

// ── Public server actions ─────────────────────────────────────────────────────

export async function startPageGeneration(orderId: string) {
  const supabase = createServerClient();

  type StoryPage = {
    id: string;
    page_number: number;
    image_url: string | null;
    text: string;
    scene_prompt: string | null;
  };

  type OrderWithRelations = {
    id: string;
    hero_name: string;
    gender: string;
    child_age: number | null;
    costumed_sheet_url: string | null;
    characters: { sheet_url: string | null; cartoon_image_url: string | null } | null;
    stories: {
      id: string;
      layout_type: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
      generation_style: string | null;
      text_style: TextStyle | null;
      cover_image_url: string | null;
      cover_swap_template_url: string | null;
      hero_costume_description_boy: string | null;
      hero_costume_description_girl: string | null;
      story_pages: StoryPage[];
    } | null;
  };

  const { data: rawOrder, error } = await supabase
    .from("orders")
    .select(`
      id, hero_name, gender, child_age, costumed_sheet_url,
      characters ( sheet_url, cartoon_image_url ),
      stories (
        id, layout_type, generation_style, text_style, cover_image_url, cover_swap_template_url,
        hero_costume_description_boy, hero_costume_description_girl,
        story_pages ( id, page_number, image_url, text, scene_prompt )
      )
    `)
    .eq("id", orderId)
    .single();

  if (error || !rawOrder) throw new Error(error ? `Query failed: ${error.message}` : "Order not found");

  const order = rawOrder as unknown as OrderWithRelations;
  const character = order.characters;
  const story = order.stories;
  const heroGender = order.gender === "girl" ? "girl" : "boy";
  const ageBand = ageToBand(order.child_age);
  const pages = story?.story_pages ?? [];

  if (!pages.length) throw new Error("Story has no pages");
  if (!character?.sheet_url && !character?.cartoon_image_url)
    throw new Error("Character not generated yet — complete Step 1 first.");

  // Prefer sheet; fall back to headshot for legacy orders without a sheet
  const characterImagePath = character.sheet_url ?? character.cartoon_image_url!;

  const costumeDescription = heroGender === "girl"
    ? story?.hero_costume_description_girl
    : story?.hero_costume_description_boy;
  const costumedSheetPath = character.sheet_url
    ? await getOrCreateCostumedSheet(supabase, orderId, order.costumed_sheet_url, character.sheet_url, costumeDescription, heroGender, character.cartoon_image_url)
    : null;
  const characterSheetPathForSwap = costumedSheetPath ?? characterImagePath;
  const headSheetPath = await getOrCreateHeadSheet(supabase, orderId);

  // Reset order_pages
  await supabase.from("order_pages").delete().eq("order_id", orderId);
  await supabase.from("order_pages").insert(
    pages.map((p) => ({
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

  await supabase.from("orders").update({ status: "generating" }).eq("id", orderId);
  revalidatePath("/orders");

  // Batch-fetch this band's variant for every page in one query rather than
  // per-page in the loop below. Falls back to page.image_url wherever a
  // story hasn't generated age variants yet (see Backward compatibility).
  const { data: pageVariants } = await supabase
    .from("story_page_age_variants")
    .select("page_id, image_url")
    .in("page_id", pages.map((p) => p.id))
    .eq("age_band", ageBand);
  const pageVariantMap = new Map((pageVariants ?? []).map((v) => [v.page_id, v.image_url]));

  // ── Step 1: Generate personalised scene per page ──────────────────────────

  const generatedResults: { orderPageId: string; imagePath: string; storyPageText: string }[] = [];

  for (const page of pages) {
    const { data: orderPage } = await supabase
      .from("order_pages")
      .select("id")
      .eq("order_id", orderId)
      .eq("page_number", page.page_number)
      .single();

    if (!orderPage) continue;

    try {
      const scenePath = pageVariantMap.get(page.id) ?? page.image_url;
      if (!scenePath) {
        await supabase.from("order_pages").update({
          generation_status: "failed",
          error_message: "No approved scene for this page",
        }).eq("id", orderPage.id);
        continue;
      }

      const sceneContext = page.scene_prompt?.trim()
        ? personalizeText(page.scene_prompt, "the hero", heroGender)
        : undefined;

      const { path: imagePath, identityVerified } = await generateOrderScene(
        supabase,
        characterSheetPathForSwap,
        scenePath,
        heroGender,
        `order-pages/${orderPage.id}/scene-${Date.now()}.webp`,
        undefined,
        sceneContext,
        !!costumedSheetPath,
        { orderId, storyId: story?.id, pageId: page.id, kind: "page" },
        spreadSceneDir(story?.layout_type) ?? undefined,
        character.cartoon_image_url,
        headSheetPath,
      );

      await supabase.from("order_pages").update({
        image_url: imagePath,
        upscaled_image_url: imagePath,
        generation_status: "done",
        identity_verified: identityVerified,
      }).eq("id", orderPage.id);

      generatedResults.push({ orderPageId: orderPage.id, imagePath, storyPageText: page.text });
    } catch (err) {
      await supabase.from("order_pages").update({
        generation_status: "failed",
        error_message: (err as Error).message,
      }).eq("id", orderPage.id);
    }
  }

  // ── Step 2: Generate personalised cover ──────────────────────────────────
  // Falls back to the display cover if this story hasn't generated a
  // dedicated blank-silhouette swap template yet (see Backward compatibility).

  let coverVariantUrl: string | null = null;
  if (story?.id) {
    const { data: coverVariant } = await supabase
      .from("story_cover_age_variants")
      .select("image_url")
      .eq("story_id", story.id)
      .eq("age_band", ageBand)
      .maybeSingle();
    coverVariantUrl = coverVariant?.image_url ?? null;
  }
  const storyCoverPath = coverVariantUrl ?? story?.cover_swap_template_url ?? story?.cover_image_url;

  if (storyCoverPath) {
    try {
      const { path: coverPath, identityVerified } = await generateOrderScene(
        supabase,
        characterSheetPathForSwap,
        storyCoverPath,
        heroGender,
        `order-covers/${orderId}/cover-${Date.now()}.webp`,
        { placeholder: "{{hero_name}}", replacement: order.hero_name },
        undefined,
        !!costumedSheetPath,
        { orderId, storyId: story?.id, kind: "cover" },
        undefined,
        character.cartoon_image_url,
        headSheetPath,
      );
      await supabase.from("orders").update({ cover_image_url: coverPath }).eq("id", orderId);
      if (!identityVerified) console.warn(`[order/cover] Cover identity unverified after retries — order ${orderId}`);
    } catch (err) {
      console.error("[order/cover] Cover generation failed:", err);
      // Non-fatal — PDF falls back to story cover_image_url
    }
  }

  // ── Step 3: Composite hero name text onto each page (overlay_bottom only) ───
  // split and spread layouts render text as a separate page in the PDF — no compositing needed.

  if (story?.layout_type !== "split_image_left" && story?.layout_type !== "split_image_right"
      && story?.layout_type !== "spread_left" && story?.layout_type !== "spread_right"
      && story?.layout_type !== "spread_left_clean" && story?.layout_type !== "spread_right_clean") {
    const textStyle: TextStyle = (story?.text_style as TextStyle | null) ?? DEFAULT_TEXT_STYLE;
    const fontPath = await resolveFontPath(textStyle.fontFamily);

    await Promise.all(
      generatedResults.map(async ({ orderPageId, imagePath, storyPageText }) => {
        try {
          const signedImageUrl = await signAsset(supabase, imagePath);
          const personalizedText = personalizeText(storyPageText, order.hero_name, order.gender as "boy" | "girl");
          const composited = await compositeTextOntoImage(signedImageUrl, personalizedText, textStyle, fontPath);

          const storagePath = `order-text-images/${orderPageId}/composited.webp`;
          await supabase.storage.from("assets").upload(storagePath, composited, { contentType: "image/webp", upsert: true });
          await supabase.from("order_pages").update({ text_image_url: storagePath }).eq("id", orderPageId);
        } catch (err) {
          console.error(`Text composite failed for order page ${orderPageId}:`, err);
        }
      })
    );
  }

  // ── Step 3: Mark order status ─────────────────────────────────────────────

  const { data: finalPages } = await supabase
    .from("order_pages")
    .select("generation_status")
    .eq("order_id", orderId);

  const allDone = finalPages?.every((p: { generation_status: string }) => p.generation_status === "done");
  await supabase.from("orders")
    .update({ status: allDone ? "preview_ready" : "generating" })
    .eq("id", orderId);

  revalidatePath("/orders");
}

export async function generateSinglePage(orderId: string, pageNumber: number) {
  const supabase = createServerClient();

  type Row = {
    id: string;
    hero_name: string;
    gender: string;
    child_age: number | null;
    costumed_sheet_url: string | null;
    story_id: string;
    characters: { sheet_url: string | null; cartoon_image_url: string | null } | null;
    stories: {
      layout_type: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
      generation_style: string | null;
      text_style: TextStyle | null;
      hero_costume_description_boy: string | null;
      hero_costume_description_girl: string | null;
      story_pages: { id: string; page_number: number; image_url: string | null; text: string; scene_prompt: string | null }[];
    } | null;
  };

  const { data: rawOrder, error } = await supabase
    .from("orders")
    .select(`
      id, hero_name, gender, child_age, costumed_sheet_url, story_id,
      characters ( sheet_url, cartoon_image_url ),
      stories (
        layout_type, generation_style, text_style,
        hero_costume_description_boy, hero_costume_description_girl,
        story_pages ( id, page_number, image_url, text, scene_prompt )
      )
    `)
    .eq("id", orderId)
    .single();

  if (error || !rawOrder) throw new Error(error ? `Query failed: ${error.message}` : "Order not found");

  const order = rawOrder as unknown as Row;
  const characterImagePath = order.characters?.sheet_url ?? order.characters?.cartoon_image_url;
  if (!characterImagePath) throw new Error("Character not generated yet");

  const heroGender = order.gender === "girl" ? "girl" : "boy";
  const ageBand = ageToBand(order.child_age);
  const storyPage = order.stories?.story_pages.find((p) => p.page_number === pageNumber);
  if (!storyPage) throw new Error(`Page ${pageNumber} not found`);
  if (!storyPage.image_url) throw new Error(`Page ${pageNumber} has no approved scene`);

  const { data: pageVariant } = await supabase
    .from("story_page_age_variants")
    .select("image_url")
    .eq("page_id", storyPage.id)
    .eq("age_band", ageBand)
    .maybeSingle();
  const scenePath = pageVariant?.image_url ?? storyPage.image_url;

  const costumeDescription = heroGender === "girl"
    ? order.stories?.hero_costume_description_girl
    : order.stories?.hero_costume_description_boy;
  const costumedSheetPath = order.characters?.sheet_url
    ? await getOrCreateCostumedSheet(supabase, orderId, order.costumed_sheet_url, order.characters.sheet_url, costumeDescription, heroGender, order.characters.cartoon_image_url)
    : null;
  const characterSheetPathForSwap = costumedSheetPath ?? characterImagePath;
  const headSheetPath = await getOrCreateHeadSheet(supabase, orderId);

  const { data: orderPage } = await supabase
    .from("order_pages")
    .select("id")
    .eq("order_id", orderId)
    .eq("page_number", pageNumber)
    .single();

  if (!orderPage) throw new Error(`Order page ${pageNumber} record not found`);

  await supabase.from("order_pages").update({ generation_status: "processing", error_message: null }).eq("id", orderPage.id);

  try {
    const sceneContext = storyPage.scene_prompt?.trim()
      ? personalizeText(storyPage.scene_prompt, "the hero", heroGender)
      : undefined;

    const { path: imagePath, identityVerified } = await generateOrderScene(
      supabase,
      characterSheetPathForSwap,
      scenePath,
      heroGender,
      `order-pages/${orderPage.id}/scene-${Date.now()}.webp`,
      undefined,
      sceneContext,
      !!costumedSheetPath,
      { orderId, storyId: order.story_id, pageId: storyPage.id, kind: "page" },
      spreadSceneDir(order.stories?.layout_type) ?? undefined,
      order.characters?.cartoon_image_url,
      headSheetPath,
    );

    const isSplit = order.stories?.layout_type === "split_image_left" || order.stories?.layout_type === "split_image_right";
    const isSpread = order.stories?.layout_type === "spread_left" || order.stories?.layout_type === "spread_right" || order.stories?.layout_type === "spread_left_clean" || order.stories?.layout_type === "spread_right_clean";
    let textImagePath: string | null = null;

    if (!isSplit && !isSpread) {
      const textStyle: TextStyle = (order.stories?.text_style as TextStyle | null) ?? DEFAULT_TEXT_STYLE;
      const fontPath = await resolveFontPath(textStyle.fontFamily);
      const personalizedText = personalizeText(storyPage.text, order.hero_name, order.gender as "boy" | "girl");
      const signedImageUrl = await signAsset(supabase, imagePath);
      const composited = await compositeTextOntoImage(signedImageUrl, personalizedText, textStyle, fontPath);
      const storagePath = `order-text-images/${orderPage.id}/composited.webp`;
      await supabase.storage.from("assets").upload(storagePath, composited, { contentType: "image/webp", upsert: true });
      textImagePath = storagePath;
    }

    await supabase.from("order_pages").update({
      image_url: imagePath,
      upscaled_image_url: imagePath,
      text_image_url: textImagePath,
      generation_status: "done",
      identity_verified: identityVerified,
    }).eq("id", orderPage.id);
  } catch (err) {
    await supabase.from("order_pages").update({
      generation_status: "failed",
      error_message: (err as Error).message,
    }).eq("id", orderPage.id);
    throw err;
  }

  revalidatePath("/orders");
}

// Cheap alternative to generateSinglePage for the common case where the
// saved image is actually fine but identity_verified is stuck false --
// confirmed on a real order (page 1) where re-running judgeIdentityMatch
// against the SAME already-uploaded image returned MATCH, even though all
// 3 original fill-in attempts had returned NO_MATCH. The judge call has
// real run-to-run variance, so "unverified" doesn't always mean the image
// is wrong. This re-checks the existing image with one text-only identity
// judge plus, when the order has a locked costume, one wardrobe judge. Both
// are far cheaper than discarding a possibly-fine image and paying for a new
// fill-in plus its validation calls.
export async function reverifyPageIdentity(orderId: string, pageNumber: number): Promise<{ verified: boolean; reason: string }> {
  const supabase = createServerClient();

  const { data: rawOrder, error } = await supabase
    .from("orders")
    .select(`
      story_id, costumed_sheet_url,
      characters ( sheet_url, cartoon_image_url )
    `)
    .eq("id", orderId)
    .single();

  if (error || !rawOrder) throw new Error(error ? `Query failed: ${error.message}` : "Order not found");

  const order = rawOrder as unknown as {
    story_id: string;
    costumed_sheet_url: string | null;
    characters: { sheet_url: string | null; cartoon_image_url: string | null } | null;
  };
  const characterImagePath = order.characters?.sheet_url ?? order.characters?.cartoon_image_url;
  if (!characterImagePath) throw new Error("Character not generated yet");

  const { data: orderPage, error: pageError } = await supabase
    .from("order_pages")
    .select("id, image_url")
    .eq("order_id", orderId)
    .eq("page_number", pageNumber)
    .single();

  if (pageError || !orderPage) throw new Error(`Order page ${pageNumber} not found`);
  if (!orderPage.image_url) throw new Error(`Order page ${pageNumber} has no image yet`);

  const { data: storyPage } = await supabase
    .from("story_pages")
    .select("id")
    .eq("story_id", order.story_id)
    .eq("page_number", pageNumber)
    .maybeSingle();

  const headSheetPath = await getOrCreateHeadSheet(supabase, orderId, { createIfMissing: false });
  const [characterSheetUrl, pageImageUrl, groundTruthPortraitUrl, headSheetUrl, costumedSheetUrl] = await Promise.all([
    signAsset(supabase, characterImagePath),
    signAsset(supabase, orderPage.image_url),
    order.characters?.cartoon_image_url ? signAsset(supabase, order.characters.cartoon_image_url) : Promise.resolve(null),
    headSheetPath ? signAsset(supabase, headSheetPath) : Promise.resolve(null),
    order.costumed_sheet_url ? signAsset(supabase, order.costumed_sheet_url) : Promise.resolve(null),
  ]);

  const res = await fetch(pageImageUrl);
  if (!res.ok) throw new Error(`Failed to fetch page image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const { isMatch: identityMatches, reason: identityReason } = await judgeIdentityMatch(characterSheetUrl, buffer, groundTruthPortraitUrl, headSheetUrl);
  await logGeminiCall(supabase, {
    callType: "order_reverify_judge_page",
    storyId: order.story_id, pageId: storyPage?.id, orderId,
  });

  let wardrobeMatches = true;
  let wardrobeReason = "";
  if (identityMatches && costumedSheetUrl) {
    const wardrobe = await judgeWardrobeMatch(costumedSheetUrl, buffer);
    wardrobeMatches = wardrobe.isMatch;
    wardrobeReason = wardrobe.reason;
    await logGeminiCall(supabase, {
      callType: "order_wardrobe_judge_page",
      storyId: order.story_id, pageId: storyPage?.id, orderId,
    });
  }

  const verified = identityMatches && wardrobeMatches;
  const reason = !identityMatches ? identityReason : wardrobeMatches ? identityReason : `Wardrobe mismatch: ${wardrobeReason}`;

  await supabase.from("order_pages").update({ identity_verified: verified }).eq("id", orderPage.id);
  revalidatePath(`/orders/${orderId}`);

  return { verified, reason };
}

// Standalone manual redo, reusing the same personalized-cover edit as Step 2
// of startPageGeneration -- for when an admin wants to regenerate just the
// cover (e.g. after fixing the story's template cover) without rerunning the
// whole order.
export async function regenerateOrderCover(orderId: string) {
  const supabase = createServerClient();

  type Row = {
    id: string;
    hero_name: string;
    gender: string;
    child_age: number | null;
    costumed_sheet_url: string | null;
    story_id: string;
    characters: { sheet_url: string | null; cartoon_image_url: string | null } | null;
    stories: {
      cover_image_url: string | null;
      cover_swap_template_url: string | null;
      hero_costume_description_boy: string | null;
      hero_costume_description_girl: string | null;
    } | null;
  };

  const { data: rawOrder, error } = await supabase
    .from("orders")
    .select(`
      id, hero_name, gender, child_age, costumed_sheet_url, story_id,
      characters ( sheet_url, cartoon_image_url ),
      stories ( cover_image_url, cover_swap_template_url, hero_costume_description_boy, hero_costume_description_girl )
    `)
    .eq("id", orderId)
    .single();

  if (error || !rawOrder) throw new Error(error ? `Query failed: ${error.message}` : "Order not found");

  const order = rawOrder as unknown as Row;
  const characterImagePath = order.characters?.sheet_url ?? order.characters?.cartoon_image_url;
  if (!characterImagePath) throw new Error("Character not generated yet");

  const heroGender = order.gender === "girl" ? "girl" : "boy";
  const ageBand = ageToBand(order.child_age);

  const costumeDescription = heroGender === "girl"
    ? order.stories?.hero_costume_description_girl
    : order.stories?.hero_costume_description_boy;
  const costumedSheetPath = order.characters?.sheet_url
    ? await getOrCreateCostumedSheet(supabase, orderId, order.costumed_sheet_url, order.characters.sheet_url, costumeDescription, heroGender, order.characters.cartoon_image_url)
    : null;
  const characterSheetPathForSwap = costumedSheetPath ?? characterImagePath;
  const headSheetPath = await getOrCreateHeadSheet(supabase, orderId);

  const { data: coverVariant } = await supabase
    .from("story_cover_age_variants")
    .select("image_url")
    .eq("story_id", order.story_id)
    .eq("age_band", ageBand)
    .maybeSingle();
  const storyCoverPath = coverVariant?.image_url ?? order.stories?.cover_swap_template_url ?? order.stories?.cover_image_url;
  if (!storyCoverPath) throw new Error("Story has no template cover to personalize");

  const { path: coverPath, identityVerified } = await generateOrderScene(
    supabase,
    characterSheetPathForSwap,
    storyCoverPath,
    heroGender,
    `order-covers/${orderId}/cover-${Date.now()}.webp`,
    { placeholder: "{{hero_name}}", replacement: order.hero_name },
    undefined,
    !!costumedSheetPath,
    { orderId, storyId: order.story_id, kind: "cover" },
    undefined,
    order.characters?.cartoon_image_url,
    headSheetPath,
  );
  await supabase.from("orders").update({ cover_image_url: coverPath }).eq("id", orderId);
  if (!identityVerified) console.warn(`[order/cover] Cover identity unverified after retries — order ${orderId}`);

  revalidatePath(`/orders/${orderId}`);
}

export async function resetOrder(orderId: string) {
  const supabase = createServerClient();

  // Fetch all order page IDs to derive storage paths
  const { data: pages } = await supabase
    .from("order_pages")
    .select("id")
    .eq("order_id", orderId);

  if (pages?.length) {
    // Delete generated images from storage for each page
    const scenePaths = pages.map((p) => `order-pages/${p.id}`);
    const textPaths = pages.map((p) => `order-text-images/${p.id}`);

    // List and delete files under each path prefix
    await Promise.allSettled([
      ...scenePaths.map(async (prefix) => {
        const { data: files } = await supabase.storage.from("assets").list(prefix);
        if (files?.length) {
          await supabase.storage.from("assets").remove(files.map((f) => `${prefix}/${f.name}`));
        }
      }),
      ...textPaths.map(async (prefix) => {
        const { data: files } = await supabase.storage.from("assets").list(prefix);
        if (files?.length) {
          await supabase.storage.from("assets").remove(files.map((f) => `${prefix}/${f.name}`));
        }
      }),
    ]);
  }

  // Delete order_pages rows and reset order status
  await supabase.from("order_pages").delete().eq("order_id", orderId);
  await supabase.from("orders").update({ status: "paid" }).eq("id", orderId);

  revalidatePath("/orders");
}

export async function generateOrderPdf(orderId: string, includeReview = false): Promise<string> {
  const supabase = createServerClient();

  // Fetch order with story layout config and all generated pages
  const { data: rawOrder, error } = await supabase
    .from("orders")
    .select(`
      id, hero_name, gender, cover_image_url,
      characters ( source_image_url, cartoon_image_url, sheet_url ),
      stories (
        id, title, layout_type, cover_layout, text_style, text_panel_bg,
        cover_image_url, dedication_text, end_page_image_url,
        back_cover_featured_story_ids, back_cover_tagline,
        brand_page_image_url,
        story_pages ( page_number, text, text_bg_url, vertical_align ),
        story_cast ( sort_order, cast_characters ( id, name, reference_url ) )
      ),
      order_pages ( page_number, image_url, text_image_url )
    `)
    .eq("id", orderId)
    .single();

  if (error || !rawOrder) throw new Error(error?.message ?? "Order not found");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const order = rawOrder as any;
  const story = order.stories;
  if (!story) throw new Error("Order has no story");

  // Collect all asset paths and sign them in bulk
  const storyPages: import("@/lib/supabase/types").StoryPageRow[] = story.story_pages ?? [];
  const orderPages: { page_number: number; image_url: string | null; text_image_url: string | null }[] = order.order_pages ?? [];
  const char = order.characters;

  // resolveStoragePath is a no-op for already-bare paths — cheap safety net
  // for the handful of legacy full URLs (e.g. story/order cover_image_url)
  // baked into some older rows from before the assets bucket went private.
  const pathsToSign: string[] = [];
  for (const op of orderPages) {
    if (op.image_url) pathsToSign.push(resolveStoragePath(op.image_url));
    if (op.text_image_url) pathsToSign.push(resolveStoragePath(op.text_image_url));
  }
  for (const sp of storyPages) {
    if ((sp as { text_bg_url?: string | null }).text_bg_url) pathsToSign.push(resolveStoragePath((sp as { text_bg_url?: string | null }).text_bg_url!));
  }
  if (order.cover_image_url) pathsToSign.push(resolveStoragePath(order.cover_image_url));
  if (story.cover_image_url) pathsToSign.push(resolveStoragePath(story.cover_image_url));
  if (story.brand_page_image_url) pathsToSign.push(resolveStoragePath(story.brand_page_image_url));
  if (story.end_page_image_url) pathsToSign.push(resolveStoragePath(story.end_page_image_url));
  if (char?.cartoon_image_url) pathsToSign.push(resolveStoragePath(char.cartoon_image_url));
  if (char?.sheet_url) pathsToSign.push(resolveStoragePath(char.sheet_url));

  const signedMap = await signAssets(supabase, [...new Set(pathsToSign)]);
  const s = (path: string | null | undefined) => (path ? (signedMap[resolveStoragePath(path)] ?? path) : null);

  const merged = storyPages
    .sort((a: { page_number: number }, b: { page_number: number }) => a.page_number - b.page_number)
    .map((sp: { page_number: number; text: string; text_bg_url?: string | null; vertical_align?: "top" | "center" | "bottom" | null }) => {
      const op = orderPages.find((p) => p.page_number === sp.page_number);
      return {
        imageUrl: s(op?.image_url),
        textImageUrl: s(op?.text_image_url),
        textBgUrl: s(sp.text_bg_url),
        text: sp.text,
        heroName: order.hero_name,
        verticalAlign: sp.vertical_align ?? "bottom",
      };
    });

  const { buildPageList, generatePdf } = await import("@/lib/pdf");
  type BookPage = import("@/lib/pdf").BookPage;

  // ── Back cover panel content (exterior print cover only) ──
  type FeaturedBook = import("@/lib/layout").FeaturedBook;
  const featuredIds: string[] = story.back_cover_featured_story_ids ?? [];
  let featuredBooks: FeaturedBook[] = [];
  if (featuredIds.length > 0) {
    const { data: featured } = await supabase.from("stories").select("id, title, cover_image_url").in("id", featuredIds);
    const byId = new Map((featured ?? []).map((f: { id: string; title: string; cover_image_url: string | null }) => [f.id, f]));
    const featuredCoverPaths = (featured ?? [])
      .map((f: { cover_image_url: string | null }) => f.cover_image_url)
      .filter((p): p is string => !!p)
      .map(resolveStoragePath);
    const featuredSignedMap = await signAssets(supabase, [...new Set(featuredCoverPaths)]);
    featuredBooks = featuredIds
      .map((id) => byId.get(id))
      .filter((f): f is { id: string; title: string; cover_image_url: string | null } => !!f)
      .map((f) => ({
        title: f.title,
        coverUrl: f.cover_image_url ? (featuredSignedMap[resolveStoragePath(f.cover_image_url)] ?? null) : null,
      }));
  }

  // ── Review pages (admin feedback section) ─────────────────────────────────
  const reviewPages: BookPage[] = [];
  if (includeReview) {
    // source_image_url is no longer stored (privacy) — skip
    if (char?.cartoon_image_url) {
      reviewPages.push({ kind: "review-image", url: s(char.cartoon_image_url)!, label: `${order.hero_name} — Mugshot` });
    }
    if (char?.sheet_url) {
      reviewPages.push({ kind: "review-image", url: s(char.sheet_url)!, label: `${order.hero_name} — Character Sheet` });
    }

    const castEntries: { sort_order: number; name: string; reference_url: string | null }[] =
      (story.story_cast ?? [])
        .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)
        .map((sc: { sort_order: number; cast_characters: { name: string; reference_url: string | null } }) => ({
          sort_order: sc.sort_order,
          name: sc.cast_characters?.name ?? "Character",
          reference_url: sc.cast_characters?.reference_url ?? null,
        }));

    for (const cast of castEntries) {
      if (cast.reference_url) {
        reviewPages.push({ kind: "review-image", url: cast.reference_url, label: `${cast.name} — Reference` });
      }
    }

    if (reviewPages.length > 0) {
      reviewPages.push({ kind: "review-divider", title: story.title });
    }
  }

  const { getBrandSettings } = await import("@/app/settings/actions");
  const brand = await getBrandSettings();

  const pageList = buildPageList({
    layoutType: story.layout_type ?? "overlay_bottom",
    coverLayout: story.cover_layout,
    textStyle: story.text_style ?? null,
    textPanelBg: story.text_panel_bg ?? null,
    coverImageUrl: s(order.cover_image_url) ?? s(story.cover_image_url),
    backCover: {
      websiteQrUrl: brand.website_url ?? null,
      instagramQrUrl: brand.instagram_url ?? null,
      companyName: brand.company_name ? `${brand.company_name}™` : null,
      leadingText: story.back_cover_tagline || brand.back_cover_leading_text || null,
      featuredBooks,
    },
    title: story.title,
    dedicationText: story.dedication_text,
    endPageImageUrl: s(story.end_page_image_url),
    brandPageImageUrl: s(story.brand_page_image_url),
    heroName: order.hero_name,
    gender: order.gender === "girl" ? "girl" : "boy",
    pages: merged,
  });

  const pdfBuffer = await generatePdf({ pages: [...reviewPages, ...pageList] });

  const storagePath = `order-pdfs/${orderId}/book.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("assets")
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw new Error(`PDF upload failed: ${uploadError.message}`);

  const pdfSignedUrl = await signAsset(supabase, storagePath);
  // Gelato's pagesCount means inner pages only -- excludes the cover spread,
  // the two blank endpaper leaves, and any review pages.
  const pdfPageCount = pageList.filter((p) => p.kind !== "cover" && p.kind !== "endpaper").length;
  await supabase.from("orders").update({ status: "pdf_ready", pdf_url: storagePath, pdf_page_count: pdfPageCount }).eq("id", orderId);
  revalidatePath("/orders");

  return pdfSignedUrl;
}

// Recovery path for an order stuck with bad/broken pages (e.g. generated
// before a pipeline bug fix) -- disposes every existing order_pages row and
// the stale PDF, regenerates the whole book from scratch, and rebuilds the
// PDF if every page comes back clean. Mirrors the Stripe-webhook fulfillment
// flow (api/fulfillment/start/route.ts) but is admin-triggered and awaited
// inline instead of backgrounded, since it's a manual, watched retry.
export async function regenerateEntireBook(orderId: string) {
  const supabase = createServerClient();

  const { data: order } = await supabase.from("orders").select("status").eq("id", orderId).single();
  if (order && ["sent_to_print", "shipped", "delivered"].includes(order.status)) {
    throw new Error(`Order already ${order.status.replace(/_/g, " ")} — regenerating would not affect the physical book already sent to print.`);
  }

  // Stale PDF would no longer match the pages about to be regenerated.
  await supabase.from("orders").update({ pdf_url: null, pdf_page_count: null }).eq("id", orderId);

  await startPageGeneration(orderId);

  const { data: updated } = await supabase.from("orders").select("status").eq("id", orderId).single();
  if (updated?.status === "preview_ready") {
    await generateOrderPdf(orderId);
  }
}

export async function pollPageGeneration(orderId: string) {
  const supabase = createServerClient();
  const { data: pages } = await supabase
    .from("order_pages")
    .select("generation_status")
    .eq("order_id", orderId);

  const counts = { total: pages?.length ?? 0, done: 0, failed: 0, processing: 0 };
  for (const p of pages ?? []) {
    if (p.generation_status === "done") counts.done++;
    else if (p.generation_status === "failed") counts.failed++;
    else counts.processing++;
  }
  return counts;
}
