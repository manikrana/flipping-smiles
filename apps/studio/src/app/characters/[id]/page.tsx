import { createServerClient } from "@/lib/supabase/server";
import { signAssets } from "@/lib/supabase/assets";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CharacterEditor } from "../CharacterEditor";

export const dynamic = "force-dynamic";

export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const [{ data: character }, { data: stories }, { data: references }] = await Promise.all([
    supabase.from("cast_characters").select("*").eq("id", id).single(),
    supabase.from("story_cast").select("story_id, stories ( id, title )").eq("character_id", id),
    supabase
      .from("cast_character_references")
      .select("id, image_url, view, created_at")
      .eq("character_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!character) notFound();

  // For clones — fetch the primary character so the editor can show its sheet as identity reference
  let primaryCharacter: { id: string; name: string; sheet_url: string | null } | null = null;
  if (character.cloned_from_id) {
    const { data: primary } = await supabase
      .from("cast_characters")
      .select("id, name, sheet_url")
      .eq("id", character.cloned_from_id)
      .single();
    primaryCharacter = primary ?? null;
  }

  // Sign all asset paths before passing to client
  const pathsToSign = [
    character.reference_url,
    character.sheet_url,
    primaryCharacter?.sheet_url,
    ...(references ?? []).map((r) => r.image_url),
  ].filter((p): p is string => !!p);
  const signedMap = await signAssets(supabase, [...new Set(pathsToSign)]);
  const s = (p: string | null | undefined) => (p ? (signedMap[p] ?? p) : null);

  const signedCharacter = { ...character, reference_url: s(character.reference_url), sheet_url: s(character.sheet_url) };
  const signedReferences = (references ?? []).map((r) => ({ ...r, image_url: s(r.image_url) ?? r.image_url }));
  const signedPrimary = primaryCharacter ? { ...primaryCharacter, sheet_url: s(primaryCharacter.sheet_url) } : null;

  type StoryLink = { story_id: string; stories: { id: string; title: string } | null };
  const storyLinks = stories as unknown as StoryLink[] | null;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/characters" className="text-sm text-gray-400 hover:text-gray-600">← Characters</Link>
        <h1 className="text-2xl font-bold mt-1">{character.name}</h1>
        {storyLinks && storyLinks.length > 0 && (
          <p className="text-sm text-gray-400 mt-1">
            Appears in:{" "}
            {storyLinks.map((s, i) => (
              <span key={s.story_id}>
                {i > 0 && ", "}
                <Link href={`/stories/${s.stories?.id}`} className="text-brand-500 hover:underline">
                  {s.stories?.title}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
      <CharacterEditor
        character={signedCharacter}
        references={signedReferences}
        primaryCharacter={signedPrimary}
      />
    </div>
  );
}
