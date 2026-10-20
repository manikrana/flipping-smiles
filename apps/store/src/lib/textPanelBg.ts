import { patternToCss } from "@/lib/patterns";
import type { TextPanelBg } from "@/lib/supabase/types";

// Mirrors apps/studio/src/lib/textPanelBg.ts exactly -- used by split_image
// layouts' separate text page, matching what the print pipeline renders.
export function panelBgStyle(bg: TextPanelBg | null, textBgUrl?: string | null): React.CSSProperties {
  if (!bg || bg.type === "none") return {};
  if (bg.type === "solid") return { backgroundColor: bg.color };
  if (bg.type === "gradient") {
    const dir = bg.direction === "to-bottom" ? "to bottom" : bg.direction === "to-right" ? "to right" : "to bottom right";
    return { background: `linear-gradient(${dir}, ${bg.from}, ${bg.to})` };
  }
  if (bg.type === "pattern") return patternToCss(bg.patternId, bg.color, bg.bgColor) as React.CSSProperties;
  if (bg.type === "scene_bleed" && textBgUrl) {
    return {
      backgroundImage: `url(${textBgUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }

  return {};
}
