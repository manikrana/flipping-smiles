"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function addToStoryCast(storyId: string, characterId: string, sortOrder: number) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("story_cast")
    .upsert({ story_id: storyId, character_id: characterId, sort_order: sortOrder });
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}

export async function removeFromStoryCast(storyId: string, characterId: string) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("story_cast")
    .delete()
    .eq("story_id", storyId)
    .eq("character_id", characterId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}
