"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { TextPanelBg, TextStyle } from "@/lib/supabase/types";

export async function saveEndpaperSettings(
  storyId: string,
  data: {
    front_endpaper_bg?: TextPanelBg | null;
    front_endpaper_text?: string | null;
    front_endpaper_text_style?: TextStyle | null;
    back_endpaper_bg?: TextPanelBg | null;
    back_endpaper_text?: string | null;
    back_endpaper_text_style?: TextStyle | null;
    back_endpaper_qr_url?: string | null;
  }
) {
  const supabase = createServerClient();
  const { error } = await supabase.from("stories").update(data).eq("id", storyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stories/${storyId}`);
}
