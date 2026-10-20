"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { saveContactAndShipping, createPaymentIntent, confirmDummyPayment } from "./actions";

const STRIPE_ENABLED = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = STRIPE_ENABLED ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!) : null;

export function CheckoutForm({ orderId, amountUsd }: { orderId: string; heroName: string; amountUsd: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  function handleDetailsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveContactAndShipping(formData);
        if (STRIPE_ENABLED) {
          const { clientSecret } = await createPaymentIntent(orderId);
          setClientSecret(clientSecret);
        } else {
          // Test-mode bypass — no Stripe keys configured for this environment.
          await confirmDummyPayment(orderId);
          router.push(`/orders/${orderId}/confirmed`);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  if (clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <PaymentStep orderId={orderId} amountUsd={amountUsd} onBack={() => setClientSecret(null)} />
      </Elements>
    );
  }

  return (
    <form onSubmit={handleDetailsSubmit} className="space-y-5">
      <input type="hidden" name="order_id" value={orderId} />

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
        {isPending ? "Loading…" : STRIPE_ENABLED ? "Continue to payment →" : `Simulate payment · $${amountUsd}`}
      </button>
    </form>
  );
}

function PaymentStep({ orderId, amountUsd, onBack }: { orderId: string; amountUsd: number; onBack: () => void }) {
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
        return_url: `${window.location.origin}/orders/${orderId}/confirmed`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }

    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      router.push(`/orders/${orderId}/confirmed`);
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
        {submitting ? "Placing order…" : `Pay Now · $${amountUsd}`}
      </button>
    </form>
  );
}
