import { createServerClient } from "@/lib/supabase/server";

export function trackServer(
  eventName: string,
  opts?: { storyId?: string; orderId?: string; properties?: Record<string, unknown> }
) {
  const supabase = createServerClient();
  supabase.from("analytics_events").insert({
    event_name: eventName,
    session_id: null,
    story_id: opts?.storyId ?? null,
    order_id: opts?.orderId ?? null,
    properties: opts?.properties ?? {},
  }).then(() => {}, () => {});
}
