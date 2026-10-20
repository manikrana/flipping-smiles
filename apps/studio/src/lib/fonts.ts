export type FontOption = {
  label: string;
  cssFamily: string;
  googleFont: string | null; // null = system font, no fetch needed
  style: string;             // shown in the selector button
  category: "handwritten" | "rounded" | "serif" | "display";
};

export const FONT_OPTIONS: FontOption[] = [
  // ── Handwritten ──────────────────────────────────────────────────────────────
  {
    label: "Patrick Hand",
    cssFamily: "'Patrick Hand', cursive",
    googleFont: "Patrick Hand",
    style: "Friendly handwriting",
    category: "handwritten",
  },
  {
    label: "Caveat",
    cssFamily: "'Caveat', cursive",
    googleFont: "Caveat",
    style: "Casual handwriting",
    category: "handwritten",
  },
  {
    label: "Kalam",
    cssFamily: "'Kalam', cursive",
    googleFont: "Kalam",
    style: "Warm handwriting",
    category: "handwritten",
  },
  {
    label: "Architects Daughter",
    cssFamily: "'Architects Daughter', cursive",
    googleFont: "Architects Daughter",
    style: "Childlike printing",
    category: "handwritten",
  },
  {
    label: "Dancing Script",
    cssFamily: "'Dancing Script', cursive",
    googleFont: "Dancing Script",
    style: "Flowing cursive",
    category: "handwritten",
  },
  {
    label: "Pacifico",
    cssFamily: "'Pacifico', cursive",
    googleFont: "Pacifico",
    style: "Retro script",
    category: "handwritten",
  },

  // ── Rounded / Soft ───────────────────────────────────────────────────────────
  {
    label: "Nunito",
    cssFamily: "'Nunito', sans-serif",
    googleFont: "Nunito",
    style: "Rounded & clean",
    category: "rounded",
  },
  {
    label: "Quicksand",
    cssFamily: "'Quicksand', sans-serif",
    googleFont: "Quicksand",
    style: "Geometric, soft",
    category: "rounded",
  },
  {
    label: "Comfortaa",
    cssFamily: "'Comfortaa', cursive",
    googleFont: "Comfortaa",
    style: "Rounded, modern",
    category: "rounded",
  },
  {
    label: "Baloo 2",
    cssFamily: "'Baloo 2', cursive",
    googleFont: "Baloo+2",
    style: "Playful & legible",
    category: "rounded",
  },
  {
    label: "Fredoka",
    cssFamily: "'Fredoka', sans-serif",
    googleFont: "Fredoka",
    style: "Bubbly & bold",
    category: "rounded",
  },

  // ── Display ──────────────────────────────────────────────────────────────────
  // Only the bold weight is requested from Google (`:wght@700`), so this is the
  // one weight loaded for the "Amatic SC" family everywhere in the app --
  // avoids a same-cssFamily collision with a hypothetical regular variant,
  // which would make getGoogleFontName's lookup (keyed on cssFamily) ambiguous.
  {
    label: "Amatic SC Bold",
    cssFamily: "'Amatic SC', cursive",
    googleFont: "Amatic+SC:wght@700",
    style: "Bold hand-lettered display",
    category: "display",
  },

  // ── Classic Serif ─────────────────────────────────────────────────────────────
  {
    label: "Lora",
    cssFamily: "'Lora', serif",
    googleFont: "Lora",
    style: "Classic book serif",
    category: "serif",
  },
  {
    label: "Playfair Display",
    cssFamily: "'Playfair Display', serif",
    googleFont: "Playfair+Display",
    style: "Elegant, fairy-tale",
    category: "serif",
  },
  {
    label: "EB Garamond",
    cssFamily: "'EB Garamond', serif",
    googleFont: "EB+Garamond",
    style: "Timeless, literary",
    category: "serif",
  },
  {
    label: "Georgia",
    cssFamily: "Georgia, serif",
    googleFont: null,
    style: "Classic system serif",
    category: "serif",
  },
];

export const FONT_CATEGORIES: { id: FontOption["category"]; label: string }[] = [
  { id: "handwritten", label: "Handwritten" },
  { id: "rounded",     label: "Rounded" },
  { id: "display",     label: "Display" },
  { id: "serif",       label: "Serif" },
];

export function getGoogleFontName(cssFamily: string): string | null {
  const normalize = (s: string) => s.replace(/'/g, "").replace(/"/g, "");
  return FONT_OPTIONS.find((f) => normalize(f.cssFamily) === normalize(cssFamily))?.googleFont ?? null;
}

/** CSS @import URL for all Google Fonts used in font options */
export const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=" +
  FONT_OPTIONS.filter((f) => f.googleFont)
    .map((f) => f.googleFont!)
    .join("&family=") +
  "&display=swap";
