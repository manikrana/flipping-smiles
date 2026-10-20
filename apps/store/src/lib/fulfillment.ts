import { createServerClient } from "./supabase/server";
import { sendOrderConfirmation } from "./email";

// Called server-to-server by the Stripe webhook (real payments) and by the
// dev-mode dummy-payment action (when Stripe isn't configured) — either way,
// this is the single place that marks an order paid, emails the customer,
// and kicks off Studio's generation -> PDF pipeline.
export async function markOrderPaidAndFulfill(orderId: string): Promise<boolean> {
  const supabase = createServerClient();

  // Idempotent: only transition orders still awaiting payment, so retries
  // (Stripe webhook retries, or a double-click in dev mode) are no-ops.
  const { data: updated, error } = await supabase
    .from("orders")
    .update({ status: "paid" })
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .select("id, hero_name, contact_email, stories(title)")
    .single();

  if (error || !updated) return false;

  const order = updated as unknown as { hero_name: string; contact_email: string | null; stories: { title: string } | null };

  if (order.contact_email) {
    try {
      await sendOrderConfirmation({
        to: order.contact_email,
        heroName: order.hero_name,
        bookTitle: order.stories?.title ?? "your book",
        orderId,
      });
    } catch (emailErr) {
      console.error("[fulfillment] confirmation email failed:", emailErr);
    }
  }

  await triggerFulfillment(orderId);
  return true;
}

export async function triggerFulfillment(orderId: string) {
  if (!process.env.STUDIO_APP_URL || !process.env.FULFILLMENT_WEBHOOK_SECRET) {
    console.error("[fulfillment] STUDIO_APP_URL / FULFILLMENT_WEBHOOK_SECRET not configured — skipping auto-generation");
    return;
  }
  try {
    await fetch(`${process.env.STUDIO_APP_URL}/api/fulfillment/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fulfillment-secret": process.env.FULFILLMENT_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ orderId }),
    });
  } catch (err) {
    // Non-fatal — the order is paid regardless; an admin can retry generation manually in Studio.
    console.error(`[fulfillment] failed to trigger fulfillment for order ${orderId}:`, err);
  }
}
