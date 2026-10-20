"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function TrackOrderPage() {
  const [orderId, setOrderId] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = orderId.trim();
    if (id) router.push(`/orders/${id}`);
  }

  return (
    <div className="pt-16 min-h-screen bg-cream">
      <div className="max-w-lg mx-auto px-6 py-32">
        <AnimatedSection className="text-center mb-10">
          <div className="text-5xl mb-5">📦</div>
          <h1 className="font-display text-4xl font-bold text-ink mb-3">Track your order</h1>
          <p className="text-ink/50">Enter your order ID to see the status of your book.</p>
        </AnimatedSection>

        <AnimatedSection delay={0.1}>
          <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-8 shadow-card border border-ink/5 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-ink mb-2">Order ID</label>
              <input
                type="text"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="e.g. 3f2e9c7a-..."
                className="w-full border border-ink/10 rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 bg-cream placeholder:text-ink/30"
              />
              <p className="text-xs text-ink/40 mt-2">
                Your order ID was included in the confirmation link when you placed your order.
              </p>
            </div>
            <button
              type="submit"
              disabled={!orderId.trim()}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white font-semibold py-3.5 rounded-2xl text-sm transition-colors"
            >
              Track Order →
            </button>
          </form>
        </AnimatedSection>
      </div>
    </div>
  );
}
