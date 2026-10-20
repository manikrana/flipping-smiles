import { createServerClient } from "@/lib/supabase/server";
import { signAssets } from "@/lib/supabase/assets";
import { notFound } from "next/navigation";
import { StoryEditorV2 } from "../StoryEditorV2";

export const dynamic = "force-dynamic";

export default async function EditStoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const [
    { data: story, error },
    { data: pages },
    { data: allCharacters },
    { data: trimSizes },
    { data: printProviders },
  ] = await Promise.all([
    supabase.from("stories").select("*").eq("id", id).single(),
    supabase.from("story_pages").select("*").eq("story_id", id).order("page_number"),
    supabase.from("cast_characters").select("*").order("name"),
    supabase.from("print_provider_trim_sizes").select("*").order("created_at"),
    supabase.from("print_providers").select("*").order("name"),
  ]);

  if (error || !story) notFound();

  // Sign all asset paths in pages and characters before passing to client components
  const sheetPaths = (allCharacters ?? []).map((c) => c.sheet_url).filter((p): p is string => !!p);
  const pageImagePaths = (pages ?? []).flatMap((p) => [p.image_url, p.image_url_girl, p.text_image_url, p.text_bg_url]).filter((p): p is string => !!p);
  const coverPaths = [story.cover_image_url, story.cover_image_url_girl, story.cover_swap_template_url, story.brand_page_image_url, story.end_page_image_url].filter((p): p is string => !!p);
  const allPaths = [...new Set([...sheetPaths, ...pageImagePaths, ...coverPaths])];
  const signedMap = await signAssets(supabase, allPaths);

  const signedStory = {
    ...story,
    cover_image_url: story.cover_image_url ? (signedMap[story.cover_image_url] ?? story.cover_image_url) : null,
    cover_image_url_girl: story.cover_image_url_girl ? (signedMap[story.cover_image_url_girl] ?? story.cover_image_url_girl) : null,
    cover_swap_template_url: story.cover_swap_template_url ? (signedMap[story.cover_swap_template_url] ?? story.cover_swap_template_url) : null,
    brand_page_image_url: story.brand_page_image_url ? (signedMap[story.brand_page_image_url] ?? story.brand_page_image_url) : null,
    end_page_image_url: story.end_page_image_url ? (signedMap[story.end_page_image_url] ?? story.end_page_image_url) : null,
  };

  const signedCharacters = (allCharacters ?? []).map((c) => ({
    ...c,
    sheet_url: c.sheet_url ? (signedMap[c.sheet_url] ?? c.sheet_url) : null,
  }));

  const signedPages = (pages ?? []).map((p) => ({
    ...p,
    image_url: p.image_url ? (signedMap[p.image_url] ?? p.image_url) : null,
    image_url_girl: p.image_url_girl ? (signedMap[p.image_url_girl] ?? p.image_url_girl) : null,
    text_image_url: p.text_image_url ? (signedMap[p.text_image_url] ?? p.text_image_url) : null,
    text_bg_url: p.text_bg_url ? (signedMap[p.text_bg_url] ?? p.text_bg_url) : null,
  }));

  const pageIds = (pages ?? []).map((p) => p.id);
  const { data: pageCastRows } = pageIds.length > 0
    ? await supabase.from("page_cast").select("page_id, character_id").in("page_id", pageIds)
    : { data: [] };

  const pageCastMap: Record<string, string[]> = {};
  for (const row of pageCastRows ?? []) {
    if (!pageCastMap[row.page_id]) pageCastMap[row.page_id] = [];
    pageCastMap[row.page_id].push(row.character_id);
  }

  return (
    <StoryEditorV2
      story={signedStory}
      pages={signedPages}
      allCharacters={signedCharacters}
      initialPageCast={pageCastMap}
      trimSizes={trimSizes ?? []}
      printProviders={printProviders ?? []}
    />
  );
  // Note: allCharacters is passed to StoryEditorV2 which passes it to StoryInfoPanel for hero picker
}
