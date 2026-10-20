"use server";

import { createServerClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { markOrderPaidAndFulfill } from "@/lib/fulfillment";

export async function saveContactAndShipping(formData: FormData) {
  const supabase = createServerClient();

  const orderId = formData.get("order_id") as string;
  const name    = formData.get("name") as string;
  const email   = formData.get("email") as string;
  const phone   = formData.get("phone") as string;
  const address = formData.get("address") as string;
  const city    = formData.get("city") as string;
  const state   = formData.get("state") as string;
  const zip     = formData.get("zip") as string;

  if (!orderId || !name || !email || !address || !city || !zip) {
    throw new Error("Please fill in all required fields.");
  }

  const { error } = await supabase
    .from("orders")
    .update({
      contact_email: email,
      contact_phone: phone || null,
      shipping_address: { name, address, city, state, zip },
    })
    .eq("id", orderId)
    .eq("status", "pending_payment");

  if (error) throw new Error(error.message);
}

export async function createPaymentIntent(orderId: string): Promise<{ clientSecret: string }> {
  const supabase = createServerClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, amount_usd, status, stripe_payment_intent_id")
    .eq("id", orderId)
    .single();

  if (error || !order) throw new Error("Order not found");
  if (order.status !== "pending_payment") throw new Error("This order has already been paid for.");

  const amountCents = Math.round(order.amount_usd * 100);
  const stripe = getStripe();

  // Reuse an existing PaymentIntent for this order if one is already in flight
  // so re-submitting the form doesn't create a new intent every time.
  if (order.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
    if (existing.status !== "canceled" && existing.amount === amountCents) {
      return { clientSecret: existing.client_secret! };
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata: { order_id: orderId },
  });

  await supabase
    .from("orders")
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq("id", orderId);

  return { clientSecret: paymentIntent.client_secret! };
}

// Dev/test-mode bypass: when Stripe isn't configured for this environment,
// checkout skips straight to this instead of the Payment Element flow.
// Refuses to run at all if Stripe IS configured, so it can never be used to
// dodge a real charge in an environment that's actually wired up.
export async function confirmDummyPayment(orderId: string): Promise<void> {
  if (process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is configured for this environment — dummy payment is disabled.");
  }

  const ok = await markOrderPaidAndFulfill(orderId);
  if (!ok) throw new Error("Could not confirm payment — order may already be paid or not found.");
}
