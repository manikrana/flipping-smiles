import Link from "next/link";
import Image from "next/image";

const nav = [
  { label: "Books", href: "/books" },
  { label: "About Us", href: "/about" },
  { label: "FAQs", href: "/faq" },
  { label: "Track Order", href: "/track" },
];

const legal = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
];

export function Footer() {
  return (
    <footer className="bg-ink text-cream/60">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="flex flex-col md:flex-row justify-between gap-10 mb-12">
          {/* Brand */}
          <div className="max-w-xs">
            <Link href="/" className="flex items-center mb-4">
              <Image
                src="/brand/logo-horizontal-dark.png"
                alt="Flipping Smiles"
                width={2120}
                height={742}
                className="h-12 lg:h-16 w-auto"
              />
            </Link>
            <p className="text-sm leading-relaxed">
              Every child deserves to be the hero of their own story. We make that happen — one magical book at a time.
            </p>
          </div>

          {/* Links */}
          <div className="flex gap-10 sm:gap-16">
            <div>
              <h4 className="text-sm font-semibold text-cream mb-4">Explore</h4>
              <ul className="space-y-3">
                {nav.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm hover:text-cream transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-cream mb-4">Trust</h4>
              <ul className="space-y-3 text-sm">
                <li>🔒 Photo Privacy</li>
                <li>⭐ Satisfaction Guaranteed</li>
                <li>🎨 Premium Quality</li>
                <li>👁️ Free Preview First</li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-cream mb-4">Legal</h4>
              <ul className="space-y-3">
                {legal.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm hover:text-cream transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-cream/10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <p>© {new Date().getFullYear()} Flipping Smiles. All rights reserved.</p>
          <p className="text-brand-400">Made with ✦ for curious little minds</p>
        </div>
      </div>
    </footer>
  );
}
