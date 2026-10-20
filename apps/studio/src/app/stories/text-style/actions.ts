"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { TextStyle } from "@/lib/supabase/types";

export async function saveTextStyle(storyId: string, style: TextStyle) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("stories")
    .update({ text_style: style })
    .eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}
