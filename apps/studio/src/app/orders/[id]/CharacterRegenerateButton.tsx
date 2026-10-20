"use client";

import { useTransition, useState } from "react";
import { startCharacterGeneration } from "../actions";

export function CharacterRegenerateButton({
  characterId,
  sourceImageUrl,
  hasSheet,
}: {
  characterId: string;
  sourceImageUrl: string;
  hasSheet: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      try {
        await startCharacterGeneration(characterId, sourceImageUrl);
        window.location.reload();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleRegenerate}
        disabled={isPending}
        className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60 transition-colors"
      >
        {isPending ? "Generating…" : hasSheet ? "↺ Regenerate all" : "✨ Generate sheet"}
      </button>
      {error && <p className="text-xs text-red-500 max-w-[180px] text-right">{error}</p>}
    </div>
  );
}
