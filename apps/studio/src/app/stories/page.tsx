import { createServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { StoriesList, type StoryItem } from "./StoriesList";

export const dynamic = "force-dynamic";

export default async function StoriesPage() {
  const supabase = createServerClient();

  const { data: rawStories, error } = await supabase
    .from("stories")
    .select("id, title, slug, age_min, age_max, price_usd, languages, status, archived, story_pages(count)")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-red-500">Failed to load stories: {error.message}</p>;
  }

  const stories: StoryItem[] = ((rawStories ?? []) as unknown as {
    id: string;
    title: string;
    slug: string;
    age_min: number;
    age_max: number;
    price_usd: number;
    languages: string[];
    status: string;
    archived: boolean;
    story_pages: { count: number }[];
  }[]).map((s) => ({
    id: s.id,
    title: s.title,
    slug: s.slug,
    age_min: s.age_min,
    age_max: s.age_max,
    price_usd: s.price_usd,
    languages: s.languages,
    status: s.status,
    archived: s.archived ?? false,
    page_count: s.story_pages?.[0]?.count ?? 0,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Stories</h1>
        <Link
          href="/stories/new"
          className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
        >
          + New story
        </Link>
      </div>

      <StoriesList stories={stories} />
    </div>
  );
}
