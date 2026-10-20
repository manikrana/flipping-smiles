// Pure, isomorphic prompt-assembly for the wraparound cover (back cover +
// spine + front cover). Deliberately NOT a "use server" file -- CoverEditor
// calls this client-side to show a live, editable prompt preview before
// generating. The server action that actually calls Gemini receives whatever
// final text ends up in that editable preview, not a re-derived string, so a
// hand-edit sticks.
//
// Pure scene generation -- no text of any kind. An earlier version asked
// Gemini to ingrain the title/subtitle/company name as real integrated
// lettering, but that made the font unreliable (Gemini can only approximate
// a named font, not reproduce its real letterforms) and made the back-cover
// continuity problem worse (the model would echo/duplicate baked-in title
// text across the seam). Title/subtitle are composited afterward as real SVG
// text in the actual font file (lib/layout.ts's renderCoverSpread), which is
// both pixel-accurate and removes text entirely from the generation task.
//
// The back-cover zone asks for a plain, calm, natural continuation of the
// same environment -- not an equally-detailed independently-composed scene
// (that "diptych" ask reliably produced two disconnected-looking scenes),
// and NOT a dissolve/sparkle/particle-fade treatment either (tried once --
// looked out of place since, unlike story-page spreads, only part of the
// back cover ends up covered by an overlay, leaving the hazy portion plainly
// visible). Just a quieter, uncluttered version of the same place.
//
// IMPORTANT: never put raw coordinates/percentages/axis-style notation (e.g.
// "X 40%-60%") in this prompt. An earlier version used that to describe zone
// boundaries and Gemini rendered the literal "X 0%-48%" text into the image
// as if it were a label to draw -- described zones qualitatively instead
// ("the right side", "the left side").
//
// Aspect ratio is requested here in prose ("16:9 widescreen") AND set for
// real via imageConfig.aspectRatio in the caller (generateCoverSpread /
// generateCoverSwapTemplate in book/actions.ts) -- this prompt used to only
// ask for "approximately 1.88:1" in prose with no real imageConfig field set,
// the exact gap that caused the seam bug in story-page spreads (an
// unsupported/unset ratio with prose-only guidance let Gemini satisfy "wide"
// by generating two joined tiles instead of one camera shot). 16:9 is the
// closest Gemini-supported ratio to the true ~1.88:1 print canvas; the print
// pipeline already reads the actual returned width/height rather than
// assuming 1.88:1, so this mismatch is harmless.
//
// Style: uses STYLE_TOKEN_SHARP (STYLE_TOKEN with "subtle depth of field"
// stripped), not plain STYLE_TOKEN -- this prompt demands uniform, fully-
// rendered detail across the whole wraparound canvas (see ABSOLUTE RULES
// below), which "subtle depth of field" directly contradicts. Same fix
// applied to the story-spread "_clean" layout for the same reason.

import { STYLE_TOKEN_SHARP, FORBIDDEN_STYLES } from "@/lib/scenePromptParts";
import type { TitleBlockPosition } from "@/lib/supabase/types";

export type { TitleBlockPosition };

export const TITLE_POSITIONS: { value: TitleBlockPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "middle-left", label: "Middle left" },
  { value: "middle-center", label: "Middle center" },
  { value: "middle-right", label: "Middle right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];

export type CoverPromptInput = {
  sceneDescription: string;
};

export function buildCoverPrompt(input: CoverPromptInput): string {
  const { sceneDescription } = input;

  return (
    `OUTPUT: a single FLAT, edge-to-edge illustration in 16:9 widescreen (landscape), filling the entire canvas with the scene itself — one continuous seamless image, NOT two separate images.\n\n` +
    `CRITICAL — READ BEFORE GENERATING: this is raw print artwork that gets trimmed straight to the paper edge, NOT a product mockup, NOT a framed print, NOT a matted photograph. There is no border, mat, passe-partout, or margin of ANY color (gray, white, cream, black, or anything else) anywhere in the output. The very first row and column of pixels at the top, bottom, left, and right edges must already be scene content (sky, foliage, ground) — as if you took a real wide-angle photograph and the print trims flush to its edge, with nothing surrounding it. Also forbidden: any surrounding background, table, or backdrop behind the image; any drop shadow, cast shadow, or glow around the image edges; any rounded corners on the image itself; any depiction of the book as a 3D object (cover boards, pages, spine crease, gutter shadow, perspective/foreshortening of the book itself).\n\n` +
    `━━━ COVER CONCEPT ━━━\n${sceneDescription}\n\n` +
    `Render this as a single wide-angle shot — one continuous physical space, as if a panoramic camera panned across it in one unbroken pass. Same camera, same lighting, same ground plane throughout.\n\n` +
    `━━━ SCENE ZONE LAYOUT ━━━\n` +
    `Before placing anything else, first decide on ONE specific, concrete ground and immediate environment for the entire canvas — a single type of terrain, path, or surface (e.g. a grassy path lined with palm trees, a cobblestone street, a forest floor with ferns, a sandy dune) and a single sky and lighting condition. This one ground and sky must run unbroken across the whole canvas, left edge to right edge — it is what makes the two sides read as one real place instead of two different ones, especially when the cover concept itself names several landmarks that would never really sit next to each other (they are a symbolic arrangement around the hero, not a literal single location, so the GROUND they all stand on is the thing that has to stay singular and consistent).\n` +
    `The RIGHT side of the canvas is the FRONT COVER — the hero character stands on that established ground, and any named landmarks/animals/vehicles from the cover concept appear here around them, rendered at full detail. Title and subtitle text are added separately afterward, so leave clear, uncluttered space in the lower portion of this side for them.\n` +
    `The LEFT side of the canvas is the BACK COVER — the SAME ground, sky, and immediate surroundings established above, simply continuing further to the left with nothing new added: no landmarks, no additional characters, no different terrain, vegetation, or time of day. Keep it visually calm and simple, but render it as a normal, fully real photographic scene — not faded, not dissolving, no sparkle, glow, haze, or particle effects, no vignette. It must look like the ground physically keeps going underfoot, not a different pretty place.\n` +
    `Do not invent a differently-themed backdrop for the back — it must read as the immediate surroundings of the front, not a separate pretty scene.\n` +
    `A solid spine band will be printed over the narrow seam between these two zones later, so it does not need to be precise there.\n\n` +
    `━━━ STYLE ━━━\n` +
    `Style: ${STYLE_TOKEN_SHARP}\n` +
    `Forbidden: ${FORBIDDEN_STYLES}\n\n` +
    `ABSOLUTE RULES:\n` +
    `  - No text, letters, numbers, symbols, coordinates, labels, or watermarks anywhere in the image — title, subtitle, and company name are composited on afterward\n` +
    `  - No mockup, no product shot, no background/table/shadow/frame/mat/border of any color around the image, no rounded corners, no 3D book rendering — the scene's own content must touch all four edges of the canvas directly, full-bleed, zero margin\n` +
    `  - One continuous scene — identical ground plane, sky, lighting, and camera angle across the full width\n` +
    `  - Exactly one ground/terrain type and one sky for the whole canvas — landmarks and characters sit on top of it, they don't change what it is\n` +
    `  - No dissolve, fade, sparkle, glow, particle, or haze effect anywhere — a normal, fully rendered photographic scene throughout\n` +
    `  - Do not introduce elements not implied by the cover concept`
  );
}
