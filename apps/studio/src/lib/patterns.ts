/**
 * Built-in repeating SVG patterns for the text panel background.
 * Each pattern is defined as a tile of (width × height) with SVG inner elements.
 * Used in:
 *   - Browser: CSS background-image via data URI (patternToCss)
 *   - Server: SVG <pattern> element inside PDF/composite (patternToSvgDefs)
 */

export interface PatternDef {
  id: string;
  label: string;
  /** Tile width in px */
  width: number;
  /** Tile height in px */
  height: number;
  /** Returns SVG inner elements (no wrapper) with the given stroke/fill color */
  elements: (color: string) => string;
}

export const PATTERNS: PatternDef[] = [
  {
    id: "dots",
    label: "Dots",
    width: 30,
    height: 30,
    elements: (c) => `<circle cx="15" cy="15" r="4" fill="${c}"/>`,
  },
  {
    id: "stars",
    label: "Stars",
    width: 56,
    height: 56,
    elements: (c) =>
      `<path d="M28 10 L31.5 21 L43 21 L34 28 L37.5 39 L28 32 L18.5 39 L22 28 L13 21 L24.5 21 Z"
        fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`,
  },
  {
    id: "clouds",
    label: "Clouds",
    width: 110,
    height: 70,
    elements: (c) =>
      `<path d="M22 52 Q13 52 13 44 Q13 35 22 33 Q21 22 32 20 Q43 18 46 28 Q53 25 57 32 Q66 30 67 38 Q74 38 74 44 Q74 50 67 52 Z"
        fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`,
  },
  {
    id: "waves",
    label: "Waves",
    width: 80,
    height: 36,
    elements: (c) =>
      `<path d="M0 18 Q20 6 40 18 Q60 30 80 18"
        fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  },
  {
    id: "hearts",
    label: "Hearts",
    width: 52,
    height: 48,
    elements: (c) =>
      `<path d="M26 38 Q10 26 10 17 Q10 8 18 8 Q23 8 26 14 Q29 8 34 8 Q42 8 42 17 Q42 26 26 38 Z"
        fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`,
  },
  {
    id: "leaves",
    label: "Leaves",
    width: 60,
    height: 52,
    elements: (c) =>
      `<path d="M30 6 Q50 26 30 46 Q10 26 30 6 Z"
        fill="none" stroke="${c}" stroke-width="1.8"/>
       <line x1="30" y1="6" x2="30" y2="46" stroke="${c}" stroke-width="1.2"/>
       <line x1="30" y1="20" x2="40" y2="14" stroke="${c}" stroke-width="1"/>
       <line x1="30" y1="28" x2="20" y2="22" stroke="${c}" stroke-width="1"/>`,
  },
  {
    id: "stripes",
    label: "Stripes",
    width: 24,
    height: 24,
    elements: (c) =>
      `<line x1="0" y1="24" x2="24" y2="0" stroke="${c}" stroke-width="2"/>
       <line x1="-12" y1="12" x2="12" y2="-12" stroke="${c}" stroke-width="2"/>
       <line x1="12" y1="36" x2="36" y2="12" stroke="${c}" stroke-width="2"/>`,
  },
  {
    id: "diamonds",
    label: "Diamonds",
    width: 40,
    height: 40,
    elements: (c) =>
      `<path d="M20 4 L36 20 L20 36 L4 20 Z"
        fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`,
  },
  {
    id: "cross",
    label: "Cross-hatch",
    width: 24,
    height: 24,
    elements: (c) =>
      `<line x1="12" y1="0" x2="12" y2="24" stroke="${c}" stroke-width="1.5"/>
       <line x1="0" y1="12" x2="24" y2="12" stroke="${c}" stroke-width="1.5"/>`,
  },
  {
    id: "triangles",
    label: "Triangles",
    width: 50,
    height: 44,
    elements: (c) =>
      `<path d="M25 5 L44 38 L6 38 Z"
        fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`,
  },
];

export function getPattern(id: string): PatternDef | undefined {
  return PATTERNS.find((p) => p.id === id);
}

/** CSS properties for browser preview / live rendering */
export function patternToCss(
  patternId: string,
  color: string,
  bgColor: string
): Record<string, string> {
  const def = getPattern(patternId);
  if (!def) return { backgroundColor: bgColor };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${def.width}" height="${def.height}">${def.elements(color)}</svg>`;
  const dataUri = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

  return {
    backgroundColor: bgColor,
    backgroundImage: dataUri,
    backgroundSize: `${def.width}px ${def.height}px`,
    backgroundRepeat: "repeat",
  };
}

/** SVG defs + rect for server-side rendering (layout.ts / pdf.ts) */
export function patternToSvgDefs(
  patternId: string,
  color: string,
  bgColor: string,
  width: number,
  height: number
): string {
  const def = getPattern(patternId);
  if (!def) return `<rect width="${width}" height="${height}" fill="${bgColor}"/>`;

  return `<defs>
    <pattern id="bg-pat" x="0" y="0" width="${def.width}" height="${def.height}" patternUnits="userSpaceOnUse">
      <rect width="${def.width}" height="${def.height}" fill="${bgColor}"/>
      ${def.elements(color)}
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg-pat)"/>`;
}
