"use client";

import { useState, useTransition, useCallback } from "react";
import { saveCharacter, deleteCharacter, deleteCharacterReference, cloneCharacter } from "./actions";
import { generateCharacterSheet } from "./sheet/actions";
import { buildSystemInstruction, buildSheetUserParts } from "./sheet/prompt";
import { EnhancePrompt } from "@/components/EnhancePrompt";
import { getStyle, DEFAULT_STYLE } from "@/lib/styles";
import type { CastCharacterRow, CastCharacterReferenceRow } from "@/lib/supabase/types";

interface Props {
  character?: CastCharacterRow;
  references?: Pick<CastCharacterReferenceRow, "id" | "image_url" | "view" | "created_at">[];
  initialName?: string;
  primaryCharacter?: { id: string; name: string; sheet_url: string | null } | null;
}

export function CharacterEditor({
  character,
  references: initialReferences = [],
  initialName,
  primaryCharacter = null,
}: Props) {
  const [, startTransition] = useTransition();
  const [name, setName] = useState(character?.name ?? initialName ?? "");
  const [description, setDescription] = useState(character?.description ?? "");
  const [references, setReferences] = useState(initialReferences);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(!character);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const isClone = !!character?.cloned_from_id;
  const sheets = references.filter((r) => r.view === "sheet");
  const [copied, setCopied] = useState(false);

  const GPT_CONTEXT_STANDARD = `You are helping write character descriptions for Flipping Smiles — a children's book personalization platform. These descriptions are sent to Gemini to generate a Pixar 3D character reference sheet (4 views: front, 3/4, side, back).

WHAT GEMINI NEEDS:
A precise, purely visual description. No personality, backstory, or narrative.
Every word should describe something the eye can see.
Pixar 3D style is applied automatically — don't describe the art style.

FOR A STANDARD CHARACTER — describe all of:
  • Age and body type (e.g. "energetic 8-year-old boy, lean build")
  • Skin tone (e.g. "warm medium-brown skin")
  • Face (shape, eye color/size, nose, expression)
  • Hair (color, texture, length, style)
  • Visual anchor — one unmistakable feature (glasses, birthmark, gap teeth, etc.)
  • Clothing — specific outfit with colors and materials
  • Any accessories

FORMAT:
Write as a single dense paragraph. Be concrete and specific.
Use exact color names (royal blue, warm ochre, deep crimson).
Avoid vague words like "beautiful", "nice", "traditional".

When I give you a character idea, output the description in the correct format.`;

  const GPT_CONTEXT_CLONE = `You are helping write clothing descriptions for Flipping Smiles — a children's book personalization platform. The character's face, hair, and body are already defined by a primary character sheet. Only the outfit changes.

WHAT GEMINI NEEDS:
A description of the NEW clothing and accessories only.
Do NOT describe the face, hair, or body — those are inherited from the primary character.
Pixar 3D style is applied automatically.

DESCRIBE ONLY:
  • The outfit (garment names, colors, fabric, style, fit)
  • Footwear
  • Accessories (jewellery, bag, hat, etc.)

FORMAT:
Write as a single dense paragraph. Be concrete and specific.
Use exact color names (royal blue, warm ochre, deep crimson).
Start with "Now wearing…" or "Dressed in…"

When I give you an outfit idea, output the clothing description in the correct format.`;

  const handleCopyGptContext = useCallback(() => {
    const text = isClone ? GPT_CONTEXT_CLONE : GPT_CONTEXT_STANDARD;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [isClone]);
  const latestSheet = sheets[sheets.length - 1];

  const style = getStyle(DEFAULT_STYLE);
  const systemPromptText = buildSystemInstruction();
  const specsPreview = buildSheetUserParts({
    characterName: name || "[name]",
    characterDescription: description || "[description]",
    styleInstruction: style.sheetStyleInstruction,
    isClone,
    primaryName: primaryCharacter?.name ?? null,
    generationToken: "auto-assigned",
  });

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  function handleSave() {
    if (!name.trim() || !description.trim()) { setError("Name and description are required"); return; }
    setError(null);
    setSaving(true);
    startTransition(async () => {
      try {
        await saveCharacter(character?.id ?? null, { name, description, reference_model: "nano-banana" });
        setDirty(false);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    });
  }

  function handleClone() {
    if (!character) return;
    setCloning(true);
    startTransition(async () => {
      try {
        await cloneCharacter(character.id);
      } catch (e) {
        setError((e as Error).message);
        setCloning(false);
      }
    });
  }

  function handleDelete() {
    if (!character || !confirm(`Delete "${character.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      try { await deleteCharacter(character.id); }
      catch (e) { setError((e as Error).message); }
    });
  }

  function handleGenerateSheet() {
    if (!character?.id) { setError("Save the character first"); return; }
    if (!description.trim()) { setError("Add a description first"); return; }
    if (dirty) { setError("Save changes before generating"); return; }
    setError(null);
    setGenerating(true);
    startTransition(async () => {
      try {
        const { imageUrl } = await generateCharacterSheet(character.id);
        setReferences((prev) => [
          ...prev.filter((r) => r.view !== "sheet"),
          { id: crypto.randomUUID(), image_url: imageUrl, view: "sheet" as const, created_at: new Date().toISOString() },
        ]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setGenerating(false);
      }
    });
  }

  function handleDeleteSheet(referenceId: string) {
    if (!character?.id) return;
    setReferences((prev) => prev.filter((r) => r.id !== referenceId));
    startTransition(async () => {
      try { await deleteCharacterReference(character.id, referenceId); }
      catch (e) { setError((e as Error).message); }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* ── Lightbox ─────────────────────────────────────────── */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setLightboxUrl(null)}>
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxUrl} alt="Sheet" className="w-full rounded-xl shadow-2xl" />
            <button onClick={() => setLightboxUrl(null)}
              className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 text-white w-8 h-8 rounded-full flex items-center justify-center text-lg">×</button>
          </div>
        </div>
      )}

      {/* ── Prompt builder ───────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Generation prompt</h3>
            <p className="text-xs text-gray-400 mt-0.5">Everything below is sent to Gemini when you generate the sheet.</p>
          </div>
          {character && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleClone}
                disabled={cloning || dirty}
                title={dirty ? "Save changes before cloning" : "Create a clone with different clothing"}
                className="px-3 py-1.5 rounded-lg border border-purple-200 text-purple-600 hover:bg-purple-50 text-xs font-medium transition-colors disabled:opacity-40"
              >
                {cloning ? "Cloning…" : "🔀 Clone"}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-xs font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* ── Section: System instructions ─────────────────── */}
        <div className="border-b border-gray-100">
          <button
            onClick={() => setShowSystemPrompt((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Specifications</span>
              <span className="text-xs text-gray-400">— style, layout, background, scale (sent first to Gemini)</span>
            </div>
            <span className="text-xs text-gray-400">{showSystemPrompt ? "Hide ▲" : "Show ▼"}</span>
          </button>
          {showSystemPrompt && (
            <pre className="px-5 pb-4 text-[11px] leading-relaxed text-gray-500 font-mono whitespace-pre-wrap bg-gray-50 border-t border-gray-100">
              {specsPreview[0]}
            </pre>
          )}
        </div>

        {/* ── Section: Identity reference (clones only) ────── */}
        {isClone && (
          <div className="border-b border-gray-100 px-5 py-4 space-y-3 bg-purple-50/40">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest text-purple-500 uppercase">Identity reference</span>
              <span className="text-xs text-gray-400">— image passed to Gemini as the face/body anchor</span>
            </div>

            {primaryCharacter ? (
              <>
                <div className="flex items-start gap-4">
                  {/* Thumbnail */}
                  <div className="shrink-0 w-32 rounded-lg overflow-hidden border border-purple-200 bg-white">
                    {primaryCharacter.sheet_url ? (
                      <img
                        src={primaryCharacter.sheet_url}
                        alt={primaryCharacter.name}
                        className="w-full object-contain cursor-pointer"
                        onClick={() => primaryCharacter?.sheet_url && setLightboxUrl(primaryCharacter.sheet_url)}
                      />
                    ) : (
                      <div className="h-20 flex items-center justify-center text-xs text-gray-400 text-center p-2">
                        No sheet yet for primary
                      </div>
                    )}
                  </div>

                  {/* Lock rules */}
                  <div className="flex-1 space-y-2 text-xs">
                    <p className="font-medium text-gray-600">
                      Source: <a href={`/characters/${primaryCharacter.id}`} className="text-brand-600 hover:underline">{primaryCharacter.name}</a>
                    </p>
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 space-y-0.5">
                      <p className="font-semibold text-green-700 text-[11px] uppercase tracking-wide">Preserve exactly</p>
                      <p className="text-green-700">Face · Skin tone · Eye color &amp; shape · Hair color, texture &amp; style · Body type &amp; proportions · Age</p>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
                      <p className="font-semibold text-red-700 text-[11px] uppercase tracking-wide">⚠️ Ignore completely</p>
                      <p className="text-red-700">Clothing · Outfit · Accessories tied to the outfit</p>
                    </div>
                  </div>
                </div>

                {!primaryCharacter.sheet_url && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    The primary character has no sheet yet. Generate one first for best clone results.{" "}
                    <a href={`/characters/${primaryCharacter.id}`} className="underline font-medium">Go to {primaryCharacter.name} →</a>
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400 italic">Primary character not found.</p>
            )}
          </div>
        )}

        {/* ── Section: Character ───────────────────────────── */}
        <div className="border-b border-gray-100 px-5 py-4 space-y-4">
          <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Character</span>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Name <span className="text-gray-400 font-normal">(also used as the sheet header label)</span>
            </label>
            <input
              value={name}
              onChange={(e) => markDirty(setName)(e.target.value)}
              placeholder="Diwali Boy Hero, Captain Nora, The Dragon…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {name.trim() && (
              <p className="text-[11px] text-gray-400 mt-1">
                Sheet label will read: <span className="font-mono font-semibold text-gray-600">"{name.toUpperCase()}"</span>
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-gray-500">
                Description
                {isClone && <span className="text-purple-600 font-normal ml-1">— focus on clothing changes only</span>}
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyGptContext}
                  className="text-[11px] text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded px-2 py-0.5 transition-colors"
                  title="Copy prompt context for ChatGPT / Claude"
                >
                  {copied ? "✓ Copied!" : "Copy GPT context"}
                </button>
                {description.trim() && (
                  <EnhancePrompt type="character" currentValue={description} onApply={(v) => markDirty(setDescription)(v)} />
                )}
              </div>
            </div>
            <textarea
              value={description}
              onChange={(e) => markDirty(setDescription)(e.target.value)}
              rows={5}
              placeholder={
                isClone
                  ? "Describe the new outfit only — face, hair, and body come from the identity reference above.\ne.g. now wearing a royal blue silk kurta with gold embroidery, cream churidar trousers, and brown juttis"
                  : "Describe the full character — face, hair, body type, skin tone, clothing, and any distinctive features.\ne.g. an energetic 8-year-old Indian boy, warm brown skin, short dark hair, large expressive brown eyes, wearing a royal blue silk kurta"
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              {isClone
                ? "Pixar 3D style and identity are inherited from the primary character — describe clothing and accessories only."
                : "Pixar 3D style is applied automatically. Be specific about face, skin, hair, clothing, and any visual anchors (glasses, birthmarks, etc.)."}
            </p>
          </div>
        </div>

        {/* ── Section: Task (auto-generated preview) ───────── */}
        <div className="px-5 py-4 bg-gray-50 space-y-2">
          <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Task</span>
          <p className="text-[11px] text-gray-400">Auto-generated from the fields above — not editable.</p>
          <pre className="text-[11px] leading-relaxed text-gray-500 font-mono whitespace-pre-wrap">
            {specsPreview[specsPreview.length - 1]}
          </pre>
        </div>

        {/* ── Save + Generate ──────────────────────────────── */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-3">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              {saving ? "Saving…" : character ? "Save changes" : "Create character"}
            </button>
          )}

          {character?.id && !dirty && (
            <button
              onClick={handleGenerateSheet}
              disabled={generating || !description.trim()}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              {generating && <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />}
              {generating ? "Generating sheet…" : latestSheet ? "Regenerate sheet" : "Generate sheet"}
            </button>
          )}

          {character?.id && dirty && (
            <p className="text-xs text-amber-600">Save changes before generating</p>
          )}
        </div>
      </div>

      {/* ── Sheet result ─────────────────────────────────────── */}
      {character?.id && sheets.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Sheet result</h3>
            {latestSheet && (
              <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                ✓ Ready for scene generation
              </span>
            )}
          </div>
          {sheets.map((sheet, i) => (
            <div key={sheet.id} className="relative group rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
              <img
                src={`${sheet.image_url}?t=${sheet.created_at}`}
                alt={`Sheet ${i + 1}`}
                className="w-full object-contain cursor-pointer"
                onClick={() => setLightboxUrl(sheet.image_url)}
              />
              <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                {i === sheets.length - 1 ? "Latest" : `Sheet ${i + 1}`}
              </div>
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button onClick={() => setLightboxUrl(sheet.image_url)}
                  className="text-xs bg-white text-gray-800 font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100">Expand</button>
                <button onClick={() => handleDeleteSheet(sheet.id)}
                  className="text-xs bg-white text-red-600 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50">Remove</button>
              </div>
            </div>
          ))}
          {generating && (
            <div className="h-40 rounded-xl bg-gray-50 border-2 border-dashed border-blue-200 flex flex-col items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-blue-400">Generating…</span>
            </div>
          )}
        </div>
      )}

      {character?.id && sheets.length === 0 && !generating && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl h-32 flex items-center justify-center text-sm text-gray-400">
          No sheet yet — fill in the prompt above and hit Generate
        </div>
      )}
    </div>
  );
}
