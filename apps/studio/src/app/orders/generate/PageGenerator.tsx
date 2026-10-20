"use client";

import { useState, useTransition } from "react";
import { startPageGeneration, generateSinglePage, resetOrder } from "./actions";
import type { OrderPageRow } from "@/lib/supabase/types";

interface Props {
  orderId: string;
  initialPages: OrderPageRow[];
  orderStatus: string;
  cartoonReady: boolean;
}

const STATUS_ICON: Record<string, string> = {
  pending: "⬜",
  processing: "🔄",
  upscaling: "🔼",
  done: "✅",
  failed: "❌",
};

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <img
        src={url}
        alt="Page preview"
        className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-2xl leading-none"
      >
        ✕
      </button>
    </div>
  );
}

function PageCard({
  page,
  orderId,
  cartoonReady,
}: {
  page: OrderPageRow;
  orderId: string;
  cartoonReady: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      await generateSinglePage(orderId, page.page_number);
    } catch {
      // error is saved to DB by the server action
    }
    window.location.reload();
  }

  const imageUrl = page.upscaled_image_url ?? page.image_url;
  const isProcessing = loading;

  return (
    <>
      {expanded && imageUrl && (
        <Lightbox url={imageUrl} onClose={() => setExpanded(false)} />
      )}

      <div className="text-center">
        <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200 mb-1 group">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`Page ${page.page_number}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl">
              {isProcessing ? "🔄" : STATUS_ICON[page.generation_status]}
            </div>
          )}

          {/* Hover overlay */}
          {!isProcessing && (
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              {imageUrl && (
                <button
                  onClick={() => setExpanded(true)}
                  className="bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-2 py-1 rounded"
                >
                  ⤢ Expand
                </button>
              )}
              {cartoonReady && (
                <button
                  onClick={handleGenerate}
                  className="bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-2 py-1 rounded"
                >
                  {page.generation_status === "done" ? "↺ Redo" : "▶ Generate"}
                </button>
              )}
            </div>
          )}

          {isProcessing && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">p.{page.page_number}</p>
        {page.generation_status === "failed" && page.error_message && (
          <p className="text-xs text-red-400 truncate" title={page.error_message}>
            {page.error_message}
          </p>
        )}
      </div>
    </>
  );
}

export function PageGenerator({ orderId, initialPages, orderStatus, cartoonReady }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isResetting, setIsResetting] = useState(false);

  const doneCount = initialPages.filter((p) => p.generation_status === "done").length;
  const failedCount = initialPages.filter((p) => p.generation_status === "failed").length;

  function handleGenerateAll() {
    startTransition(async () => {
      await startPageGeneration(orderId);
      window.location.reload();
    });
  }

  async function handleReset() {
    if (!confirm("Delete all generated page images and reset this order? This cannot be undone.")) return;
    setIsResetting(true);
    try {
      await resetOrder(orderId);
      window.location.reload();
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="space-y-4">
      {initialPages.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            {doneCount}/{initialPages.length} pages done
            {failedCount > 0 && <span className="text-red-500 ml-2">{failedCount} failed</span>}
          </span>
          <button
            onClick={handleReset}
            disabled={isResetting || isPending}
            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
          >
            {isResetting ? "Resetting…" : "Reset all"}
          </button>
        </div>
      )}

      {initialPages.length > 0 && (
        <div className="grid grid-cols-5 gap-3">
          {initialPages.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              orderId={orderId}
              cartoonReady={cartoonReady}
            />
          ))}
        </div>
      )}

      {!cartoonReady ? (
        <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          Complete Step 1 first — generate the Pixar character before personalising pages.
        </div>
      ) : (
        <button
          onClick={handleGenerateAll}
          disabled={isPending}
          className="text-sm bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
        >
          {isPending
            ? "Starting…"
            : initialPages.length > 0
            ? "🔄 Regenerate all pages"
            : "✨ Generate all pages"}
        </button>
      )}
    </div>
  );
}
