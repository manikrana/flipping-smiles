import { createServerClient } from "@/lib/supabase/server";
import { signAssets, resolveStoragePath } from "@/lib/supabase/assets";
import { getCartId } from "@/lib/cart";
import { getCompanyName } from "@/lib/brand";
import { WizardProgress } from "@/components/WizardProgress";
import { CartForm, type CartItem } from "./CartForm";
import { DEFAULT_COVER_LAYOUT, type CoverLayout } from "@/lib/supabase/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const cartId = await getCartId();
  const supabase = createServerClient();

  const [orders, companyName] = await Promise.all([
    cartId
      ? (
          await supabase
            .from("orders")
            .select("id, hero_name, amount_usd, created_at, stories(title, cover_image_url, cover_layout)")
            .eq("cart_id", cartId)
            .eq("status", "pending_payment")
            .order("created_at")
        ).data
      : null,
    getCompanyName(),
  ]);

  if (!orders || orders.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-brand-100 via-accent-100 to-cream flex items-center justify-center px-6">
        <div className="glass rounded-3xl p-8 max-w-md w-full text-center space-y-4">
          <div className="text-5xl">📚</div>
          <h1 className="text-xl font-bold text-ink">Your cart is empty</h1>
          <p className="text-sm text-ink/50">Personalize a book to get started.</p>
          <Link href="/books" className="inline-block bg-brand-500 hover:bg-brand-600 text-white font-semibold px-6 py-3 rounded-2xl text-sm transition-colors">
            Browse books →
          </Link>
        </div>
      </div>
    );
  }

  const coverPaths = orders
    .map((o) => {
      const story = o.stories as unknown as { cover_image_url: string | null } | null;
      return story?.cover_image_url ? resolveStoragePath(story.cover_image_url) : null;
    })
    .filter((p): p is string => !!p);
  const signedCovers = await signAssets(supabase, coverPaths);

  const items: CartItem[] = orders.map((o) => {
    const story = o.stories as unknown as { title: string; cover_image_url: string | null; cover_layout: CoverLayout | null } | null;
    const coverPath = story?.cover_image_url ? resolveStoragePath(story.cover_image_url) : null;
    return {
      id: o.id,
      heroName: o.hero_name,
      storyTitle: story?.title ?? "Personalized book",
      coverUrl: coverPath ? (signedCovers[coverPath] ?? null) : null,
      coverLayout: { ...DEFAULT_COVER_LAYOUT, ...(story?.cover_layout ?? {}) },
      amountUsd: o.amount_usd,
    };
  });

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-brand-100 via-accent-100 to-cream">
      {/* overflow-hidden isolated to this layer only -- it breaks position:sticky on ancestors */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-40 -right-32 w-96 h-96 rounded-full bg-brand-400/35 blur-3xl" />
        <div className="absolute bottom-0 -left-32 w-96 h-96 rounded-full bg-accent-400/30 blur-3xl" />
      </div>
      {/* Top bar -- floating inset pill, matching the nav's treatment */}
      <div className="sticky top-20 z-10 px-4">
        <div className="max-w-6xl mx-auto glass rounded-full px-6 py-3 flex items-center justify-between">
          <Link href="/books" className="text-sm text-ink/40 hover:text-ink transition-colors flex items-center gap-1 shrink-0">
            ← Back to books
          </Link>
          <WizardProgress current={3} />
          <span className="hidden sm:inline text-xs text-ink/30 shrink-0">
            {items.length} {items.length === 1 ? "book" : "books"}
          </span>
        </div>
      </div>

      <div className="relative max-w-lg mx-auto px-6 pt-10 pb-20 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-ink mb-1">Complete your order</h1>
          <p className="text-sm text-ink/40">
            {items.length === 1 ? items[0].storyTitle : `${items.length} personalized books`}
          </p>
        </div>

        <CartForm items={items} companyName={companyName} />
      </div>
    </div>
  );
}
