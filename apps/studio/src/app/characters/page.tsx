import { createServerClient } from "@/lib/supabase/server";
import { signAssets } from "@/lib/supabase/assets";
import Link from "next/link";
import { TrainingPoller } from "./TrainingPoller";
import { DeleteCharacterButton } from "./DeleteCharacterButton";

export const dynamic = "force-dynamic";

export default async function CharactersPage() {
  const supabase = createServerClient();
  const { data: characters } = await supabase
    .from("cast_characters")
    .select("*")
    .order("created_at", { ascending: false });

  const refPaths = (characters ?? []).map((c) => c.reference_url).filter((p): p is string => !!p);
  const signedMap = await signAssets(supabase, refPaths);
  const signedCharacters = (characters ?? []).map((c) => ({
    ...c,
    reference_url: c.reference_url ? (signedMap[c.reference_url] ?? c.reference_url) : null,
  }));

  const trainingJobs = (characters ?? [])
    .filter((c) => c.lora_status === "training" && c.lora_training_id)
    .map((c) => ({ characterId: c.id, trainingId: c.lora_training_id! }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Characters</h1>
          <p className="text-sm text-gray-400 mt-0.5">Global library — reuse any character across multiple stories</p>
        </div>
        <Link
          href="/characters/new"
          className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
        >
          + New character
        </Link>
      </div>

      {trainingJobs.length > 0 && (
        <>
          <TrainingPoller jobs={trainingJobs} />
          <div className="mb-4 flex items-center gap-2 text-sm text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5">
            <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
            {trainingJobs.length === 1
              ? "1 character LoRA is training — this page will update automatically when it's done."
              : `${trainingJobs.length} character LoRAs are training — this page will update automatically.`}
          </div>
        </>
      )}

      {(!characters || characters.length === 0) && (
        <div className="text-center py-20 text-gray-400">
          No characters yet.{" "}
          <Link href="/characters/new" className="text-brand-500 hover:underline">
            Create your first one.
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
        {signedCharacters.map((c) => (
          <Link
            key={c.id}
            href={`/characters/${c.id}`}
            className="group bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow"
          >
            <div className="aspect-[3/4] bg-gray-100 overflow-hidden relative">
              {c.reference_url ? (
                <img
                  src={c.reference_url}
                  alt={c.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl">?</div>
              )}
              <DeleteCharacterButton id={c.id} name={c.name} />
              {c.lora_status === "training" && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-blue-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                  <span className="w-2.5 h-2.5 border border-white border-t-transparent rounded-full animate-spin" />
                  Training
                </div>
              )}
              {c.lora_status === "ready" && (
                <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                  LoRA ✓
                </div>
              )}
              {c.cloned_from_id && (
                <div className="absolute bottom-2 right-2 bg-purple-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                  🔀 Clone
                </div>
              )}
            </div>
            <div className="p-3">
              <p className="font-semibold text-sm">{c.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{c.description}</p>
              {!c.reference_url && (
                <p className="text-xs text-amber-500 mt-1">No reference image</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
