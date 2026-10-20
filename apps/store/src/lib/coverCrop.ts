// The wraparound cover image (back cover + spine + front cover, ~1.882:1,
// generated at 4800x2550 -- see apps/studio's generateCoverSpread) needs to
// show ONLY the front-cover portion in customer-facing thumbnails, cropped
// precisely to the real front content zone, not just "mostly the right side".
//
// Confirmed live from Gelato's own cover-dimensions API (apps/studio/src/lib/gelato.ts):
// for the common inner-page-count range, the front content zone starts at
// ~52.4% of the total width (240mm of 458mm) -- i.e. is ~47.6% wide. A plain
// `object-fit: cover` in a SQUARE box naturally reveals 2550/4800 = 53.1% of
// the width, which is wider than that -- enough to bleed a sliver of the
// spine/back cover in on the left edge. Scaling the image up ~1.13x, anchored
// to the right edge (object-right + origin-right), narrows the revealed
// slice to match the real front zone. Plain Tailwind classes (not inline
// style) so callers can still compose their own hover/transition classes.
export const FRONT_COVER_IMAGE_CLASSES = "object-cover object-right origin-right scale-[1.13]";
