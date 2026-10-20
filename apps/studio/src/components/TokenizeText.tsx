"use client";

import { useState } from "react";
import { tokenizeStoryText } from "@/app/stories/tokenize/actions";

interface Props {
  currentValue: string;
  onApply: (tokenized: string) => void;
}

export function TokenizeText({ currentValue, onApply }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setOpen(true);
    setStatus("loading");
    setResult(null);
    setError(null);
    try {
      const tokenized = await tokenizeStoryText(currentValue);
      setResult(tokenized);
      setStatus("done");
    } catch {
      setError("Something went wrong. Try again.");
      setStatus("idle");
    }
  }

  function handleApply() {
    if (!result) return;
    setPrevious(currentValue);
    onApply(result);
    setOpen(false);
    setResult(null);
    setStatus("idle");
  }

  function handleUndo() {
    if (previous !== null) {
      onApply(previous);
      setPrevious(null);
    }
  }

  function handleClose() {
    setOpen(false);
    setResult(null);
    setStatus("idle");
    setError(null);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleRun}
        disabled={!currentValue.trim() || status === "loading"}
        className="text-xs text-purple-500 hover:text-purple-700 font-medium disabled:opacity-40"
      >
        ✦ Tokenize
      </button>
      {previous !== null && (
        <button
          type="button"
          onClick={handleUndo}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Undo
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={handleClose}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-800">Tokenize pronouns</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Replaces he/she/him/her/his/herself with template tokens so the story works for any child.
                </p>
              </div>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {status === "loading" && (
              <div className="flex items-center justify-center py-10 text-sm text-gray-400 gap-2">
                <span className="animate-spin">⟳</span> Tokenizing…
              </div>
            )}

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            {status === "done" && result !== null && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Original</p>
                    <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 whitespace-pre-wrap font-mono max-h-52 overflow-y-auto">
                      {currentValue}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-purple-600 mb-1">Tokenized</p>
                    <pre className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap font-mono max-h-52 overflow-y-auto">
                      {result}
                    </pre>
                  </div>
                </div>

                <div className="flex items-center gap-3 justify-end">
                  <button onClick={handleClose} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
                  <button
                    onClick={handleApply}
                    className="text-sm bg-purple-500 hover:bg-purple-600 text-white font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Apply
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
