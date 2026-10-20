"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import {
  removeFromCart,
  saveCartContactAndShipping,
  createCartPaymentIntent,
  confirmDummyCartPayment,
} from "./actions";
import { FRONT_COVER_IMAGE_CLASSES } from "@/lib/coverCrop";
import { FrontCoverOverlay } from "@/components/FrontCoverOverlay";
import type { CoverLayout } from "@/lib/supabase/types";

const STRIPE_ENABLED = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = STRIPE_ENABLED ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!) : null;

export type CartItem = {
  id: string;
  heroName: string;
  storyTitle: string;
  coverUrl: string | null;
  coverLayout: CoverLayout;
  amountUsd: number;
};

function CartCoverThumb({ item, companyName, className }: { item: CartItem; companyName: string | null; className: string }) {
  if (!item.coverUrl) return null;
  return (
    <div className={`relative shrink-0 rounded-xl overflow-hidden ${className}`} style={{ containerType: "size" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.coverUrl} alt="" className={`w-full h-full ${FRONT_COVER_IMAGE_CLASSES}`} />
      <FrontCoverOverlay
        title={item.storyTitle}
        subtitle={item.coverLayout.subtitle.replace(/{{hero_name}}/g, item.heroName)}
        companyName={companyName}
        titlePosition={item.coverLayout.titlePosition}
        titleColor={item.coverLayout.titleColor}
        subtitleColor={item.coverLayout.subtitleColor}
        titleSize={item.coverLayout.titleSize}
        subtitleSize={item.coverLayout.subtitleSize}
        overlayOpacity={item.coverLayout.overlayOpacity}
        fontFamily={item.coverLayout.fontFamily}
      />
    </div>
  );
}

export function CartForm({ items, companyName }: { items: CartItem[]; companyName: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const total = items.reduce((sum, i) => sum + i.amountUsd, 0);
  const inPaymentStep = !!clientSecret;

  function handleRemove(orderId: string) {
    setRemovingId(orderId);
    startTransition(async () => {
      await removeFromCart(orderId);
      router.refresh();
    });
  }

  function handleDetailsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveCartContactAndShipping(formData);
        if (STRIPE_ENABLED) {
          const { clientSecret } = await createCartPaymentIntent();
          setClientSecret(clientSecret);
        } else {
          // Test-mode bypass — no Stripe keys configured for this environment.
          await confirmDummyCartPayment();
          router.push("/cart/confirmed");
        }
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Item summary — compact single-item card, or a full list once there's more than one */}
      {items.length === 1 ? (
        <div className="glass rounded-3xl p-5 flex items-center gap-4">
          <CartCoverThumb item={items[0]} companyName={companyName} className="w-14 h-14" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink truncate">{items[0].heroName}&apos;s Book</p>
            <p className="text-xs text-ink/40 mt-0.5">{items[0].storyTitle} · Hardcover, printed &amp; shipped</p>
          </div>
          <p className="text-xl font-bold text-ink shrink-0">${items[0].amountUsd}</p>
          {!inPaymentStep && (
            <button
              type="button"
              onClick={() => handleRemove(items[0].id)}
              disabled={isPending && removingId === items[0].id}
              className="text-xs text-ink/30 hover:text-accent-500 transition-colors shrink-0 disabled:opacity-40"
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <div className="glass rounded-3xl p-5 space-y-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-4">
              <CartCoverThumb item={item} companyName={companyName} className="w-12 h-12" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink text-sm truncate">{item.heroName}&apos;s Book</p>
                <p className="text-xs text-ink/40 truncate">{item.storyTitle}</p>
              </div>
              <p className="font-semibold text-ink shrink-0">${item.amountUsd}</p>
              {!inPaymentStep && (
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  disabled={isPending && removingId === item.id}
                  className="text-xs text-ink/30 hover:text-accent-500 transition-colors shrink-0 disabled:opacity-40"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <div className="border-t border-ink/10 pt-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Total</p>
            <p className="text-xl font-bold text-ink">${total}</p>
          </div>
        </div>
      )}

      {!inPaymentStep && (
        <Link href="/books" className="inline-block text-sm text-brand-600 hover:text-brand-700 transition-colors">
          + Add another book
        </Link>
      )}

      {clientSecret ? (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <PaymentStep total={total} onBack={() => setClientSecret(null)} />
        </Elements>
      ) : (
        <form onSubmit={handleDetailsSubmit} className="space-y-5">
          {!STRIPE_ENABLED && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-2xl text-xs font-medium">
              Test mode — Stripe isn&apos;t configured, payment will be simulated.
            </div>
          )}

          <div className="glass rounded-3xl p-5 space-y-4">
            <p className="font-semibold text-ink">Contact</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-ink/50 mb-1">Full name *</label>
                <input name="name" required placeholder="Jane Smith"
                  className="w-full border border-ink/10 rounded-xl px-4 py-2.5 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-ink/25" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink/50 mb-1">Email *</label>
                  <input name="email" type="email" required placeholder="you@email.com"
                    className="w-full border border-ink/10 rounded-xl px-4 py-2.5 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-ink/25" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink/50 mb-1">Phone</label>
                  <input name="phone" type="tel" placeholder="(555) 000-0000"
                    className="w-full border border-ink/10 rounded-xl px-4 py-2.5 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-ink/25" />
                </div>
              </div>
            </div>
          </div>

          <div className="glass rounded-3xl p-5 space-y-4">
            <p className="font-semibold text-ink">Shipping address</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-ink/50 mb-1">Street address *</label>
                <input name="address" required placeholder="123 Main St"
                  className="w-full border border-ink/10 rounded-xl px-4 py-2.5 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-ink/25" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink/50 mb-1">City *</label>
                  <input name="city" required placeholder="San Francisco"
                    className="w-full border border-ink/10 rounded-xl px-4 py-2.5 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-ink/25" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink/50 mb-1">State</label>
                  <input name="state" placeholder="CA"
                    className="w-full border border-ink/10 rounded-xl px-4 py-2.5 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-ink/25" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink/50 mb-1">ZIP code *</label>
                <input name="zip" required placeholder="94103" maxLength={10}
                  className="w-full border border-ink/10 rounded-xl px-4 py-2.5 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-ink/25" />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm">{error}</div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white font-bold py-4 rounded-2xl text-base transition-all hover:scale-[1.02] shadow-warm"
          >
            {isPending ? "Loading…" : STRIPE_ENABLED ? "Continue to payment →" : `Simulate payment · $${total}`}
          </button>
        </form>
      )}
    </div>
  );
}

function PaymentStep({ total, onBack }: { total: number; onBack: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/cart/confirmed`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }

    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      router.push("/cart/confirmed");
      return;
    }

    setSubmitting(false);
  }

  return (
    <form onSubmit={handlePay} className="space-y-5">
      <div className="glass rounded-3xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-ink">Payment</p>
          <button type="button" onClick={onBack} className="text-xs text-ink/40 hover:text-ink underline">
            ← Edit details
          </button>
        </div>
        <PaymentElement />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm">{error}</div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white font-bold py-4 rounded-2xl text-base transition-all hover:scale-[1.02] shadow-warm"
      >
        {submitting ? "Placing order…" : `Pay Now · $${total}`}
      </button>
    </form>
  );
}
