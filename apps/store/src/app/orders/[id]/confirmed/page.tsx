import { createServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

export default async function OrderConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, hero_name, contact_email, stories(title)")
    .eq("id", id)
    .single();

  if (!order) notFound();

  // Stripe redirects here as soon as the card is confirmed client-side, which
  // can be a beat before our webhook (the source of truth) marks the order
  // paid. Show a lightweight "confirming" state and poll until it lands.
  if (order.status === "pending_payment") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-400 via-accent-300 to-brand-600 flex items-center justify-center px-6">
        <AutoRefresh />
        <div className="max-w-md w-full text-center space-y-4 py-20">
          <div className="text-5xl animate-pulse">💳</div>
          <h1 className="text-xl font-bold text-ink">Confirming your payment…</h1>
          <p className="text-sm text-ink/50">This only takes a moment.</p>
        </div>
      </div>
    );
  }

  const story = order.stories as unknown as { title: string } | null;

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-brand-400 via-accent-300 to-brand-600 flex items-center justify-center px-6 overflow-hidden">
      <div className="absolute top-10 -left-24 w-96 h-96 rounded-full bg-white/25 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-24 w-96 h-96 rounded-full bg-accent-200/40 blur-3xl pointer-events-none" />
      <div className="relative max-w-md w-full space-y-6 py-20">

        {/* Success card */}
        <div className="glass rounded-3xl p-8 text-center space-y-4">
          <div className="text-6xl">🎉</div>
          <h1 className="text-2xl font-bold text-ink">Order confirmed!</h1>
          <p className="text-sm text-ink/60 leading-relaxed">
            <strong>{order.hero_name}</strong> is about to become the star of <strong>{story?.title ?? "their very own book"}</strong>.
          </p>
          {order.contact_email && (
            <p className="text-xs text-ink/40">
              We&apos;ll keep you updated at <strong>{order.contact_email}</strong>
            </p>
          )}
          <div className="text-xs font-mono text-ink/25 pt-1">
            Order {id.slice(0, 8).toUpperCase()}
          </div>
        </div>

        {/* What happens next */}
        <div className="glass rounded-3xl p-6 space-y-3">
          <p className="text-xs font-semibold text-ink/40 uppercase tracking-wider">What happens next</p>
          <div className="space-y-3 text-sm text-ink/70">
            <div className="flex gap-3">
              <span>✏️</span>
              <span>Our team personalises every page with <strong>{order.hero_name}</strong> as the hero</span>
            </div>
            <div className="flex gap-3">
              <span>🖨️</span>
              <span>We send it to print — estimated <strong>3–5 business days</strong></span>
            </div>
            <div className="flex gap-3">
              <span>📦</span>
              <span>Your book ships straight to your door</span>
            </div>
          </div>
        </div>

        {/* Upsell CTA */}
        <div className="text-center space-y-3">
          <p className="text-sm text-ink/50">Every child deserves their own story — explore more books</p>
          <Link
            href="/books"
            className="block w-full bg-ink text-white font-semibold py-3 rounded-2xl text-sm text-center hover:bg-ink/80 transition-colors"
          >
            Browse all books →
          </Link>
        </div>

      </div>
    </div>
  );
}
