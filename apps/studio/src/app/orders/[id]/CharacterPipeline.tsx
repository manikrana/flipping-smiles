"use client";

import { useState } from "react";
import { CharacterRegenerateButton } from "./CharacterRegenerateButton";

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={onClose}>
      <img src={url} alt="Preview" className="max-w-lg w-full rounded-2xl shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 text-white text-2xl leading-none">✕</button>
    </div>
  );
}

function ExpandableThumbnail({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      {expanded && <Lightbox url={src} onClose={() => setExpanded(false)} />}
      <div className="relative group cursor-pointer" onClick={() => setExpanded(true)}>
        <img src={src} alt={alt} className={className} />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors rounded-lg flex items-center justify-center">
          <span className="text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">⤢</span>
        </div>
      </div>
    </>
  );
}

export function CharacterPipeline({
  characterId,
  sourceImageUrl,
  cartoonImageUrl,
  sheetUrl,
  isDefault,
}: {
  characterId: string;
  sourceImageUrl: string | null;
  cartoonImageUrl: string | null;
  sheetUrl: string | null;
  isDefault: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h2 className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-3">Character pipeline</h2>
      <div className="flex items-center gap-4 flex-wrap">
        {sourceImageUrl && (
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-1.5">Photo</p>
            <ExpandableThumbnail src={sourceImageUrl} alt="Source" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
          </div>
        )}
        {sourceImageUrl && <div className="text-gray-300">→</div>}
        <div className="text-center">
          <p className="text-xs text-gray-400 mb-1.5">Cartoon</p>
          {cartoonImageUrl ? (
            <ExpandableThumbnail src={cartoonImageUrl} alt="Cartoon" className="w-16 h-16 object-cover rounded-lg border border-brand-200" />
          ) : (
            <div className="w-16 h-16 rounded-lg border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-xs text-gray-400">—</div>
          )}
        </div>
        <div className="text-gray-300">→</div>
        <div className="text-center">
          <p className="text-xs text-gray-400 mb-1.5">Sheet</p>
          {sheetUrl ? (
            <ExpandableThumbnail src={sheetUrl} alt="Sheet" className="h-16 object-contain rounded-lg border border-brand-200" />
          ) : (
            <div className="w-16 h-16 rounded-lg border border-dashed border-red-200 bg-red-50 flex items-center justify-center text-xs text-red-400 font-medium">Missing</div>
          )}
        </div>
        {sourceImageUrl && (
          <div className="ml-auto">
            <CharacterRegenerateButton
              characterId={characterId}
              sourceImageUrl={sourceImageUrl}
              hasSheet={!!sheetUrl}
            />
          </div>
        )}
      </div>
    </div>
  );
}
