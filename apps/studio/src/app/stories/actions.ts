"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TextPanelBg } from "@/lib/supabase/types";

export interface PageInput {
  id?: string;
  page_number: number;
  text: string;
  scene_prompt: string;
}

export interface StoryInput {
  title: string;
  slug: string;
  description: string;
  age_min: number;
  age_max: number;
  price_usd: number;
  languages: string[];
  scene_model: "flux" | "nano-banana-pro";
  generation_style: string;
  layout_type: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
  pages: PageInput[];
}

export async function saveStory(storyId: string | null, input: StoryInput) {
  const supabase = createServerClient();

  if (storyId) {
    const { error } = await supabase
      .from("stories")
      .update({
        title: input.title,
        slug: input.slug,
        description: input.description,
        age_min: input.age_min,
        age_max: input.age_max,
        price_usd: input.price_usd,
        languages: input.languages,
        scene_model: input.scene_model,
        generation_style: input.generation_style,
        layout_type: input.layout_type,
      })
      .eq("id", storyId);

    if (error) throw new Error(error.message);

    // Upsert pages by ID so page_cast (and image_urls) are preserved.
    // Pages with an id are updated in place; new pages (no id) are inserted.
    const existingIds = input.pages.map((p) => p.id).filter(Boolean) as string[];

    // Delete pages that were removed in the editor
    if (existingIds.length > 0) {
      await supabase
        .from("story_pages")
        .delete()
        .eq("story_id", storyId)
        .not("id", "in", `(${existingIds.join(",")})`);
    } else {
      await supabase.from("story_pages").delete().eq("story_id", storyId);
    }

    for (const p of input.pages) {
      if (p.id) {
        await supabase
          .from("story_pages")
          .update({ page_number: p.page_number, text: p.text, scene_prompt: p.scene_prompt })
          .eq("id", p.id);
      } else {
        await supabase
          .from("story_pages")
          .insert({ story_id: storyId, page_number: p.page_number, text: p.text, scene_prompt: p.scene_prompt, image_url: null });
      }
    }
  } else {
    const { data: story, error } = await supabase
      .from("stories")
      .insert({
        title: input.title,
        slug: input.slug,
        description: input.description,
        age_min: input.age_min,
        age_max: input.age_max,
        price_usd: input.price_usd,
        languages: input.languages,
        generation_style: input.generation_style,
        layout_type: input.layout_type,
        cover_image_url: null,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    if (input.pages.length > 0) {
      const { error: pagesError } = await supabase.from("story_pages").insert(
        input.pages.map((p) => ({
          story_id: story.id,
          page_number: p.page_number,
          text: p.text,
          scene_prompt: p.scene_prompt,
          image_url: null,
        }))
      );
      if (pagesError) throw new Error(pagesError.message);
    }

    revalidatePath("/stories");
    redirect(`/stories/${story.id}`);
  }

  revalidatePath("/stories");
  revalidatePath(`/stories/${storyId}`);
}

export async function savePrintSettings(
  storyId: string,
  settings: {
    layout_type: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
    text_panel_bg: TextPanelBg;
    trim_size_id: string | null;
    binding_type: "hardcover" | "paperback";
    print_provider_id: string | null;
  }
) {
  const supabase = createServerClient();
  const { error } = await supabase.from("stories").update(settings).eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath("/stories");
}

export async function archiveStory(storyId: string) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ archived: true, status: "draft" })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath("/stories");
  revalidatePath(`/stories/${storyId}`);
  redirect("/stories");
}

export async function unarchiveStory(storyId: string) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ archived: false })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath("/stories");
  revalidatePath(`/stories/${storyId}`);
}

export async function saveStoryMeta(
  storyId: string,
  meta: {
    title: string; slug: string; description: string;
    age_min: number; age_max: number; price_usd: number; languages: string[];
    scene_model: "flux" | "nano-banana-pro"; generation_style: string;
    layout_type: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
    trim_size_id: string | null; binding_type: "hardcover" | "paperback";
    print_provider_id: string | null;
  }
) {
  const supabase = createServerClient();
  const { error } = await supabase.from("stories").update(meta).eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath("/stories");
  revalidatePath(`/stories/${storyId}`);
}

export async function saveStoryDetails(
  storyId: string,
  details: {
    title: string; slug: string; description: string;
    age_min: number; age_max: number; price_usd: number; languages: string[];
    scene_model: "flux" | "nano-banana-pro"; generation_style: string;
    hero_costume_description_boy: string | null;
    hero_costume_description_girl: string | null;
  }
) {
  const supabase = createServerClient();
  const { error } = await supabase.from("stories").update(details).eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath("/stories");
  revalidatePath(`/stories/${storyId}`);
}

export async function savePageContent(
  pageId: string,
  data: { text: string; scene_prompt: string; scene_prompt_girl?: string | null; continuity_reference_page_id?: string | null }
) {
  const supabase = createServerClient();
  const { error } = await supabase.from("story_pages").update(data).eq("id", pageId);
  if (error) throw new Error(error.message);
}

export async function addStoryPage(storyId: string, afterPageNumber: number) {
  const supabase = createServerClient();
  const { data: toShift } = await supabase
    .from("story_pages").select("id, page_number")
    .eq("story_id", storyId).gt("page_number", afterPageNumber)
    .order("page_number", { ascending: false });
  for (const p of (toShift ?? [])) {
    await supabase.from("story_pages").update({ page_number: p.page_number + 1 }).eq("id", p.id);
  }
  const { data: newPage, error } = await supabase
    .from("story_pages")
    .insert({ story_id: storyId, page_number: afterPageNumber + 1, text: "", scene_prompt: "" })
    .select().single();
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
  return newPage;
}

export async function deleteStoryPage(storyId: string, pageId: string) {
  const supabase = createServerClient();
  const { data: page } = await supabase.from("story_pages").select("page_number").eq("id", pageId).single();
  await supabase.from("story_pages").delete().eq("id", pageId);
  if (page) {
    const { data: remaining } = await supabase
      .from("story_pages").select("id, page_number")
      .eq("story_id", storyId).gt("page_number", page.page_number)
      .order("page_number");
    for (const p of (remaining ?? [])) {
      await supabase.from("story_pages").update({ page_number: p.page_number - 1 }).eq("id", p.id);
    }
  }
  revalidatePath(`/stories/${storyId}`);
}
