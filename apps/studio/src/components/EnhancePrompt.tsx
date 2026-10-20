"use client";

import { useState } from "react";
import { enhancePrompt } from "@/app/enhance/actions";

interface Props {
  type: "character" | "scene";
  currentValue: string;
  onApply: (enhanced: string) => void;
}

export function EnhancePrompt({ type, currentValue, onApply }: Props) {
  const [loading, setLoading] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);

  async function handleEnhance() {
    if (!currentValue.trim() || loading) return;
    setLoading(true);
    try {
      const enhanced = await enhancePrompt(type, currentValue);
      setPrevious(currentValue);
      onApply(enhanced);
    } finally {
      setLoading(false);
    }
  }

  function handleUndo() {
    if (previous !== null) {
      onApply(previous);
      setPrevious(null);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleEnhance}
        disabled={loading || !currentValue.trim()}
        className="text-xs text-blue-500 hover:text-blue-700 font-medium disabled:opacity-40 flex items-center gap-1"
      >
        {loading ? <><span className="animate-spin inline-block">⟳</span> Enhancing…</> : "✦ Enhance"}
      </button>
      {previous !== null && !loading && (
        <button
          type="button"
          onClick={handleUndo}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Undo
        </button>
      )}
    </span>
  );
}
