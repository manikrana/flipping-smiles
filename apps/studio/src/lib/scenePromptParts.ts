// Shared prompt fragments for "one continuous wide image, one half full-detail /
// one half dissolving to legible background" generations (story spreads, and
// the wraparound cover). Not a "use server" file -- these are plain constants,
// and a "use server" module can only export async functions.

export const STYLE_TOKEN =
  "Pixar-style cinematic 3D rendering, physically based lighting, soft global illumination, subtle depth of field, photorealistic materials";

// STYLE_TOKEN's "subtle depth of field" directly contradicts any prompt that
// also demands uniform sharpness/detail across the whole canvas edge to edge
// (no soft/blurred regions) -- a real self-contradiction first caught in the
// story-spread "_clean" layout, and equally present in the cover prompt
// (which also wants consistent, fully-rendered detail across the whole
// wraparound image, not a shallow-focus hero with a blurry background).
export const STYLE_TOKEN_SHARP = STYLE_TOKEN.replace(/,\s*subtle depth of field/i, "");

export const FORBIDDEN_STYLES =
  "watercolor, ink wash, paint splashes, sketch lines, 2D illustration, flat gradients, anime, cartoon outlines, any painterly style shift";

export const DISSOLVE_FUNCTION = `DISSOLVE FUNCTION — spatial X-axis entropy gradient (origin at center seam, measured from seam outward):
  X 0.00–0.35 → STRUCTURE ZONE: full background geometry continues; same perspective, lighting model, and material rendering intact
  X 0.35–0.65 → DECOMPOSITION ZONE: geometry softens into volumetric light scatter, depth-of-field bloom, soft particle diffusion; no hard edges remain
  X 0.65–1.00 → ABSTRACT ZONE: no recognizable geometry; only ambient light frequencies, soft haze, and particle fields drawn from the scene's color palette. This zone must be very low contrast and near-white`;
