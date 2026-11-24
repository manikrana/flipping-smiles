import type { ReactNode } from "react";

// Personalized book title with a "touched by the wand" feel: logo-orange letters
// with a soft warm glow, a golden glint that sweeps across them every few
// seconds, and a few sparkles twinkling at the corners. Pure CSS/SVG (animations
// in globals.css), identical on every load; the text stays a real <h1>.
// Motion switches off for prefers-reduced-motion.

const SPARKLE = "M0,-10 C1.2,-2.4 2.4,-1.2 10,0 C2.4,1.2 1.2,2.4 0,10 C-1.2,2.4 -2.4,1.2 -10,0 C-2.4,-1.2 -1.2,-2.4 0,-10 Z";

// Positions are relative to the title block (percent), sizes in px.
const SPARKLES: { left: string; top: string; size: number; delay: string }[] = [
  { left: "-4%", top: "8%", size: 22, delay: "0s" },
  { left: "3%", top: "-12%", size: 12, delay: "1.4s" },
  { left: "101%", top: "30%", size: 18, delay: "0.7s" },
  { left: "95%", top: "-6%", size: 11, delay: "2.1s" },
  { left: "92%", top: "92%", size: 14, delay: "1s" },
  { left: "-1%", top: "88%", size: 10, delay: "2.6s" },
];

export function MagicTitle({ children, kicker }: { children: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="relative inline-block">
      {kicker}
      <div className="relative inline-block">
        <h1 className="magic-title relative font-display text-3xl sm:text-4xl font-bold leading-tight">{children}</h1>
        {SPARKLES.map((s, i) => (
          <svg
            key={i}
            aria-hidden
            className="magic-sparkle pointer-events-none absolute"
            viewBox="-12 -12 24 24"
            width={s.size}
            height={s.size}
            style={{ left: s.left, top: s.top, animationDelay: s.delay }}
          >
            <path d={SPARKLE} fill="#FCAE21" />
          </svg>
        ))}
      </div>
    </div>
  );
}
