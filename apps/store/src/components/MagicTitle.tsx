import type { ReactNode } from "react";

// Personalized book title wrapped in a glowing golden stardust swirl, echoing
// the sparkle trail around the Christmas tree in the book's illustrations.
// Pure SVG + CSS (animations in globals.css), so it renders identically on every
// load and for every book; the text stays a real <h1>. Animations switch off
// for prefers-reduced-motion.

// Four-point sparkle centered on (0,0), scaled by the caller.
const SPARKLE = "M0,-10 C1.2,-2.4 2.4,-1.2 10,0 C2.4,1.2 1.2,2.4 0,10 C-1.2,2.4 -2.4,1.2 -10,0 C-2.4,-1.2 -1.2,-2.4 0,-10 Z";

// One swirl that starts low-left, sweeps under the title, climbs the right side
// and arcs back over the top -- like a ribbon wrapped around the words.
const SWIRL = "M20,150 C120,196 420,190 560,150 C650,124 660,60 600,34 C520,0 330,-6 150,22 C90,32 60,46 48,62";

const SPARKLES: { x: number; y: number; s: number; delay: string }[] = [
  { x: 48, y: 62, s: 1.4, delay: "0s" },
  { x: 150, y: 22, s: 0.8, delay: "1.2s" },
  { x: 330, y: 2, s: 0.6, delay: "0.4s" },
  { x: 520, y: 8, s: 0.9, delay: "2s" },
  { x: 612, y: 44, s: 1.2, delay: "0.9s" },
  { x: 628, y: 112, s: 0.7, delay: "2.4s" },
  { x: 560, y: 150, s: 1, delay: "1.6s" },
  { x: 300, y: 186, s: 0.75, delay: "0.2s" },
  { x: 120, y: 176, s: 0.9, delay: "2.8s" },
  { x: 20, y: 150, s: 0.65, delay: "1s" },
  { x: 8, y: 92, s: 0.5, delay: "3.2s" },
];

export function MagicTitle({ children, kicker }: { children: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="relative inline-block px-8 py-6">
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 640 190"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="magic-gold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FCAE21" stopOpacity="0.15" />
            <stop offset="25%" stopColor="#FFC94A" />
            <stop offset="55%" stopColor="#FFF1C2" />
            <stop offset="80%" stopColor="#FFC94A" />
            <stop offset="100%" stopColor="#FCAE21" stopOpacity="0.4" />
          </linearGradient>
          <filter id="magic-halo" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id="magic-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Soft warm halo under the ribbon. */}
        <path d={SWIRL} fill="none" stroke="#FFC94A" strokeOpacity="0.45" strokeWidth="14" strokeLinecap="round" filter="url(#magic-halo)" />
        {/* Bright glowing ribbon core. */}
        <path d={SWIRL} fill="none" stroke="url(#magic-gold)" strokeWidth="3.5" strokeLinecap="round" filter="url(#magic-glow)" />
        {/* Stardust drifting along the ribbon. */}
        <path className="magic-dust" d={SWIRL} fill="none" stroke="#FFF6D8" strokeWidth="4" strokeLinecap="round" strokeDasharray="0.1 14" filter="url(#magic-glow)" />
        <path className="magic-dust magic-dust-slow" d={SWIRL} fill="none" stroke="#FFC94A" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="0.1 9" transform="translate(0 7)" />

        {SPARKLES.map((p, i) => (
          // Position lives on the <g>; the CSS twinkle scales the inner path, so the
          // two transforms don't override each other.
          <g key={i} transform={`translate(${p.x} ${p.y}) scale(${p.s})`}>
            <path className="magic-twinkle" d={SPARKLE} fill="#FFE08A" filter="url(#magic-glow)" style={{ animationDelay: p.delay }} />
          </g>
        ))}
      </svg>
      {kicker}
      <h1
        className="relative font-display text-3xl sm:text-4xl font-bold leading-tight bg-clip-text text-transparent"
        // Logo orange (#FC6E07) deepening to its rusty outline tone, so the
        // title reads as part of the Flipping Smiles brand rather than plain black.
        style={{ backgroundImage: "linear-gradient(180deg, #FC6E07 0%, #E25A05 55%, #A63A06 100%)" }}
      >
        {children}
      </h1>
    </div>
  );
}
