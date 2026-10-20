import { createServerClient } from "@/lib/supabase/server";
import { signAssets } from "@/lib/supabase/assets";
import { NewDefaultCharacterForm } from "./NewDefaultCharacterForm";
import { DefaultCharacterCard } from "./DefaultCharacterCard";

export const dynamic = "force-dynamic";

export default async function DefaultCharactersPage() {
  const supabase = createServerClient();

  const { data: characters } = await supabase
    .from("characters")
    .select("id, cartoon_image_url, sheet_url, generation_status, default_gender")
    .eq("is_default", true)
    .order("default_gender", { ascending: true });

  const paths = (characters ?? []).flatMap((c) => [c.cartoon_image_url, c.sheet_url]).filter((p): p is string => !!p);
  const signedMap = await signAssets(supabase, paths);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Default Characters</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Ready-made characters customers can choose instead of uploading a photo. Shown in the storefront chooser by gender.
        </p>
      </div>

      <div className="mb-6">
        <NewDefaultCharacterForm />
      </div>

      {(!characters || characters.length === 0) && (
        <div className="text-center py-20 text-gray-400">
          No default characters yet. Create one above.
        </div>
      )}

      <div className="space-y-4">
        {characters?.map((c) => (
          <DefaultCharacterCard
            key={c.id}
            characterId={c.id}
            cartoonImageUrl={c.cartoon_image_url ? (signedMap[c.cartoon_image_url] ?? null) : null}
            sheetUrl={c.sheet_url ? (signedMap[c.sheet_url] ?? null) : null}
            generationStatus={c.generation_status}
            defaultGender={c.default_gender as "boy" | "girl"}
          />
        ))}
      </div>
    </div>
  );
}
