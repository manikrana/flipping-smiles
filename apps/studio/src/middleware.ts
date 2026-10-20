import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "flippingsmiles_unlocked";

export function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;

  // If no password is configured, site is open
  if (!password) return NextResponse.next();

  const unlocked = request.cookies.get(COOKIE)?.value === password;
  if (unlocked) return NextResponse.next();

  const url = request.nextUrl.clone();
  const from = request.nextUrl.pathname;
  url.pathname = "/unlock";
  url.searchParams.set("from", from);
  return NextResponse.redirect(url);
}

export const config = {
  // api/fulfillment is called server-to-server (Stripe webhook -> studio) and
  // authenticates with its own shared secret, not the site-password cookie.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|unlock|api/fulfillment).*)"],
};
