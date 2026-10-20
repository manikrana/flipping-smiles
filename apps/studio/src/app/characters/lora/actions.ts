"use server";

import Replicate from "replicate";
import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Lazy so importing this module doesn't risk throwing at build/import time
// (Next collects route data at build time, evaluating this module even
// though no request is being served then).
let cachedReplicate: Replicate | null = null;
function getReplicate(): Replicate {
  if (!cachedReplicate) cachedReplicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  return cachedReplicate;
}

const REPLICATE_USERNAME = "roitt";
const TRAINER_VERSION = "26dce37af90b9d997eeb970d92e47de3064d46c300504ae376c75bef6a9022d2";
const TRAINING_STEPS = 1000;

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBuffer(files: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const size = file.data.length;

    const lfh = Buffer.alloc(30 + name.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(0, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18);
    lfh.writeUInt32LE(size, 22);
    lfh.writeUInt16LE(name.length, 26);
    lfh.writeUInt16LE(0, 28);
    name.copy(lfh, 30);

    const cdh = Buffer.alloc(46 + name.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(size, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    name.copy(cdh, 46);

    localParts.push(lfh, file.data);
    centralHeaders.push(cdh);
    offset += lfh.length + size;
  }

  const cdSize = centralHeaders.reduce((sum, b) => sum + b.length, 0);
  const eocdr = Buffer.alloc(22);
  eocdr.writeUInt32LE(0x06054b50, 0);
  eocdr.writeUInt16LE(0, 4);
  eocdr.writeUInt16LE(0, 6);
  eocdr.writeUInt16LE(files.length, 8);
  eocdr.writeUInt16LE(files.length, 10);
  eocdr.writeUInt32LE(cdSize, 12);
  eocdr.writeUInt32LE(offset, 16);
  eocdr.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralHeaders, eocdr]);
}

function triggerWordFor(characterId: string): string {
  return `CHAR${characterId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

// Unique model name per training run — avoids ever needing to change visibility on an existing model
function newModelName(characterId: string): string {
  return `kitabee-c${characterId.slice(0, 6)}-${Date.now().toString(36).slice(-5)}`;
}

export async function startLoraTraining(characterId: string) {
  const supabase = createServerClient();

  const { data: character, error } = await supabase
    .from("cast_characters")
    .select("name")
    .eq("id", characterId)
    .single();

  if (error || !character) throw new Error("Character not found");

  const { data: refs } = await supabase
    .from("cast_character_references")
    .select("image_url")
    .eq("character_id", characterId)
    .order("created_at");

  if (!refs?.length) throw new Error("Generate at least one reference image first");

  const files = await Promise.all(
    refs.map(async (ref, i) => {
      const res = await fetch(ref.image_url);
      if (!res.ok) throw new Error(`Could not fetch reference image ${i + 1}`);
      const data = Buffer.from(await res.arrayBuffer());
      const ext = ref.image_url.match(/\.(png|jpg|jpeg|webp)/i)?.[1] ?? "webp";
      return { name: `character_${String(i + 1).padStart(2, "0")}.${ext}`, data };
    })
  );
  const zipBuffer = createZipBuffer(files);

  const zipPath = `lora-training/${characterId}/training.zip`;
  const { error: uploadError } = await supabase.storage
    .from("assets")
    .upload(zipPath, zipBuffer, { contentType: "application/zip", upsert: true });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: { publicUrl } } = supabase.storage.from("assets").getPublicUrl(zipPath);

  const trigger = triggerWordFor(characterId);
  const name = newModelName(characterId);
  const destination = `${REPLICATE_USERNAME}/${name}` as `${string}/${string}`;

  console.log(`[lora] creating public model ${destination}`);
  await getReplicate().models.create(REPLICATE_USERNAME, name, {
    visibility: "public",
    hardware: "gpu-a100-large",
    description: `LoRA for Kitabee character ${characterId}`,
  });
  console.log(`[lora] model created`);

  console.log(`[lora] starting training for character ${characterId}, trigger=${trigger}, destination=${destination}`);
  const training = await getReplicate().trainings.create(
    "ostris",
    "flux-dev-lora-trainer",
    TRAINER_VERSION,
    {
      destination,
      input: {
        input_images: publicUrl,
        trigger_word: trigger,
        steps: TRAINING_STEPS,
        autocaption: true,
        autocaption_prefix: `${trigger}, `,
      },
    }
  );

  console.log(`[lora] training started: id=${training.id} status=${training.status}`);

  // Store lora_url now so pollLoraTraining can read it back without reconstructing the model name
  await supabase
    .from("cast_characters")
    .update({
      lora_status: "training",
      lora_url: `${REPLICATE_USERNAME}/${name}`,
      trigger_word: trigger,
      lora_training_id: training.id,
    })
    .eq("id", characterId);

  revalidatePath(`/characters/${characterId}`);
  return { trainingId: training.id };
}

export async function resetLoraStatus(characterId: string) {
  const supabase = createServerClient();
  await supabase
    .from("cast_characters")
    .update({ lora_status: "none", lora_training_id: null })
    .eq("id", characterId);
  revalidatePath(`/characters/${characterId}`);
}

export async function checkTrainingStatuses(
  jobs: { characterId: string; trainingId: string }[]
): Promise<{ characterId: string; status: "training" | "ready" | "failed" }[]> {
  return Promise.all(
    jobs.map(async ({ characterId, trainingId }) => {
      const result = await pollLoraTraining(characterId, trainingId);
      return { characterId, status: result.status };
    })
  );
}

export async function pollLoraTraining(
  characterId: string,
  trainingId: string
): Promise<{ status: "training" | "ready" | "failed"; loraUrl?: string }> {
  const supabase = createServerClient();
  const training = await getReplicate().trainings.get(trainingId);

  console.log(`[lora] poll trainingId=${trainingId} status=${training.status} error=${JSON.stringify(training.error ?? null)}`);

  if (training.status === "succeeded") {
    // lora_url was stored at training start — just mark ready
    const { data: char } = await supabase
      .from("cast_characters")
      .select("lora_url")
      .eq("id", characterId)
      .single();
    const loraUrl = char?.lora_url ?? "";
    console.log(`[lora] training succeeded, loraUrl=${loraUrl}`);
    await supabase
      .from("cast_characters")
      .update({ lora_status: "ready" })
      .eq("id", characterId);
    revalidatePath(`/characters/${characterId}`);
    return { status: "ready", loraUrl };
  }

  if (training.status === "failed" || training.status === "canceled") {
    await supabase
      .from("cast_characters")
      .update({ lora_status: "failed" })
      .eq("id", characterId);
    revalidatePath(`/characters/${characterId}`);
    return { status: "failed" };
  }

  return { status: "training" };
}
