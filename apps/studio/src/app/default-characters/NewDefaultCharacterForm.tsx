"use client";

import { useRef, useState, useTransition } from "react";
import { createDefaultCharacter, type Gender } from "./actions";
import { getDefaultCharacterOptions } from "./character-options";

const OPTIONS = getDefaultCharacterOptions();

export function NewDefaultCharacterForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gender, setGender] = useState<Gender>("boy");
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createDefaultCharacter(formData);
        formRef.current?.reset();
        window.location.reload();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 flex items-end gap-4 flex-wrap">
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Gender</label>
        <select
          name="gender"
          required
          value={gender}
          onChange={(e) => setGender(e.target.value as Gender)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
        >
          <option value="boy">Boy</option>
          <option value="girl">Girl</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Skin tone</label>
        <select name="skinTone" required className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900">
          {OPTIONS.skinTones.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Hair color</label>
        <select name="hairColor" required className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900">
          {OPTIONS.hairColors.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Hair style</label>
        <select name="hairStyle" required className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900">
          {OPTIONS.hairStyles[gender].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Eye color</label>
        <select name="eyeColor" required className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900">
          {OPTIONS.eyeColors.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-60"
      >
        {isPending ? "Generating… (20–40s)" : "+ New default character"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
