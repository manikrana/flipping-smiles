"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { addToStoryCast, removeFromStoryCast } from "./cast/actions";
import type { CastCharacterRow } from "@/lib/supabase/types";

interface Props {
  storyId: string;
  allCharacters: CastCharacterRow[];
  castIds: string[];
}

export function CastPicker({ storyId, allCharacters, castIds }: Props) {
  const [, startTransition] = useTransition();
  const [activeCastIds, setActiveCastIds] = useState<Set<string>>(new Set(castIds));
  const [error, setError] = useState<string | null>(null);

  function toggleCharacter(characterId: string) {
    const isIn = activeCastIds.has(characterId);
    setActiveCastIds((prev) => {
      const next = new Set(prev);
      isIn ? next.delete(characterId) : next.add(characterId);
      return next;
    });
    setError(null);
    startTransition(async () => {
      try {
        if (isIn) {
          await removeFromStoryCast(storyId, characterId);
        } else {
          await addToStoryCast(storyId, characterId, activeCastIds.size);
        }
      } catch (e) {
        setError((e as Error).message);
        // Revert
        setActiveCastIds((prev) => {
          const next = new Set(prev);
          isIn ? next.add(characterId) : next.delete(characterId);
          return next;
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-700">Cast</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Select which characters appear in this story. Their reference images will be used to keep them consistent across every scene.
          </p>
        </div>
        <Link
          href="/characters/new"
          className="text-sm text-brand-500 hover:text-brand-600 font-medium"
        >
          + New character
        </Link>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {allCharacters.length === 0 && (
        <div className="text-center py-8 text-gray-400 bg-white border border-dashed border-gray-200 rounded-xl text-sm">
          No characters in the library yet.{" "}
          <Link href="/characters/new" className="text-brand-500 hover:underline">
            Create your first character.
          </Link>
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {allCharacters.map((c) => {
          const isSelected = activeCastIds.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggleCharacter(c.id)}
              className={`relative rounded-xl overflow-hidden border-2 transition-all text-left ${
                isSelected
                  ? "border-brand-500 shadow-md"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="aspect-[3/4] bg-gray-100">
                {c.reference_url ? (
                  <img src={c.reference_url} alt={c.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-3xl">?</div>
                )}
              </div>
              <div className="p-2 bg-white">
                <p className="text-xs font-semibold truncate">{c.name}</p>
                {!c.reference_url && (
                  <p className="text-xs text-amber-500">No reference</p>
                )}
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2 w-5 h-5 bg-brand-500 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
