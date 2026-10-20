"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { startPreviewGeneration, generatePreviewPage, exportPreviewPdf } from "./actions";
import { TrackedImage } from "@/components/TrackedImage";
import { panelBgStyle } from "@/lib/textPanelBg";
import type { LayoutType, TextStyle, TextPanelBg } from "@/lib/supabase/types";

const FUN_PHRASES = [
  "Painting the opening scene 🎨",
  "Your child just entered the story ✨",
  "Setting the stage… lights, camera, magic! 🎬",
  "The adventure is taking shape 🌟",
  "Adding sparkle to every corner 🪄",
  "Brushing in the final details 🖌️",
  "Your story is coming alive 🎭",
  "Almost there… turning pages 📖",
];

const MAX_REGEN_PER_SLOT = 3;

type PreviewPage = {
  pageNumber: number;
  imageUrl: string;
  text: string;
  textBgUrl: string | null;
};

type SlotState = {
  history: string[]; // imageUrls
  currentIndex: number;
  generating: boolean;
  regensUsed: number;
  progress: number;
  phraseIndex: number;
  error: string | null;
  text: string;
  textBgUrl: string | null;
};

function isSpreadLayout(layoutType: LayoutType): boolean {
  return layoutType === "spread_left" || layoutType === "spread_right" || layoutType === "spread_left_clean" || layoutType === "spread_right_clean";
}

function isSplitLayout(layoutType: LayoutType): boolean {
  return layoutType === "split_image_left" || layoutType === "split_image_right";
}

// spread_left/spread_left_clean: hero on the LEFT half, so text goes on the
// RIGHT. spread_right/spread_right_clean: mirrored. Matches
// apps/studio/src/app/orders/[id]/OrderBookPreview.tsx's sceneDir mapping.
function spreadTextSide(layoutType: LayoutType): "left" | "right" {
  return layoutType === "spread_left" || layoutType === "spread_left_clean" ? "right" : "left";
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function startProgressTimer(onUpdate: (pct: number) => void): () => void {
  const start = Date.now();
  const id = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    let pct: number;
    if (elapsed < 3) pct = (elapsed / 3) * 25;
    else if (elapsed < 15) pct = 25 + ((elapsed - 3) / 12) * 45;
    else if (elapsed < 30) pct = 70 + ((elapsed - 15) / 15) * 20;
    else pct = Math.min(90 + (elapsed - 30) * 0.2, 99);
    onUpdate(Math.round(pct));
  }, 200);
  return () => clearInterval(id);
}

