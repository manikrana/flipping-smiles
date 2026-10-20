"use client";

import { useTransition, useState } from "react";
import { removeDefaultCharacter } from "./actions";

interface Props {
  characterId: string;
  cartoonImageUrl: string | null;
  sheetUrl: string | null;
  generationStatus: "pending" | "processing" | "done" | "failed";
  defaultGender: "boy" | "girl";
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <img src={url} alt="Preview" className="max-w-sm w-full rounded-2xl shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 text-white text-2xl leading-none">✕</button>
    </div>
  );
}

export function DefaultCharacterCard({
  characterId,
  cartoonImageUrl,
  sheetUrl,
  generationStatus,
  defaultGender,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);

  const hasCartoon = generationStatus === "done" && cartoonImageUrl;

  function handleRemove() {
    startTransition(async () => {
      await removeDefaultCharacter(characterId);
      window.location.reload();
    });
  }

  return (
    <>
      {expanded && <Lightbox url={expanded} onClose={() => setExpanded(null)} />}

      <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-6 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 w-12">
          {defaultGender === "boy" ? "Boy" : "Girl"}
        </span>

        {/* Cartoon */}
        <div className="text-center">
          <p className="text-xs font-medium text-gray-400 mb-2">Cartoon character</p>
          <div className="relative w-24 h-24 group">
            {hasCartoon ? (
              <>
                <img src={cartoonImageUrl} alt="Cartoon" className="w-24 h-24 object-cover rounded-xl border border-brand-200" />
                <button
                  onClick={() => setExpanded(cartoonImageUrl)}
                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white text-xs font-medium"
                >
                  ⤢ Expand
                </button>
              </>
            ) : generationStatus === "processing" ? (
              <div className="w-24 h-24 rounded-xl border border-dashed border-brand-300 bg-brand-50 flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-brand-500 font-medium">Generating…</span>
              </div>
            ) : (
              <div className="w-24 h-24 rounded-xl border border-dashed border-red-200 bg-red-50 flex items-center justify-center text-xs text-red-400 text-center px-2">
                Failed
              </div>
            )}
          </div>
        </div>

        {/* Sheet */}
        {sheetUrl && (
          <>
            <div className="text-gray-300 text-2xl">→</div>
            <div className="text-center">
              <p className="text-xs font-medium text-gray-400 mb-2">Character sheet</p>
              <div className="relative group">
                <img src={sheetUrl} alt="Sheet" className="h-24 rounded-xl border border-brand-200 object-contain" />
                <button
                  onClick={() => setExpanded(sheetUrl)}
                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white text-xs font-medium"
                >
                  ⤢ Expand
                </button>
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 ml-auto">
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="text-sm border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200 font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            Remove from storefront
          </button>
        </div>
      </div>
    </>
  );
}
