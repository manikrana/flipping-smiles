import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendShippingNotification } from "@/lib/email";

export const runtime = "nodejs";

// Gelato's Order Flow webhook fires on order status change and includes
// tracking info once an item ships. Registered as this route's full URL
// (with the shared secret below) in the Gelato dashboard for this store.
// See: https://dashboard.gelato.com/docs/webhooks/
//
// NOTE: Gelato's Order Flow API (distinct from GelatoConnect logistics) does
// not appear to sign webhook payloads — the query-param secret below is our
// own defense-in-depth on top of the URL only Gelato and us know. Revisit
// this if Gelato's dashboard exposes a signing secret when you register the
// webhook — if so, verify that instead/in addition.
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.GELATO_WEBHOOK_SECRET || secret !== process.env.GELATO_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  // Gelato's order status payload nests per-item fulfillment info; the
  // top-level orderReferenceId is the id we passed in when we created the
  // order in submitToGelato() (apps/studio/src/lib/gelato.ts).
  const orderId: string | undefined = body.orderReferenceId ?? body.order?.orderReferenceId;
  const status: string | undefined = body.status ?? body.fulfillmentStatus;
  const item = Array.isArray(body.items) ? body.items[0] : body.item;
  const trackingCode: string | null = item?.trackingCode ?? body.trackingCode ?? null;
  const trackingUrl: string | null = item?.trackingUrl ?? body.trackingUrl ?? null;
  const carrierName: string | null = item?.shipmentMethodName ?? body.shipmentMethodName ?? null;

  if (!orderId || !status) {
    return NextResponse.json({ received: true });
  }

  const supabase = createServerClient();

  if (status === "shipped" || status === "delivered") {
    const { data: updated, error } = await supabase
      .from("orders")
      .update({
        status,
        tracking_number: trackingCode,
        tracking_url: trackingUrl,
        carrier_name: carrierName,
      })
      .eq("id", orderId)
      // Idempotent + ordered: don't let a delivered event race ahead of a
      // shipped one, and don't re-fire the shipped email on webhook retries.
      .eq("status", status === "shipped" ? "sent_to_print" : "shipped")
      .select("id, hero_name, contact_email, stories(title)")
      .single();

    if (!error && updated && status === "shipped") {
      const order = updated as unknown as { hero_name: string; contact_email: string | null; stories: { title: string } | null };
      if (order.contact_email) {
        try {
          await sendShippingNotification({
            to: order.contact_email,
            heroName: order.hero_name,
            bookTitle: order.stories?.title ?? "your book",
            orderId,
            trackingNumber: trackingCode,
            trackingUrl,
            carrierName,
          });
        } catch (emailErr) {
          console.error("[gelato webhook] shipping email failed:", emailErr);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
