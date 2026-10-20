import type { Metadata } from "next";
import { Fraunces, DM_Sans, Grand_Hotel } from "next/font/google";
import "./globals.css";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { PageViewTracker } from "@/components/PageViewTracker";
import { getCartId } from "@/lib/cart";
import { createServerClient } from "@/lib/supabase/server";
import { GOOGLE_FONTS_URL } from "@/lib/fonts";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["300", "400", "600", "700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Wordmark script — "flipping smiles" logotype, nowhere else.
const grandHotel = Grand_Hotel({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-grand-hotel",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Flipping Smiles — Personalized Books for Kids",
  description: "Upload a photo, pick a story, and watch your child become the Pixar-style hero of their very own hardcover book.",
};

async function getCartSummary(): Promise<{ count: number; total: number }> {
  const cartId = await getCartId();
  if (!cartId) return { count: 0, total: 0 };

  const supabase = createServerClient();
  const { data } = await supabase
    .from("orders")
    .select("amount_usd")
    .eq("cart_id", cartId)
    .eq("status", "pending_payment");

  if (!data || data.length === 0) return { count: 0, total: 0 };
  return { count: data.length, total: data.reduce((sum, o) => sum + o.amount_usd, 0) };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { count: cartCount, total: cartTotal } = await getCartSummary();

  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${grandHotel.variable}`}>
      <head>
        {/* Per-story cover/text fonts are chosen dynamically from the DB (see
            lib/fonts.ts), so they can't go through next/font's static imports
            like the site's own brand fonts above -- load the whole catalog
            here instead, same as apps/studio does. */}
        <link rel="stylesheet" href={GOOGLE_FONTS_URL} />
      </head>
      <body className="min-h-screen bg-cream text-ink antialiased font-sans">
        <PageViewTracker />
        <Nav cartCount={cartCount} cartTotal={cartTotal} />
        <main>{children}</main>
        <Footer />
        <FeedbackWidget />
      </body>
    </html>
  );
}
