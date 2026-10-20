import type { GelatoCoverDimensions } from "@/lib/gelato";

// Pure geometry helper shared by every "show the real wraparound cover as a
// two-page spread" preview surface (CoverEditor, PreviewPanel,
// BookPagesEditor, OrderBookPreview). A spread container sized to
// `aspectRatio` and split into two equal-width halves naturally crops each
// half to (almost) exactly the real front/back content zones, because the
// spine sits close to the true midpoint of the wraparound cover by
// construction -- so the halves just need object-position "left center" /
// "right center" (the same convention already used for spread_left/right
// story pages), no per-box percentage math needed. This helper only needs
// to provide the spine band's own position, which does vary with page count.
export function computeCoverZones(dims: GelatoCoverDimensions) {
  const totalWidth = dims.wraparoundInsideSize.width;
  return {
    aspectRatio: `${dims.wraparoundInsideSize.width} / ${dims.wraparoundInsideSize.height}`,
    spineLeftPct: (dims.spineSize.left / totalWidth) * 100,
    spineWidthPct: (dims.spineSize.width / totalWidth) * 100,
  };
}