// Shared between the grid slot and the expanded lightbox so both render the
// exact same image + text overlay -- previously the lightbox just showed the
// bare image with no text at all.
function PreviewContent({
  orderId,
  index,
  imageUrl,
  text,
  textBgUrl,
  textStyle,
  textPanelBg,
  layoutType,
}: {
  orderId: string;
  index: number;
  imageUrl: string;
  text: string;
  textBgUrl: string | null;
  textStyle: TextStyle;
  textPanelBg: TextPanelBg;
  layoutType: LayoutType;
}) {
  const spread = isSpreadLayout(layoutType);
  const split = isSplitLayout(layoutType);
  const textParagraphStyle: React.CSSProperties = {
    fontFamily: textStyle.fontFamily,
    fontSize: `${textStyle.fontSizePct}cqh`,
    color: textStyle.color,
    fontStyle: textStyle.italic ? "italic" : "normal",
    textAlign: textStyle.alignment,
  };

  return (
    <div className="relative w-full h-full" style={{ containerType: "size" }}>
      {split ? (
        // split_image_left/right: image and text are two genuinely separate
        // pages in print (no shared source image) -- shown side by side here,
        // in the order layoutType implies.
        <div className="w-full h-full flex">
          {layoutType === "split_image_left" ? (
            <>
              <div className="w-1/2 h-full"><TrackedImage context="order_page_preview" orderId={orderId} src={imageUrl} alt={`Preview ${index + 1}`} className="w-full h-full object-cover" /></div>
              <div className="w-1/2 h-full flex items-center justify-center px-[3%] text-center" style={{ containerType: "size", ...panelBgStyle(textPanelBg, textBgUrl) }}>
                <p className="whitespace-pre-wrap leading-relaxed" style={textParagraphStyle}>{text}</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-1/2 h-full flex items-center justify-center px-[3%] text-center" style={{ containerType: "size", ...panelBgStyle(textPanelBg, textBgUrl) }}>
                <p className="whitespace-pre-wrap leading-relaxed" style={textParagraphStyle}>{text}</p>
              </div>
              <div className="w-1/2 h-full"><TrackedImage context="order_page_preview" orderId={orderId} src={imageUrl} alt={`Preview ${index + 1}`} className="w-full h-full object-cover" /></div>
            </>
          )}
        </div>
      ) : spread ? (
        // spread_*: one continuous image already shows both halves -- text
        // overlays the non-hero half (spreadTextSide), same pill treatment
        // as the real print/admin preview.
        <>
          <TrackedImage context="order_page_preview" orderId={orderId} src={imageUrl} alt={`Preview ${index + 1}`} className="w-full h-full object-cover" />
          <div
            className="absolute inset-y-0 flex items-center justify-center px-[4%] text-center"
            style={spreadTextSide(layoutType) === "left" ? { left: 0, right: "50%" } : { left: "50%", right: 0 }}
          >
            <p
              className="whitespace-pre-wrap leading-relaxed rounded-2xl px-5 py-4"
              style={{
                ...textParagraphStyle,
                ...(textStyle.textBoxBg !== "none" ? { backgroundColor: "rgba(255,255,255,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" } : {}),
              }}
            >
              {text}
            </p>
          </div>
        </>
      ) : (
        // overlay_bottom: bottom text band directly on the image. Percentages
        // (25% panel height, 4% bottom margin, 3% horizontal padding, 6cqh
        // vertical padding) mirror apps/studio's composite.ts buildSvgOverlay()
        // math exactly, so this matches the real print output.
        <>
          <TrackedImage context="order_page_preview" orderId={orderId} src={imageUrl} alt={`Preview ${index + 1}`} className="w-full h-full object-cover" />
          <div
            className="absolute left-0 right-0"
            style={{ height: "25%", bottom: "4%", backgroundColor: `rgba(${hexToRgb(textStyle.bgColor)}, ${textStyle.bgOpacity})`, containerType: "size" }}
          >
            <div className="w-full h-full flex items-center justify-center" style={{ paddingLeft: "3%", paddingRight: "3%", paddingTop: "6cqh", paddingBottom: "6cqh", boxSizing: "border-box" }}>
              <p className="whitespace-pre-wrap leading-relaxed" style={textParagraphStyle}>{text}</p>
            </div>
          </div>
        </>
      )}
      {(spread || split) && (
        // Mild center crease -- spread/split layouts print as two facing
        // pages, so a faint gutter shadow reads as "this is a book", not a
        // single flat photo.
        <div
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1.5%] pointer-events-none"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.06) 40%, rgba(0,0,0,0.09) 50%, rgba(0,0,0,0.06) 60%, rgba(0,0,0,0) 100%)",
          }}
        />
      )}
    </div>
  );
}

