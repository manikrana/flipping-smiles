import type { TitleBlockPosition } from "@/lib/supabase/types";

// Shared by every "show the real front cover" preview surface (CoverEditor,
// PreviewPanel, OrderBookPreview) so title/subtitle/company-name position and
// style match the real print layout in lib/layout.ts's renderCoverSpread
// exactly. The front-cover art itself is a pure, text-free scene (see
// lib/coverPrompt.ts) -- this is a real, precise overlay, not baked into the
// AI art.
//
// Title/subtitle follow layout.titlePosition's 9-zone grid, against a radial
// dark glow centered on wherever the title actually sits (overlayOpacity at
// its peak) rather than a flat scrim over the whole panel -- a flat scrim
// read as dull, darkening art nowhere near the text just to keep one corner
// of it legible. The company name is a small, understated imprint pinned to
// the very bottom of the panel regardless of where the title sits -- when
// the title itself is bottom-anchored, extra bottom padding keeps the two
// from colliding.
//
// Render inside a `position: relative` container with `containerType: "size"`
// set so the cqh units below resolve against that container's own box, not
// the page.

export type FrontCoverOverlayProps = {
  title: string;
  subtitle: string;
  companyName: string | null;
  titlePosition: TitleBlockPosition;
  titleColor: string;
  subtitleColor: string;
  titleSize: number;
  subtitleSize: number;
  overlayOpacity: number;
  fontFamily: string;
};

export function FrontCoverOverlay({
  title, subtitle, companyName, titlePosition, titleColor, subtitleColor, titleSize, subtitleSize, overlayOpacity, fontFamily,
}: FrontCoverOverlayProps) {
  const [vPos, hPos] = titlePosition.split("-") as ["top" | "middle" | "bottom", "left" | "center" | "right"];
  const alignItems = vPos === "top" ? "flex-start" : vPos === "bottom" ? "flex-end" : "center";
  const justifyContent = hPos === "left" ? "flex-start" : hPos === "right" ? "flex-end" : "center";
  const textAlign = hPos === "left" ? "left" : hPos === "right" ? "right" : "center";
  const glowX = hPos === "left" ? 28 : hPos === "right" ? 72 : 50;
  const glowY = vPos === "top" ? 28 : vPos === "bottom" ? 72 : 50;

  return (
    <>
      <div
        className="absolute inset-0 flex p-[4%]"
        style={{
          alignItems,
          justifyContent,
          paddingBottom: vPos === "bottom" && companyName ? "8%" : undefined,
          background: `radial-gradient(circle at ${glowX}% ${glowY}%, rgba(0,0,0,${overlayOpacity}) 0%, rgba(0,0,0,0) 65%)`,
        }}
      >
        <div className="flex flex-col gap-[0.5cqh]" style={{ textAlign }}>
          <span style={{ fontFamily, fontSize: `${titleSize}cqh`, color: titleColor, fontWeight: 700, textShadow: "0 2px 6px rgba(0,0,0,0.5)", lineHeight: 1.1 }}>
            {title}
          </span>
          <span style={{ fontFamily, fontSize: `${subtitleSize}cqh`, color: subtitleColor, textShadow: "0 2px 6px rgba(0,0,0,0.5)", lineHeight: 1.2 }}>
            {subtitle}
          </span>
        </div>
      </div>
      {companyName && (
        <span
          className="absolute bottom-[2.5%] left-1/2 whitespace-nowrap"
          style={{ transform: "translateX(-50%)", fontFamily, fontSize: "2.2cqh", color: "#ffffff", textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}
        >
          {companyName}
        </span>
      )}
    </>
  );
}
