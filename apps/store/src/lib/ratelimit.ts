import { createServerClient } from "./supabase/server";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const CARTOONIZE_MAX_ATTEMPTS = 15;
const MAX_ATTEMPTS = CARTOONIZE_MAX_ATTEMPTS;

// Supabase-backed sliding-window limiter (replaces the earlier Upstash Redis
// dependency). One row per attempt in `rate_limit_hits`; count rows within
// the window to decide. Not perfectly atomic under heavy concurrent load
// from the same key, which is an acceptable tradeoff for a soft anti-abuse
// gate rather than a hard security/billing boundary.
export const cartoonizeRatelimit = {
  async limit(id: string): Promise<{ success: boolean; remaining: number }> {
    const key = `cartoonize:${id}`;
    const supabase = createServerClient();
    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

    const { count, error: countError } = await supabase
      .from("rate_limit_hits")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("created_at", windowStart);

    if (countError) {
      // Fail OPEN: a broken rate-limit store is an infra problem, not a
      // reason to take down the feature it's protecting for every user.
      console.error("[ratelimit] Supabase unreachable, failing open:", countError.message);
      return { success: true, remaining: -1 };
    }

    const used = count ?? 0;
    if (used >= MAX_ATTEMPTS) {
      return { success: false, remaining: 0 };
    }

    const { error: insertError } = await supabase.from("rate_limit_hits").insert({ key });
    if (insertError) {
      console.error("[ratelimit] failed to record attempt:", insertError.message);
    }

    return { success: true, remaining: MAX_ATTEMPTS - used - 1 };
  },
};
