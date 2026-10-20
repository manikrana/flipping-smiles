"use server";

import { createServerClient } from "@/lib/supabase/server";
import { signAsset } from "@/lib/supabase/assets";
import { revalidatePath } from "next/cache";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "@/lib/supabase/types";
import { compositeTextOntoImage, resolveFontPath } from "@/lib/composite";

export async function compositeTextOnPages(
  storyId: string,
  pageIds?: string[],
  style?: TextStyle
): Promise<{ pageId: string; textImageUrl: string }[]> {
  const supabase = createServerClient();

  let query = supabase
    .from("story_pages")
    .select("id, text, image_url, page_number, vertical_align")
    .eq("story_id", storyId)
    .eq("image_approved", true)
    .not("image_url", "is", null)
    .order("page_number");

  if (pageIds?.length) query = query.in("id", pageIds);

  const { data: pages, error } = await query;
  if (error || !pages?.length) throw new Error("No approved pages found");

  const resolvedStyle = style ?? (await (async () => {
    const { data: story } = await supabase.from("stories").select("text_style").eq("id", storyId).single();
    return (story?.text_style as TextStyle | null) ?? DEFAULT_TEXT_STYLE;
  })());

  const fontPath = await resolveFontPath(resolvedStyle.fontFamily);

  const results = await Promise.all(
    pages.map(async (page) => {
      const signedImageUrl = await signAsset(supabase, page.image_url!);
      const vAlign = ((page as unknown as { vertical_align: string | null }).vertical_align ?? "bottom") as "top" | "center" | "bottom";
      const composited = await compositeTextOntoImage(signedImageUrl, page.text, resolvedStyle, fontPath, vAlign);

      const storagePath = `text-images/${page.id}/composited.webp`;
      const { error: uploadError } = await supabase.storage
        .from("assets")
        .upload(storagePath, composited, { contentType: "image/webp", upsert: true });
      if (uploadError) throw new Error(`Upload failed for page ${page.page_number}: ${uploadError.message}`);

      await supabase.from("story_pages").update({ text_image_url: storagePath }).eq("id", page.id);
      const textImageUrl = await signAsset(supabase, storagePath);
      return { pageId: page.id, textImageUrl };
    })
  );

  revalidatePath(`/stories/${storyId}`);
  return results;
}

export async function compositePageText(
  storyId: string,
  pageId: string,
  style?: TextStyle
): Promise<{ textImageUrl: string }> {
  const supabase = createServerClient();
  const { data: page, error } = await supabase
    .from("story_pages").select("id, text, image_url, page_number, vertical_align").eq("id", pageId).single();
  if (error || !page) throw new Error("Page not found");
  if (!page.image_url) throw new Error("Generate an image first");

  const resolvedStyle = style ?? (await (async () => {
    const { data: story } = await supabase.from("stories").select("text_style").eq("id", storyId).single();
    return (story?.text_style as TextStyle | null) ?? DEFAULT_TEXT_STYLE;
  })());

  const fontPath = await resolveFontPath(resolvedStyle.fontFamily);
  const signedImageUrl = await signAsset(supabase, page.image_url);
  const vAlign = ((page as unknown as { vertical_align: string | null }).vertical_align ?? "bottom") as "top" | "center" | "bottom";
  const composited = await compositeTextOntoImage(signedImageUrl, page.text, resolvedStyle, fontPath, vAlign);
  const storagePath = `text-images/${pageId}/composited.webp`;
  const { error: uploadError } = await supabase.storage
    .from("assets").upload(storagePath, composited, { contentType: "image/webp", upsert: true });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  await supabase.from("story_pages").update({ text_image_url: storagePath }).eq("id", pageId);
  const textImageUrl = await signAsset(supabase, storagePath);
  revalidatePath(`/stories/${storyId}`);
  return { textImageUrl };
}
