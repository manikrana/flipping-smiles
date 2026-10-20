"use server";

import { createServerClient } from "@/lib/supabase/server";
import { signAsset } from "@/lib/supabase/assets";
import { getGemini, NANO_BANANA_2_MODEL, extractImageBuffer, urlToInlineData } from "@/lib/gemini";
import { getStyle, DEFAULT_STYLE } from "@/lib/styles";
import { revalidatePath } from "next/cache";
import { buildSystemInstruction, buildSheetUserParts, buildIdentityLockPart } from "./prompt";

// Re-export for CharacterEditor (used to show system prompt in UI)
export { buildSystemInstruction as buildStandardSheetSystemPrompt };

/**
 * Generate a 4-panel character turnaround sheet using Gemini.
 *
 * NOTE: gemini-2.5-flash-image largely ignores systemInstruction for image
 * generation. All constraints (style, layout, background, scale) are therefore
 * embedded in the user parts as the very first content the model reads.
 *
 * For clones: the primary character's sheet is passed as an identity reference
 * image so face/hair/body stays identical — only clothing changes.
 */
export async function generateCharacterSheet(
  characterId: string,
): Promise<{ imageUrl: string }> {
  const supabase = createServerClient();

  const { data: character, error } = await supabase
    .from("cast_characters")
    .select("name, description, cloned_from_id")
    .eq("id", characterId)
    .single();

  if (error || !character) throw new Error("Character not found");
  if (!character.description.trim()) throw new Error("Add a description first");

  // For clones — fetch the primary character's sheet as the identity anchor
  let primarySheetUrl: string | null = null;
  let primaryName: string | null = null;
  if (character.cloned_from_id) {
    const { data: primary } = await supabase
      .from("cast_characters")
      .select("name, sheet_url")
      .eq("id", character.cloned_from_id)
      .single();
    const rawSheetPath = primary?.sheet_url ?? null;
    primarySheetUrl = rawSheetPath ? await signAsset(supabase, rawSheetPath) : null;
    primaryName = primary?.name ?? null;
  }

  const isClone = !!character.cloned_from_id;
  const style = getStyle(DEFAULT_STYLE);
  const generationToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  console.log(
    `[sheet] generating — character="${character.name}" ` +
    `isClone=${isClone} hasPrimarySheet=${!!primarySheetUrl} ` +
    `token=${generationToken}`
  );

  const model = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    // systemInstruction has low weight for image generation — constraints are
    // repeated in the user parts where they actually take effect.
    systemInstruction: buildSystemInstruction(),
    generationConfig: {
      // @ts-expect-error responseModalities not yet in types
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  // ── Build ordered user parts ──────────────────────────────────────────────
  //
  // Order matters. The model reads top-to-bottom and weights earlier content
  // more heavily for image generation.
  //
  // Standard character:
  //   [1] REQUIRED SPECIFICATIONS (style + layout + background + scale + labels)
  //   [2] CHARACTER (name + description)
  //   [3] TASK (explicit instruction + critical reminders + token)
  //
  // Clone:
  //   [1] REQUIRED SPECIFICATIONS
  //   [2] Primary sheet image
  //   [3] IDENTITY LOCK (what to preserve vs ignore)
  //   [4] CHARACTER (name + new clothing description)
  //   [5] TASK

  const textParts = buildSheetUserParts({
    characterName: character.name,
    characterDescription: character.description,
    styleInstruction: style.sheetStyleInstruction,
    isClone,
    primaryName,
    generationToken,
  });

  // textParts = [specsText, characterText, taskText]
  const [specsText, characterText, taskText] = textParts;

  const parts: Parameters<typeof model.generateContent>[0] = [];

  // [1] Specs always go first
  parts.push(specsText);

  if (isClone && primarySheetUrl) {
    // [2] Primary sheet image
    parts.push(await urlToInlineData(primarySheetUrl));
    // [3] Identity lock rules
    parts.push(buildIdentityLockPart(primaryName));
  }

  // [4/2] Character
  parts.push(characterText);

  // [5/3] Task
  parts.push(taskText);

  // ── Generate ──────────────────────────────────────────────────────────────
  const result = await model.generateContent(parts);
  const imageBuffer = extractImageBuffer(result.response);

  // ── Upload to storage ─────────────────────────────────────────────────────
  const refId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `reference-images/${characterId}/sheet-${refId}.webp`;

  const { error: uploadError } = await supabase.storage
    .from("assets")
    .upload(storagePath, imageBuffer, { contentType: "image/webp", upsert: false });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  // ── Update DB ─────────────────────────────────────────────────────────────
  await supabase
    .from("cast_character_references")
    .delete()
    .eq("character_id", characterId)
    .eq("view", "sheet");

  const { error: refError } = await supabase
    .from("cast_character_references")
    .insert({ character_id: characterId, image_url: storagePath, view: "sheet" });
  if (refError) throw new Error(`Reference insert failed: ${refError.message}`);

  await supabase
    .from("cast_characters")
    .update({ sheet_url: storagePath, reference_url: storagePath })
    .eq("id", characterId);

  revalidatePath("/characters");
  revalidatePath(`/characters/${characterId}`);

  const imageUrl = await signAsset(supabase, storagePath);
  console.log(`[sheet] done — character="${character.name}" path=${storagePath}`);
  return { imageUrl };
}
