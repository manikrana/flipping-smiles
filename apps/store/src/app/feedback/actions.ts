"use server";

import { createServerClient } from "@/lib/supabase/server";

export async function uploadFeedbackImage(file: File): Promise<string | null> {
  const supabase = createServerClient();
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `feedback/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from("assets")
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (error) return null;
  const { data: signed } = await supabase.storage.from("assets").createSignedUrl(path, 3600);
  return signed?.signedUrl ?? null;
}

export async function submitFeedback(data: {
  type: "bug" | "feature";
  title: string;
  description: string;
  url?: string;
  image_url?: string | null;
}) {
  const supabase = createServerClient();
  await supabase.from("feedback").insert({
    site: "store",
    type: data.type,
    title: data.title,
    description: data.description,
    url: data.url ?? null,
    image_url: data.image_url ?? null,
  });
}
