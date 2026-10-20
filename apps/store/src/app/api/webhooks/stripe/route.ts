import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { markOrderPaidAndFulfill } from "@/lib/fulfillment";
import type Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    // order_ids (plural, comma-separated) is the cart-checkout shape; order_id
    // (singular) is kept as a fallback for any PaymentIntent already in
    // flight from the old single-order checkout when this deploys.
    const orderIds = paymentIntent.metadata.order_ids
      ? paymentIntent.metadata.order_ids.split(",")
      : paymentIntent.metadata.order_id
        ? [paymentIntent.metadata.order_id]
        : [];

    if (orderIds.length === 0) {
      console.error("[stripe webhook] payment_intent.succeeded with no order_id(s) metadata:", paymentIntent.id);
      return NextResponse.json({ received: true });
    }

    await Promise.all(orderIds.map((id) => markOrderPaidAndFulfill(id)));
  }

  return NextResponse.json({ received: true });
}