function PreviewSlot({
  orderId,
  index,
  templateUrl,
  imageUrl,
  text,
  textBgUrl,
  textStyle,
  textPanelBg,
  generating,
  progress,
  phraseIndex,
  history,
  currentIndex,
  canRegen,
  regensLeft,
  layoutType,
  onRegen,
  onNavigate,
  onExpand,
}: {
  orderId: string;
  index: number;
  templateUrl: string | undefined;
  imageUrl: string | null;
  text: string;
  textBgUrl: string | null;
  textStyle: TextStyle;
  textPanelBg: TextPanelBg;
  generating: boolean;
  progress: number;
  phraseIndex: number;
  history: string[];
  currentIndex: number;
  canRegen: boolean;
  regensLeft: number;
  layoutType: LayoutType;
  onRegen: () => void;
  onNavigate: (dir: -1 | 1) => void;
  onExpand: () => void;
}) {
  const showImage = !generating && imageUrl;
  const spread = isSpreadLayout(layoutType);
  const split = isSplitLayout(layoutType);

  return (
    <div
      className="relative rounded-2xl overflow-hidden border border-ink/5"
      style={{ aspectRatio: spread || split ? "2 / 1" : "4 / 3", containerType: "size" }}
    >
      {showImage ? (
        <PreviewContent
          orderId={orderId}
          index={index}
          imageUrl={imageUrl}
          text={text}
          textBgUrl={textBgUrl}
          textStyle={textStyle}
          textPanelBg={textPanelBg}
          layoutType={layoutType}
        />
      ) : (
        <>
          {templateUrl ? (
            <img src={templateUrl} alt="" className="w-full h-full object-cover blur-md scale-105 brightness-75" />
          ) : (
            <div className="w-full h-full bg-gradient-to-b from-brand-50 to-brand-100" />
          )}
          <div className="absolute inset-0 bg-black/20 flex flex-col items-center justify-center gap-3">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" className="text-white/20" />
                <circle
                  cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8"
                  className="text-white transition-all duration-300"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 52}`}
                  strokeDashoffset={`${2 * Math.PI * 52 * (1 - progress / 100)}`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white">
                {progress}%
              </span>
            </div>
            <p className="text-sm font-medium text-white/90 animate-pulse px-6 text-center drop-shadow">
              {FUN_PHRASES[phraseIndex]}
            </p>
          </div>
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          </div>
        </>
      )}

      {/* Label + expand */}
      <div className="absolute top-3 left-3 bg-white/80 backdrop-blur-sm text-xs font-semibold text-ink/60 px-2.5 py-1 rounded-full">
        Preview {index + 1}
      </div>
      {showImage && (
        <button
          onClick={onExpand}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center transition-colors"
        >
          <span className="text-white text-sm">⤢</span>
        </button>
      )}

      {/* Controls overlay — bottom bar */}
      {showImage && (
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/50 to-transparent pt-8 pb-3 px-3 flex items-center justify-between z-10">
          {/* Nav arrows */}
          <div className="flex items-center gap-1.5">
            {history.length > 1 && (
              <>
                <button
                  onClick={() => onNavigate(-1)}
                  disabled={currentIndex === 0}
                  className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white text-sm disabled:opacity-30 transition-colors"
                >
                  ‹
                </button>
                <span className="text-xs text-white/70 mx-1">{currentIndex + 1}/{history.length}</span>
                <button
                  onClick={() => onNavigate(1)}
                  disabled={currentIndex === history.length - 1}
                  className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white text-sm disabled:opacity-30 transition-colors"
                >
                  ›
                </button>
              </>
            )}
          </div>

          {/* Regen button */}
          {canRegen && (
            <button
              onClick={onRegen}
              className="text-xs bg-white/20 hover:bg-white/40 text-white font-medium px-3 py-1.5 rounded-full transition-colors backdrop-blur-sm"
            >
              ↺ Regenerate ({regensLeft})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PreviewGenerator({
  orderId,
  existingPages,
  storyTitle,
  priceUsd,
  heroName,
  bookSlug,
  layoutType,
  textStyle,
  textPanelBg,
}: {
  orderId: string;
  existingPages: PreviewPage[];
  storyTitle: string;
  priceUsd: number;
  heroName: string;
  bookSlug: string;
  layoutType: LayoutType;
  textStyle: TextStyle;
  textPanelBg: TextPanelBg;
}) {
  const router = useRouter();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [slots, setSlots] = useState<SlotState[]>(() => {
    if (existingPages.length > 0) {
      return existingPages.map((p) => ({
        history: [p.imageUrl],
        currentIndex: 0,
        generating: false,
        regensUsed: 1,
        progress: 0,
        phraseIndex: 0,
        error: null,
        text: p.text,
        textBgUrl: p.textBgUrl,
      }));
    }
    return [];
  });
  const [templateUrls, setTemplateUrls] = useState<string[]>([]);
  const [initializing, setInitializing] = useState(existingPages.length === 0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const phraseRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [globalPhraseIndex, setGlobalPhraseIndex] = useState(0);

  // Global phrase rotation during initial generation
  useEffect(() => {
    if (!initializing) return;
    phraseRef.current = setInterval(() => {
      setGlobalPhraseIndex((i) => (i + 1) % FUN_PHRASES.length);
    }, 3500);
    return () => { if (phraseRef.current) clearInterval(phraseRef.current); };
  }, [initializing]);

  const [slotProgress, setSlotProgress] = useState<Record<number, number>>({});
  const progressTimers = useRef<Record<number, () => void>>({});

  const runInitialGeneration = useCallback(async () => {
    setInitializing(true);
    setError(null);

    try {
      const { totalPages, templateUrls: templates, texts, textBgUrls } = await startPreviewGeneration(orderId);
      setTemplateUrls(templates);

      // Create slot states
      const initialSlots: SlotState[] = Array.from({ length: totalPages }, (_, i) => ({
        history: [],
        currentIndex: -1,
        generating: true,
        regensUsed: 0,
        progress: 0,
        phraseIndex: 0,
        error: null,
        text: texts[i] ?? "",
        textBgUrl: textBgUrls[i] ?? null,
      }));
      setSlots(initialSlots);

      // Start progress timers for each slot
      for (let i = 0; i < totalPages; i++) {
        progressTimers.current[i] = startProgressTimer((pct) =>
          setSlotProgress((prev) => ({ ...prev, [i]: pct }))
        );
      }

      // Fire all in parallel, each resolves independently
      const promises = Array.from({ length: totalPages }, (_, i) =>
        generatePreviewPage(orderId, i)
          .then((result) => {
            progressTimers.current[i]?.();
            setSlotProgress((prev) => ({ ...prev, [i]: 100 }));
            setSlots((prev) => prev.map((s, idx) =>
              idx === i
                ? { ...s, generating: false, history: [result.imageUrl], currentIndex: 0, regensUsed: 1 }
                : s
            ));
          })
          .catch((err) => {
            progressTimers.current[i]?.();
            console.error(`[preview] slot ${i}:`, (err as Error).message);
            setSlots((prev) => prev.map((s, idx) =>
              idx === i ? { ...s, generating: false, error: "Something went wrong. Please try again." } : s
            ));
          })
      );

      await Promise.allSettled(promises);
    } catch (err) {
      console.error("[preview]", (err as Error).message);
      setError("Something went wrong generating your preview. Please try again.");
    } finally {
      setInitializing(false);
    }
  }, [orderId]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (existingPages.length > 0 || startedRef.current) return;
    startedRef.current = true;
    runInitialGeneration();
  }, [existingPages.length, runInitialGeneration]);

  async function regenSlot(slotIndex: number) {
    setSlots((prev) => prev.map((s, i) =>
      i === slotIndex ? { ...s, generating: true, error: null } : s
    ));

    progressTimers.current[slotIndex] = startProgressTimer((pct) =>
      setSlotProgress((prev) => ({ ...prev, [slotIndex]: pct }))
    );

    try {
      const result = await generatePreviewPage(orderId, slotIndex);
      progressTimers.current[slotIndex]?.();
      setSlotProgress((prev) => ({ ...prev, [slotIndex]: 100 }));
      setSlots((prev) => prev.map((s, i) =>
        i === slotIndex
          ? {
              ...s,
              generating: false,
              history: [...s.history, result.imageUrl],
              currentIndex: s.history.length,
              regensUsed: s.regensUsed + 1,
            }
          : s
      ));
    } catch (err) {
      progressTimers.current[slotIndex]?.();
      setSlots((prev) => prev.map((s, i) =>
        i === slotIndex ? { ...s, generating: false, error: "Something went wrong. Please try again." } : s
      ));
    }
  }

  function navigateSlot(slotIndex: number, dir: -1 | 1) {
    setSlots((prev) => prev.map((s, i) =>
      i === slotIndex
        ? { ...s, currentIndex: Math.max(0, Math.min(s.history.length - 1, s.currentIndex + dir)) }
        : s
    ));
  }

  const allDone = slots.length > 0 && slots.every((s) => !s.generating && s.history.length > 0);
  const spread = isSpreadLayout(layoutType);
  const split = isSplitLayout(layoutType);
  const wide = spread || split;

  const expandedSlot = expandedIndex !== null ? slots[expandedIndex] : null;
  const expandedUrl = expandedSlot ? expandedSlot.history[expandedSlot.currentIndex] ?? null : null;

  return (
    <div className="space-y-5">
      {expandedUrl && expandedIndex !== null && expandedSlot && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setExpandedIndex(null)}>
          <div
            className="relative rounded-2xl shadow-2xl overflow-hidden"
            style={wide ? { aspectRatio: "2 / 1", maxWidth: "90vw", maxHeight: "90vh", width: "90vw" } : { aspectRatio: "4 / 3", maxWidth: "42rem", width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <PreviewContent
              orderId={orderId}
              index={expandedIndex}
              imageUrl={expandedUrl}
              text={expandedSlot.text}
              textBgUrl={expandedSlot.textBgUrl}
              textStyle={textStyle}
              textPanelBg={textPanelBg}
              layoutType={layoutType}
            />
          </div>
          <button onClick={() => setExpandedIndex(null)} className="absolute top-4 right-4 text-white text-2xl leading-none">✕</button>
        </div>
      )}

      {/* Preview slots */}
      {(slots.length > 0 || initializing) && (
        <div className="space-y-4">
          {(slots.length > 0 ? slots : Array.from({ length: templateUrls.length || 2 }, () => ({} as SlotState))).map((slot, i) => {
            const isReal = slots.length > 0;
            const generating = isReal ? slot.generating : true;
            const imageUrl = isReal && !slot.generating ? slot.history[slot.currentIndex] ?? null : null;

            return (
              <PreviewSlot
                key={i}
                orderId={orderId}
                index={i}
                templateUrl={templateUrls[i]}
                imageUrl={imageUrl}
                text={isReal ? slot.text : ""}
                textBgUrl={isReal ? slot.textBgUrl : null}
                textStyle={textStyle}
                textPanelBg={textPanelBg}
                generating={generating}
                progress={slotProgress[i] ?? 0}
                phraseIndex={globalPhraseIndex}
                history={isReal ? slot.history : []}
                currentIndex={isReal ? slot.currentIndex : 0}
                canRegen={isReal && !slot.generating && slot.regensUsed < MAX_REGEN_PER_SLOT}
                regensLeft={isReal ? MAX_REGEN_PER_SLOT - slot.regensUsed : 0}
                layoutType={layoutType}
                onRegen={() => regenSlot(i)}
                onNavigate={(dir) => navigateSlot(i, dir)}
                onExpand={() => setExpandedIndex(i)}
              />
            );
          })}
        </div>
      )}

      {/* Global error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center space-y-3">
          <p className="text-sm text-red-700">{error}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => { setError(null); startedRef.current = false; runInitialGeneration(); }}
              className="text-sm bg-brand-500 hover:bg-brand-600 text-white font-semibold px-5 py-2.5 rounded-2xl transition-colors"
            >
              Try again
            </button>
            <a href={`/books/${bookSlug}`} className="text-sm text-ink/40 hover:text-ink transition-colors">
              ← Back to book
            </a>
          </div>
        </div>
      )}

      {/* Per-slot errors */}
      {slots.map((slot, i) =>
        slot.error && !slot.generating ? (
          <div key={`err-${i}`} className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700">
            Preview {i + 1} failed: {slot.error}
          </div>
        ) : null
      )}

      {/* CTA — shown when all done */}
      {allDone && (
        <>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={async () => {
                try {
                  const url = await exportPreviewPdf(orderId);
                  window.open(url, "_blank");
                } catch {
                  // silent fail
                }
              }}
              className="text-sm border border-ink/10 text-ink/50 hover:text-brand-500 hover:border-brand-300 font-medium px-5 py-2.5 rounded-2xl transition-colors"
            >
              Download PDF
            </button>
            <a
              href={`/books/${bookSlug}`}
              className="text-sm border border-ink/10 text-ink/50 hover:text-purple-500 hover:border-purple-300 font-medium px-5 py-2.5 rounded-2xl transition-colors"
            >
              ← Try a different photo
            </a>
          </div>

          <div className="bg-white rounded-3xl border border-ink/5 shadow-card p-6 text-center space-y-4">
            <h3 className="text-lg font-bold text-ink">
              Love {heroName}&apos;s adventure?
            </h3>
            <p className="text-sm text-ink/50">
              Get the full hardcover book with {heroName} as the star of every scene.
            </p>
            <button
              onClick={() => router.push("/cart")}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white font-bold py-4 rounded-2xl text-base transition-all hover:scale-[1.02] shadow-warm"
            >
              Checkout · ${priceUsd}
            </button>
            <p className="text-xs text-ink/30">Printed &amp; shipped to your door</p>
            <a href="/books" className="inline-block text-xs text-ink/40 hover:text-brand-600 transition-colors">
              + Add another book
            </a>
          </div>
        </>
      )}

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
}
