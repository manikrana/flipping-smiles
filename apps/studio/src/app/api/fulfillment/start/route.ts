import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { startPageGeneration, generateOrderPdf } from "@/app/orders/generate/actions";
import { createServerClient } from "@/lib/supabase/server";

// Called server-to-server by the storefront's Stripe webhook once an order is
// paid. Authenticated with a shared secret (not the Studio site-password
// cookie — see middleware.ts). Responds immediately and runs the actual
// generation + PDF build in the background so the caller isn't stuck holding
// a connection open for the full pipeline.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-fulfillment-secret");
  if (!process.env.FULFILLMENT_WEBHOOK_SECRET || secret !== process.env.FULFILLMENT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { orderId } = await req.json();
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

  after(async () => {
    try {
      await startPageGeneration(orderId);

      // Only auto-build the PDF if every page actually made it — if some
      // pages failed, the order stays at "generating" so an admin can see
      // and retry the failed pages before a PDF is ever built.
      const supabase = createServerClient();
      const { data: order } = await supabase.from("orders").select("status").eq("id", orderId).single();
      if (order?.status === "preview_ready") {
        await generateOrderPdf(orderId);
      }
    } catch (err) {
      console.error(`[fulfillment/start] order ${orderId} failed:`, err);
    }
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
