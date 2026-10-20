"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function togglePageCharacter(
  storyId: string,
  pageId: string,
  characterId: string,
  add: boolean
) {
  const supabase = createServerClient();

  if (add) {
    const { error } = await supabase
      .from("page_cast")
      .upsert({ page_id: pageId, character_id: characterId });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("page_cast")
      .delete()
      .eq("page_id", pageId)
      .eq("character_id", characterId);
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/stories/${storyId}`);
}

export async function setPageHeroCharacters(
  storyId: string,
  pageId: string,
  heroBoyCharacterId: string | null,
  heroGirlCharacterId: string | null,
) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("story_pages")
    .update({ hero_boy_character_id: heroBoyCharacterId, hero_girl_character_id: heroGirlCharacterId })
    .eq("id", pageId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}
