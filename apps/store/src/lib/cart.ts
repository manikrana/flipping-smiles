import { cookies } from "next/headers";

export const CART_COOKIE = "flippingsmiles_cart_id";

const CART_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 30, // 30 days
  path: "/",
};

// Server Actions only (Next.js forbids setting cookies during a Server
// Component render) -- creates the cart cookie on first use, reuses it after.
export async function getOrCreateCartId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CART_COOKIE)?.value;
  if (existing) return existing;

  const cartId = crypto.randomUUID();
  store.set(CART_COOKIE, cartId, CART_COOKIE_OPTIONS);
  return cartId;
}

// Server Components and read-only Server Actions -- never creates a cookie.
export async function getCartId(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE)?.value ?? null;
}

export async function clearCartId(): Promise<void> {
  (await cookies()).delete(CART_COOKIE);
}
