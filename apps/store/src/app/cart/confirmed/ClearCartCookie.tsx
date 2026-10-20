"use client";

import { useEffect } from "react";

// Runs once when the success state renders -- clears the cart cookie so the
// next book personalized in this browser starts a fresh cart instead of
// silently trying to join this one (which is now fully paid). Uses a plain
// fetch to a Route Handler rather than a Server Action: a Server Action call
// here would trigger Next.js's automatic revalidation of this same route,
// which reads the same cookie, so it would immediately 404 right after
// checkout instead of showing the success state.
export function ClearCartCookie() {
  useEffect(() => {
    fetch("/api/cart/clear", { method: "POST" });
  }, []);

  return null;
}
