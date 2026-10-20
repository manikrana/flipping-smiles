"use client";

function getSessionId(): string {
  try {
    const key = "flippingsmiles_sid";
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(key, sid);
    }
    return sid;
  } catch {
    return "unknown";
  }
}

interface TrackPayload {
  story_id?: string;
  order_id?: string;
  properties?: Record<string, unknown>;
}

export function track(event_name: string, payload: TrackPayload = {}) {
  try {
    const body = {
      event_name,
      session_id: getSessionId(),
      ...payload,
    };
    // fire-and-forget — never blocks the UI, never throws
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    // silently swallow
  }
}
