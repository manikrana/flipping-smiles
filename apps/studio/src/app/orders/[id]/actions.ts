"use server";

import { createServerClient } from "@/lib/supabase/server";
import { signAsset } from "@/lib/supabase/assets";
import { submitToGelato, GELATO_MIN_PAGES, GELATO_MAX_PAGES } from "@/lib/gelato";
import { revalidatePath } from "next/cache";

export async function sendToPrint(orderId: string) {
  const supabase = createServerClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("status, pdf_url, pdf_page_count, shipping_address")
    .eq("id", orderId)
    .single() as unknown as {
      data: {
        status: string;
        pdf_url: string | null;
        pdf_page_count: number | null;
        shipping_address: { name?: string; address?: string; city?: string; state?: string; zip?: string; country?: string } | null;
      } | null;
      error: unknown;
    };

  if (error || !order) throw new Error("Order not found");
  if (order.status !== "pdf_ready") {
    throw new Error(
      order.status === "sent_to_print" || order.status === "shipped" || order.status === "delivered"
        ? "This order has already been sent to print."
        : "PDF isn't ready for review yet — generate and export it first."
    );
  }
  if (!order.pdf_url) throw new Error("PDF not generated yet — export the PDF first");

  // Enforce the same QA gate server-side. The UI disables this action when a
  // page is unverified, but fulfillment must not depend on a client-side
  // button state: direct/stale requests must also fail closed.
  const { data: pageChecks, error: pageChecksError } = await supabase
    .from("order_pages")
    .select("page_number, generation_status, identity_verified")
    .eq("order_id", orderId)
    .order("page_number", { ascending: true });
  if (pageChecksError) throw new Error(`Could not verify order pages: ${pageChecksError.message}`);
  if (!pageChecks?.length) throw new Error("Cannot send to print: this order has no generated pages to verify.");
  const unsafePages = (pageChecks ?? []).filter(
    (page) => page.generation_status !== "done" || page.identity_verified !== true
  );
  if (unsafePages.length > 0) {
    throw new Error(
      `Cannot send to print: page${unsafePages.length === 1 ? "" : "s"} ${unsafePages.map((page) => page.page_number).join(", ")} ${unsafePages.length === 1 ? "has" : "have"} not passed identity and wardrobe verification.`
    );
  }

  const shipping = order.shipping_address;
  if (!shipping?.name || !shipping?.address || !shipping?.city || !shipping?.zip) {
    throw new Error("Shipping address incomplete");
  }

  // Sign the PDF path so Gelato can download it
  const pdfSignedUrl = await signAsset(supabase, order.pdf_url);

  if (order.pdf_page_count == null) {
    throw new Error("Page count unknown for this PDF — regenerate the PDF before sending to print.");
  }
  const pageCount = order.pdf_page_count;
  if (pageCount < GELATO_MIN_PAGES || pageCount > GELATO_MAX_PAGES) {
    throw new Error(`This book has ${pageCount} pages — Gelato requires between ${GELATO_MIN_PAGES} and ${GELATO_MAX_PAGES}.`);
  }

  const gelato = await submitToGelato({
    orderId,
    pdfUrl: pdfSignedUrl,
    pageCount,
    shipping: {
      name: shipping.name,
      address: shipping.address,
      city: shipping.city,
      state: shipping.state ?? "",
      zip: shipping.zip,
      country: shipping.country ?? "US",
    },
  });

  await supabase
    .from("orders")
    .update({ status: "sent_to_print", gelato_order_id: gelato.id })
    .eq("id", orderId)
    .eq("status", "pdf_ready");

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}
