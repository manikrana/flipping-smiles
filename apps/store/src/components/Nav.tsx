"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

const links = [
  { href: "/books", label: "Books" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQs" },
  { href: "/track", label: "Track Order" },
];

export function Nav({ cartCount = 0, cartTotal = 0 }: { cartCount?: number; cartTotal?: number }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-4 pt-4">
      <div
        className={`max-w-6xl mx-auto glass rounded-full transition-shadow duration-300 ${
          scrolled ? "shadow-[0_16px_40px_-18px_rgba(201,138,46,0.4)]" : ""
        }`}
      >
        <div className="px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center shrink-0">
            <Image
              src="/brand/logo-horizontal.png"
              alt="Flipping Smiles"
              width={2119}
              height={742}
              priority
              className="h-[50px] w-auto opacity-95"
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm font-medium text-ink/60 hover:text-ink transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            {cartCount > 0 && (
              <Link
                href="/cart"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/60 hover:text-ink transition-colors"
              >
                🛒 {cartCount} · ${cartTotal}
              </Link>
            )}
            <Link
              href="/books"
              className="inline-flex items-center gap-1.5 bg-brand-500 text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-brand-600 transition-colors"
            >
              Try Now for Free
            </Link>
          </div>

          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-2 text-ink/60 hover:text-ink"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
          >
            {menuOpen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-white/40 px-6 py-4 space-y-3">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="block text-sm font-medium text-ink/70 hover:text-ink py-1"
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </Link>
            ))}
            {cartCount > 0 && (
              <Link
                href="/cart"
                className="block text-sm font-medium text-ink/70 hover:text-ink py-1"
                onClick={() => setMenuOpen(false)}
              >
                🛒 Cart · {cartCount} · ${cartTotal}
              </Link>
            )}
            <Link
              href="/books"
              className="block text-center bg-brand-500 text-white text-sm font-semibold px-5 py-3 rounded-xl mt-2"
              onClick={() => setMenuOpen(false)}
            >
              Try Now for Free
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
