"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { signAssets, resolveStoragePath } from "@/lib/supabase/assets";

export type FeaturedStory = {
  id: string;
  title: string;
  cover_image_url: string | null;
};

export async function fetchPublishedStories(excludeStoryId: string): Promise<FeaturedStory[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("stories")
    .select("id, title, cover_image_url")
    .eq("status", "ready")
    .eq("archived", false)
    .neq("id", excludeStoryId)
    .order("title");

  const stories = (data ?? []) as FeaturedStory[];

  // cover_image_url is a bare private-bucket storage path -- signing is
  // required before it can be used as an <img src>, same as every other
  // asset reference in this app.
  const paths = stories.map((s) => s.cover_image_url).filter((p): p is string => !!p).map(resolveStoragePath);
  const signedMap = await signAssets(supabase, [...new Set(paths)]);

  return stories.map((s) => ({
    ...s,
    cover_image_url: s.cover_image_url ? (signedMap[resolveStoragePath(s.cover_image_url)] ?? null) : null,
  }));
}

// Website/Instagram QR targets and the leading text are no longer set here --
// QR targets are global (brand_settings), and the leading text is a prompt
// input owned by CoverEditor's "Save cover typography" (see saveCoverLayout,
// which persists it into this same back_cover_tagline column). This action
// only owns which other stories are featured on this one's back cover.
export async function saveBackCoverSettings(
  storyId: string,
  data: {
    back_cover_featured_story_ids: string[];
  }
) {
  const supabase = createServerClient();
  const { error } = await supabase.from("stories").update(data).eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}
