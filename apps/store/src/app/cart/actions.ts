"use server";

import { createServerClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { markOrderPaidAndFulfill } from "@/lib/fulfillment";
import { getCartId } from "@/lib/cart";

export async function removeFromCart(orderId: string) {
  const supabase = createServerClient();
  await supabase.from("orders").delete().eq("id", orderId).eq("status", "pending_payment");
}

export async function saveCartContactAndShipping(formData: FormData) {
  const cartId = await getCartId();
  if (!cartId) throw new Error("Your cart could not be found — please start over.");

  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const phone = formData.get("phone") as string;
  const address = formData.get("address") as string;
  const city = formData.get("city") as string;
  const state = formData.get("state") as string;
  const zip = formData.get("zip") as string;

  if (!name || !email || !address || !city || !zip) {
    throw new Error("Please fill in all required fields.");
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("orders")
    .update({
      contact_email: email,
      contact_phone: phone || null,
      shipping_address: { name, address, city, state, zip },
    })
    .eq("cart_id", cartId)
    .eq("status", "pending_payment");

  if (error) throw new Error(error.message);
}

export async function createCartPaymentIntent(): Promise<{ clientSecret: string }> {
  const cartId = await getCartId();
  if (!cartId) throw new Error("Your cart could not be found — please start over.");

  const supabase = createServerClient();
  const { data: cartOrders, error } = await supabase
    .from("orders")
    .select("id, amount_usd, stripe_payment_intent_id")
    .eq("cart_id", cartId)
    .eq("status", "pending_payment")
    .order("created_at");

  if (error) throw new Error(error.message);
  if (!cartOrders || cartOrders.length === 0) throw new Error("Your cart is empty.");

  const orderIds = cartOrders.map((o) => o.id);
  const orderIdsKey = orderIds.join(",");
  const amountCents = Math.round(cartOrders.reduce((sum, o) => sum + o.amount_usd, 0) * 100);
  const stripe = getStripe();

  // Reuse an in-flight PaymentIntent only if both the amount AND the exact
  // set of orders still match -- the cart's contents can change between visits.
  const existingId = cartOrders.find((o) => o.stripe_payment_intent_id)?.stripe_payment_intent_id;
  if (existingId) {
    const existing = await stripe.paymentIntents.retrieve(existingId);
    if (existing.status !== "canceled" && existing.amount === amountCents && existing.metadata.order_ids === orderIdsKey) {
      return { clientSecret: existing.client_secret! };
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata: { order_ids: orderIdsKey },
  });

  await supabase.from("orders").update({ stripe_payment_intent_id: paymentIntent.id }).in("id", orderIds);

  return { clientSecret: paymentIntent.client_secret! };
}

// Dev/test-mode bypass -- mirrors confirmDummyPayment's guard, fans out
// across every order in the cart instead of a single order.
export async function confirmDummyCartPayment(): Promise<void> {
  if (process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is configured for this environment — dummy payment is disabled.");
  }

  const cartId = await getCartId();
  if (!cartId) throw new Error("Your cart could not be found — please start over.");

  const supabase = createServerClient();
  const { data: cartOrders, error } = await supabase
    .from("orders")
    .select("id")
    .eq("cart_id", cartId)
    .eq("status", "pending_payment");

  if (error) throw new Error(error.message);
  if (!cartOrders || cartOrders.length === 0) throw new Error("Your cart is empty.");

  await Promise.all(cartOrders.map((o) => markOrderPaidAndFulfill(o.id)));
}
