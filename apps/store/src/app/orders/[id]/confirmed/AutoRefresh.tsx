"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Stripe confirms payment client-side and redirects here before our webhook
// (the source of truth) has necessarily landed. Poll briefly by re-fetching
// the server component until the order flips off "pending_payment".
export function AutoRefresh({ intervalMs = 1500 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
