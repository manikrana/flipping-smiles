"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { placeOrder, cartoonize } from "./actions";
import type { StoryRow } from "@/lib/supabase/types";
import { track } from "@/lib/track";
import { TrackedImage } from "@/components/TrackedImage";
import { PhotoCropModal } from "./PhotoCropModal";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  te: "Telugu",
};

async function compressImage(file: File, maxWidth = 1024, quality = 0.8): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Compression failed"));
          resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality,
      );
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

const FUN_PHRASES = [
  "Sprinkling some magic ✨",
  "Mixing the perfect colors 🎨",
  "Teaching pixels to smile 😊",
  "Adding a dash of wonder 🌟",
  "Warming up the imagination 🔮",
  "Crafting tiny details 🪄",
  "Bringing your child to life 🎭",
  "Almost there… just a sprinkle more ✨",
  "Making it picture-perfect 🖼️",
  "Adding the finishing touches 🎀",
];

type DefaultCharacter = {
  id: string;
  cartoon_image_url: string | null;
  default_gender: "boy" | "girl" | null;
};

type CartoonResult = {
  cartoonUrl: string;
  characterId: string;
};

export function OrderForm({ story, defaultCharacters }: { story: StoryRow; defaultCharacters: DefaultCharacter[] }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useDefaultCharacter, setUseDefaultCharacter] = useState(false);
  const [gender, setGender] = useState<"boy" | "girl">("boy");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<File | null>(null);
  const submittedRef = useRef(false);
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null);

  // Cartoonize state
  const [cartoonHistory, setCartoonHistory] = useState<CartoonResult[]>([]);
  const [selectedCartoonId, setSelectedCartoonId] = useState<string | null>(null);
  const [isCartoonizing, setIsCartoonizing] = useState(false);
  const [cartoonError, setCartoonError] = useState<string | null>(null);
  const [retriesLeft, setRetriesLeft] = useState(3);
  const [progress, setProgress] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phraseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canSubmit = useDefaultCharacter
    ? !!selectedCharacterId
    : !!selectedCartoonId;

  useEffect(() => {
    track("order_started", { story_id: story.id });
    function handleUnload() {
      if (!submittedRef.current) {
        track("order_abandoned", { story_id: story.id });
      }
    }
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [story.id]);

  const stopTimers = useCallback(() => {
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
    if (phraseRef.current) { clearInterval(phraseRef.current); phraseRef.current = null; }
  }, []);

  function startProgressSimulation() {
    setProgress(0);
    setPhraseIndex(0);
    const start = Date.now();
    progressRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      let pct: number;
      if (elapsed < 3) pct = (elapsed / 3) * 30;
      else if (elapsed < 12) pct = 30 + ((elapsed - 3) / 9) * 40;
      else if (elapsed < 25) pct = 70 + ((elapsed - 12) / 13) * 20;
      else pct = Math.min(90 + (elapsed - 25) * 0.3, 99);
      setProgress(Math.round(pct));
    }, 200);
    phraseRef.current = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % FUN_PHRASES.length);
    }, 3000);
  }

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Photo must be under 10MB."); return; }
    setError(null);
    setCartoonError(null);
    // Frame the photo before it ever reaches Gemini, instead of sending
    // whatever arbitrary crop the customer's original photo happened to
    // have -- see handleCropConfirm for what happens once they're done.
    setPendingCropFile(file);
  }

  async function handleCropConfirm(croppedFile: File) {
    setPendingCropFile(null);
    setPreview(URL.createObjectURL(croppedFile));
    setCartoonHistory([]);
    setSelectedCartoonId(null);
    try {
      const compressed = await compressImage(croppedFile);
      photoFileRef.current = compressed;
    } catch {
      photoFileRef.current = croppedFile;
    }
    await handleCartoonize();
  }

  function handleCropCancel() {
    setPendingCropFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function clearPhoto() {
    setPreview(null);
    setCartoonHistory([]);
    setSelectedCartoonId(null);
    setCartoonError(null);
    photoFileRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleCartoonize() {
    if (retriesLeft <= 0 || !photoFileRef.current) return;
    setIsCartoonizing(true);
    setCartoonError(null);
    startProgressSimulation();

    try {
      const fd = new FormData();
      fd.set("photo", photoFileRef.current);
      fd.set("hero_name", (document.querySelector<HTMLInputElement>('input[name="hero_name"]'))?.value || "Hero");
      fd.set("gender", gender);

      const result = await cartoonize(fd);
      stopTimers();
      setProgress(100);
      setCartoonHistory((prev) => [...prev, result]);
      setSelectedCartoonId(result.characterId);
      setRetriesLeft((r) => r - 1);
    } catch (err) {
      stopTimers();
      setProgress(0);
      const message = (err as Error).message;
      console.error("[cartoonize]", message);
      // The rate-limit error is a safe, specific, user-actionable message
      // thrown server-side on purpose -- show it directly rather than
      // flattening it into the same generic text as an unexpected failure.
      setCartoonError(
        message.startsWith("Too many requests")
          ? message
          : "Something went wrong creating your character. Please try again."
      );
    } finally {
      setIsCartoonizing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      if (!useDefaultCharacter && selectedCartoonId) {
        formData.set("character_id", selectedCartoonId);
      }
      submittedRef.current = true;
      track("order_submitted", { story_id: story.id, properties: { language: formData.get("language") as string } });
      await placeOrder(formData);
    } catch (err) {
      submittedRef.current = false;
      const message = (err as Error).message;
      setError(message);
      track("form_error", { story_id: story.id, properties: { message } });
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {pendingCropFile && (
        <PhotoCropModal file={pendingCropFile} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />
      )}
      {expandedUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setExpandedUrl(null)}>
          <img src={expandedUrl} alt="Preview" className="max-w-sm w-full rounded-2xl shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setExpandedUrl(null)} className="absolute top-4 right-4 text-white text-2xl leading-none">✕</button>
        </div>
      )}
      <input type="hidden" name="story_id" value={story.id} />
      <input type="hidden" name="amount_usd" value={story.price_usd} />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm">
          {error}
        </div>
      )}

      {/* Character source — first so cartoonize runs while parent fills other fields */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-2">
          Your child&apos;s character <span className="text-accent-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-3 mb-3">
          {[
            { value: "photo", label: "Upload a photo" },
            { value: "default", label: "Use a ready-made character" },
          ].map((opt) => (
            <label
              key={opt.value}
              className="flex items-center justify-center gap-2 border border-ink/10 rounded-2xl px-4 py-3 cursor-pointer bg-cream has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 transition-colors text-center"
            >
              <input
                type="radio"
                name="character_source"
                value={opt.value}
                defaultChecked={opt.value === "photo"}
                onChange={() => setUseDefaultCharacter(opt.value === "default")}
                className="sr-only"
              />
              <span className="text-sm font-medium">{opt.label}</span>
            </label>
          ))}
        </div>

        {useDefaultCharacter ? (
          <div>
            {(() => {
              const options = defaultCharacters.filter((c) => c.default_gender === gender);
              if (options.length === 0) {
                return (
                  <p className="text-xs text-ink/40 bg-cream rounded-2xl px-4 py-3">
                    No ready-made characters available for this option yet — please upload a photo instead.
                  </p>
                );
              }
              return (
                <div className="grid grid-cols-4 gap-3">
                  {options.map((c) => (
                    <label
                      key={c.id}
                      className="cursor-pointer rounded-2xl border-2 border-ink/10 has-[:checked]:border-brand-500 overflow-hidden bg-cream transition-colors aspect-square"
                    >
                      <input
                        type="radio"
                        name="character_id"
                        value={c.id}
                        checked={selectedCharacterId === c.id}
                        onChange={() => setSelectedCharacterId(c.id)}
                        required
                        className="sr-only"
                      />
                      {c.cartoon_image_url ? (
                        <TrackedImage
                          context="character_option"
                          storyId={story.id}
                          src={c.cartoon_image_url}
                          alt="Character option"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">🧒</div>
                      )}
                    </label>
                  ))}
                </div>
              );
            })()}
          </div>
        ) : (
          <>
            {/* Photo upload — always visible when no cartoon generated yet */}
            {cartoonHistory.length === 0 && !isCartoonizing && (
              <>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-ink/10 rounded-2xl p-6 text-center cursor-pointer hover:border-brand-400 bg-cream transition-colors"
                >
                  {preview ? (
                    <img src={preview} alt="Preview" className="mx-auto h-36 w-36 object-cover rounded-2xl shadow-card" />
                  ) : (
                    <div className="text-ink/40">
                      <div className="text-3xl mb-2">📸</div>
                      <div className="text-sm font-medium">Click to upload a photo</div>
                      <div className="text-xs mt-1 text-ink/25">JPG, PNG, WEBP — max 10MB</div>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  name="photo"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhoto}
                />
                {preview && (
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={clearPhoto}
                      className="text-xs text-ink/30 hover:text-accent-500 transition-colors"
                    >
                      Remove photo
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Cartoon grid — completed thumbnails + loading placeholder */}
            {(cartoonHistory.length > 0 || isCartoonizing) && (
              <div className="bg-cream rounded-2xl p-5 space-y-3">
                <p className="text-sm font-semibold text-ink">
                  {isCartoonizing && cartoonHistory.length === 0
                    ? "Creating your character…"
                    : isCartoonizing
                      ? "Generating another option…"
                      : cartoonHistory.length === 1
                        ? "Here’s your character!"
                        : "Pick your favorite!"}
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {cartoonHistory.map((c) => (
                    <label
                      key={c.characterId}
                      className={`w-[calc((100%-1.5rem)/3)] cursor-pointer rounded-2xl border-2 overflow-hidden bg-white transition-all aspect-square ${
                        selectedCartoonId === c.characterId
                          ? "border-brand-500 ring-2 ring-brand-200"
                          : "border-ink/10 hover:border-ink/20"
                      }`}
                    >
                      <input
                        type="radio"
                        name="cartoon_choice"
                        value={c.characterId}
                        checked={selectedCartoonId === c.characterId}
                        onChange={() => setSelectedCartoonId(c.characterId)}
                        className="sr-only"
                      />
                      <div className="relative w-full h-full group">
                        <TrackedImage
                          context="cartoonized_character"
                          storyId={story.id}
                          src={c.cartoonUrl}
                          alt="Cartoon option"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setExpandedUrl(c.cartoonUrl); }}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors"
                        >
                          <span className="text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">⤢</span>
                        </button>
                      </div>
                    </label>
                  ))}
                  {isCartoonizing && (
                    <div className="w-[calc((100%-1.5rem)/3)] rounded-2xl border-2 border-brand-300 aspect-square relative overflow-hidden">
                      {preview ? (
                        <img
                          key={preview}
                          src={preview}
                          alt=""
                          className="w-full h-full object-cover [animation:cartoonize-photo-transform_0.9s_ease-out_forwards]"
                        />
                      ) : (
                        <div className="w-full h-full bg-brand-50" />
                      )}
                      <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent [animation:cartoonize-shimmer-sweep_1.6s_ease-in-out_infinite]" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 120 120">
                          <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" className="text-white/20" />
                          <circle
                            cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8"
                            className="text-white transition-all duration-300"
                            strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 52}`}
                            strokeDashoffset={`${2 * Math.PI * 52 * (1 - progress / 100)}`}
                          />
                        </svg>
                        <span className="text-sm font-bold text-white drop-shadow">{progress}%</span>
                      </div>
                    </div>
                  )}
                </div>
                {isCartoonizing && (
                  <p className="text-sm font-medium text-ink/50 text-center animate-pulse">
                    {FUN_PHRASES[phraseIndex]}
                  </p>
                )}
                {!isCartoonizing && (
                  <div className="flex items-center gap-3">
                    {retriesLeft > 0 && (
                      <button
                        type="button"
                        onClick={handleCartoonize}
                        className="text-xs border border-ink/10 text-ink/50 hover:text-purple-500 hover:border-purple-300 font-medium px-4 py-2 rounded-xl transition-colors"
                      >
                        Generate another ({retriesLeft} left)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { clearPhoto(); setRetriesLeft(3); }}
                      className="text-xs text-ink/30 hover:text-accent-500 transition-colors"
                    >
                      Use a different photo
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {cartoonError && !isCartoonizing && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-sm text-red-700">{cartoonError}</p>
                <button
                  type="button"
                  onClick={handleCartoonize}
                  className="shrink-0 text-xs bg-red-100 hover:bg-red-200 text-red-700 font-medium px-3 py-1.5 rounded-xl transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Hidden file input for retries */}
            {cartoonHistory.length > 0 && (
              <input
                ref={fileRef}
                type="file"
                name="photo"
                accept="image/*"
                className="hidden"
                onChange={handlePhoto}
              />
            )}
          </>
        )}
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          Child&apos;s name <span className="text-accent-500">*</span>
        </label>
        <input
          name="hero_name"
          required
          placeholder="e.g. Emma"
          className="w-full border border-ink/10 rounded-2xl px-4 py-3 text-sm bg-cream focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-ink/30"
        />
        <p className="text-xs text-ink/35 mt-1.5">Appears throughout the story.</p>
      </div>

      {/* Gender */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-2">
          Child&apos;s gender <span className="text-accent-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: "boy", label: "Boy", emoji: "👦" },
            { value: "girl", label: "Girl", emoji: "👧" },
          ].map((g) => (
            <label
              key={g.value}
              className="flex items-center justify-center gap-2 border border-ink/10 rounded-2xl px-4 py-3 cursor-pointer bg-cream has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 transition-colors"
            >
              <input
                type="radio"
                name="gender"
                value={g.value}
                checked={gender === g.value}
                onChange={() => { setGender(g.value as "boy" | "girl"); setSelectedCharacterId(null); }}
                required
                className="sr-only"
              />
              <span>{g.emoji}</span>
              <span className="text-sm font-medium">{g.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Age */}
      <div>
        <label className="block text-sm font-semibold text-ink mb-1.5">
          Child&apos;s age <span className="text-accent-500">*</span>
        </label>
        <div className="relative">
        <select
          name="age"
          required
          className="w-full border border-ink/10 rounded-2xl px-4 py-3 pr-10 text-sm bg-cream focus:outline-none focus:ring-2 focus:ring-brand-400 appearance-none"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((a) => (
            <option key={a} value={a}>{a} year{a !== 1 ? "s" : ""} old</option>
          ))}
        </select>
        <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </div>
        <p className="text-xs text-ink/35 mt-1.5">Used to match your child&apos;s size and proportions in the illustrations.</p>
      </div>

      {/* Language */}
      {story.languages.length > 1 && (
        <div>
          <label className="block text-sm font-semibold text-ink mb-2">
            Language <span className="text-accent-500">*</span>
          </label>
          <div className="flex gap-3 flex-wrap">
            {story.languages.map((lang) => (
              <label key={lang} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="language" value={lang} defaultChecked={lang === "en"} required className="accent-brand-500" />
                <span className="text-sm">{LANGUAGE_LABELS[lang] ?? lang}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {story.languages.length === 1 && (
        <input type="hidden" name="language" value={story.languages[0]} />
      )}

      {/* Consent */}
      {!useDefaultCharacter && (
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="consent"
            required={!useDefaultCharacter}
            className="mt-0.5 accent-brand-500 w-4 h-4 shrink-0"
          />
          <span className="text-xs text-ink/50 leading-relaxed">
            I am this child&apos;s parent or legal guardian, or I have permission from their parent or legal
            guardian to upload this photo, and I consent to it being used to generate a personalized
            illustration, including processing by our AI providers, as described in our{" "}
            <a href="/privacy" target="_blank" className="text-brand-500 underline">Privacy Policy</a>.
          </span>
        </label>
      )}

      <button
        type="submit"
        disabled={loading || !canSubmit}
        className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white font-bold py-4 rounded-2xl text-base transition-all hover:scale-[1.02] shadow-warm"
      >
        {loading ? "Creating your preview…" : "Try Now for Free →"}
      </button>

      <p className="text-xs text-center text-ink/35">
        Preview is completely free. We only charge when you approve your book.
      </p>
    </form>
  );
}
