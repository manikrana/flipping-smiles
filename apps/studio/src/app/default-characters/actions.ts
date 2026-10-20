"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getGemini, NANO_BANANA_2_MODEL, extractImageBuffer, generateCharacterSheetBuffer } from "@/lib/gemini";
import { logGeminiCall } from "@/lib/geminiLog";

export type Gender = "boy" | "girl";

export async function createDefaultCharacter(formData: FormData) {
  const supabase = createServerClient();

  const gender = formData.get("gender") as string;
  const skinTone = formData.get("skinTone") as string;
  const hairColor = formData.get("hairColor") as string;
  const hairStyle = formData.get("hairStyle") as string;
  const eyeColor = formData.get("eyeColor") as string;

  if (gender !== "boy" && gender !== "girl") {
    throw new Error("Please choose a gender.");
  }
  if (!skinTone || !hairColor || !hairStyle || !eyeColor) {
    throw new Error("Please choose all character attributes.");
  }

  const { data: character, error: insertError } = await supabase
    .from("characters")
    .insert({
      source_image_url: null,
      hero_name: gender === "boy" ? "Default Boy" : "Default Girl",
      generation_status: "processing",
      cartoon_image_url: null,
      sheet_url: null,
      replicate_job_id: null,
      is_default: true,
      default_gender: gender,
    })
    .select("id")
    .single();

  if (insertError) throw new Error(insertError.message);

  try {
    const headshotModel = getGemini().getGenerativeModel({
      model: NANO_BANANA_2_MODEL,
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
    });

    const { response: headshotResponse } = await headshotModel.generateContent([
      {
        text: `Generate a Pixar 3D animated character portrait of a young ${gender === "boy" ? "boy" : "girl"} child, suitable for a children's storybook.
Skin tone: ${skinTone}. Hair: ${hairColor}, ${hairStyle}. Eyes: ${eyeColor}.
Big expressive eyes, friendly warm expression, plain white background, head and shoulders only.`,
      },
    ]);

    const cartoonBuffer = extractImageBuffer(headshotResponse);
    await logGeminiCall(supabase, { callType: "character_cartoon" });
    const cartoonPath = `default-characters/${character.id}/cartoon-${Date.now()}.png`;
    const { error: cartoonUploadError } = await supabase.storage
      .from("assets")
      .upload(cartoonPath, cartoonBuffer, { contentType: "image/png", upsert: true });
    if (cartoonUploadError) throw new Error(`Cartoon upload failed: ${cartoonUploadError.message}`);

    await supabase
      .from("characters")
      .update({ cartoon_image_url: cartoonPath })
      .eq("id", character.id);

    const { data: cartoonSigned } = await supabase.storage.from("assets").createSignedUrl(cartoonPath, 3600);
    if (!cartoonSigned?.signedUrl) throw new Error("Failed to sign cartoon URL for sheet generation");
    const sheetBuffer = await generateCharacterSheetBuffer(cartoonSigned.signedUrl);
    await logGeminiCall(supabase, { callType: "character_sheet" });
    const sheetPath = `default-characters/${character.id}/sheet-${Date.now()}.png`;
    const { error: sheetUploadError } = await supabase.storage
      .from("assets")
      .upload(sheetPath, sheetBuffer, { contentType: "image/png", upsert: true });
    if (sheetUploadError) throw new Error(`Sheet upload failed: ${sheetUploadError.message}`);

    await supabase
      .from("characters")
      .update({ sheet_url: sheetPath, generation_status: "done" })
      .eq("id", character.id);
  } catch (err) {
    await supabase
      .from("characters")
      .update({ generation_status: "failed" })
      .eq("id", character.id);
    throw err;
  }

  revalidatePath("/default-characters");
}

export async function removeDefaultCharacter(characterId: string) {
  const supabase = createServerClient();

  const { error } = await supabase
    .from("characters")
    .update({ is_default: false, default_gender: null })
    .eq("id", characterId);

  if (error) throw new Error(error.message);

  revalidatePath("/default-characters");
}
