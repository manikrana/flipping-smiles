"use server";

import Replicate from "replicate";
import { createServerClient } from "@/lib/supabase/server";
import { signAsset } from "@/lib/supabase/assets";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStyle, DEFAULT_STYLE } from "@/lib/styles";

// Lazy so importing this module doesn't risk throwing at build/import time
// (Next collects route data at build time, evaluating this module even
// though no request is being served then).
let cachedReplicate: Replicate | null = null;
function getReplicate(): Replicate {
  if (!cachedReplicate) cachedReplicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  return cachedReplicate;
}

const versionCache = new Map<string, string>();
async function getLatestVersion(owner: string, name: string): Promise<string> {
  const key = `${owner}/${name}`;
  if (versionCache.has(key)) return versionCache.get(key)!;
  const model = await getReplicate().models.get(owner, name);
  if (!model.latest_version?.id) throw new Error(`No version found for ${key}`);
  versionCache.set(key, model.latest_version.id);
  return model.latest_version.id;
}

export async function saveCharacter(
  characterId: string | null,
  data: { name: string; description: string; reference_model?: "flux-1.1-pro" | "nano-banana" }
): Promise<string> {
  const supabase = createServerClient();

  if (characterId) {
    const { error } = await supabase
      .from("cast_characters")
      .update({ name: data.name, description: data.description, ...(data.reference_model ? { reference_model: data.reference_model } : {}) })
      .eq("id", characterId);
    if (error) throw new Error(error.message);
    revalidatePath("/characters");
    revalidatePath(`/characters/${characterId}`);
    return characterId;
  } else {
    const { data: row, error } = await supabase
      .from("cast_characters")
      .insert({ name: data.name, description: data.description, reference_url: null, reference_model: data.reference_model ?? "flux-1.1-pro" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/characters");
    redirect(`/characters/${row.id}`);
  }
}

export async function createCharacter(
  data: { name: string; description: string }
): Promise<{ id: string; name: string; description: string }> {
  const supabase = createServerClient();
  const { data: row, error } = await supabase
    .from("cast_characters")
    .insert({ name: data.name, description: data.description, reference_url: null, reference_model: "nano-banana" })
    .select("id, name, description")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/characters");
  return row;
}

export async function cloneCharacter(characterId: string): Promise<void> {
  const supabase = createServerClient();

  const { data: source, error } = await supabase
    .from("cast_characters")
    .select("name, description")
    .eq("id", characterId)
    .single();
  if (error || !source) throw new Error("Character not found");

  const { data: clone, error: insertError } = await supabase
    .from("cast_characters")
    .insert({
      name: `${source.name} - Clone`,
      description: source.description,
      cloned_from_id: characterId,
      reference_url: null,
      reference_model: "nano-banana",
    })
    .select("id")
    .single();
  if (insertError || !clone) throw new Error(insertError?.message ?? "Clone failed");

  revalidatePath("/characters");
  redirect(`/characters/${clone.id}`);
}

export async function deleteCharacter(characterId: string) {
  const supabase = createServerClient();
  const { error } = await supabase.from("cast_characters").delete().eq("id", characterId);
  if (error) throw new Error(error.message);
  revalidatePath("/characters");
  redirect("/characters");
}

export async function startReferenceGeneration(characterId: string) {
  const supabase = createServerClient();

  const { data: character, error } = await supabase
    .from("cast_characters")
    .select("name, description")
    .eq("id", characterId)
    .single();

  if (error || !character) throw new Error("Character not found");
  if (!character.description.trim()) throw new Error("Add a description first");

  const style = getStyle(DEFAULT_STYLE);
  const prompt =
    `${style.fluxPromptPrefix}, character reference sheet, ` +
    `${character.description}, ` +
    `full body, front facing, neutral expression, arms at sides, ` +
    `plain white background, soft even studio lighting, highly detailed, 4k`;

  const version = await getLatestVersion("black-forest-labs", "flux-1.1-pro");
  const prediction = await getReplicate().predictions.create({
    version,
    input: {
      prompt,
      aspect_ratio: "3:4",
      output_format: "webp",
      output_quality: 90,
      safety_tolerance: 3,
      prompt_upsampling: false,
    },
  });

  return { predictionId: prediction.id };
}

export async function pollReferenceGeneration(
  characterId: string,
  predictionId: string
): Promise<{ status: "processing" | "done" | "failed"; imageUrl?: string }> {
  const supabase = createServerClient();
  const prediction = await getReplicate().predictions.get(predictionId);

  if (prediction.status === "succeeded") {
    const output = prediction.output;
    const replicateUrl = Array.isArray(output) ? output[0] : output as string;

    // Download and re-upload to Supabase Storage so the URL never expires
    const res = await fetch(replicateUrl);
    if (!res.ok) throw new Error("Failed to download generated image");
    const imageData = Buffer.from(await res.arrayBuffer());
    const refId = crypto.randomUUID();
    const storagePath = `reference-images/${characterId}/${refId}.webp`;
    const { error: uploadError } = await supabase.storage
      .from("assets")
      .upload(storagePath, imageData, { contentType: "image/webp", upsert: false });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
    const [{ error: refError }] = await Promise.all([
      supabase.from("cast_character_references").insert({ character_id: characterId, image_url: storagePath }),
      supabase.from("cast_characters").update({ reference_url: storagePath }).eq("id", characterId),
    ]);
    if (refError) throw new Error(refError.message);

    revalidatePath("/characters");
    revalidatePath(`/characters/${characterId}`);
    const imageUrl = await signAsset(supabase, storagePath);
    return { status: "done", imageUrl };
  }

  if (prediction.status === "failed" || prediction.status === "canceled") {
    return { status: "failed" };
  }

  return { status: "processing" };
}

export async function deleteCharacterReference(characterId: string, referenceId: string) {
  const supabase = createServerClient();

  const { error } = await supabase
    .from("cast_character_references")
    .delete()
    .eq("id", referenceId)
    .eq("character_id", characterId);
  if (error) throw new Error(error.message);

  // If the deleted image was the display reference, update to the most recent remaining one
  const { data: remaining } = await supabase
    .from("cast_character_references")
    .select("image_url")
    .eq("character_id", characterId)
    .order("created_at", { ascending: false })
    .limit(1);

  await supabase
    .from("cast_characters")
    .update({ reference_url: remaining?.[0]?.image_url ?? null })
    .eq("id", characterId);

  revalidatePath("/characters");
  revalidatePath(`/characters/${characterId}`);
}
