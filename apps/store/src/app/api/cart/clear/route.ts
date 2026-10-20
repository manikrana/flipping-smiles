import { NextResponse } from "next/server";
import { clearCartId } from "@/lib/cart";

// Plain Route Handler, not a Server Action -- a Server Action call here would
// trigger Next.js's automatic revalidation of the *current* route (the
// confirmed page), which reads the same cart cookie this clears, causing it
// to re-render as if the cart never existed (a 404) right after checkout.
export async function POST() {
  await clearCartId();
  return NextResponse.json({ ok: true });
}
