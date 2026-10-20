import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event_name, session_id, story_id, order_id, properties } = body;

    if (!event_name) return NextResponse.json({ error: "missing event_name" }, { status: 400 });

    const supabase = createServerClient();
    await supabase.from("analytics_events").insert({
      event_name,
      session_id: session_id ?? null,
      story_id: story_id ?? null,
      order_id: order_id ?? null,
      properties: properties ?? {},
    });
  } catch {
    // never let tracking failures surface to users
  }

  return new NextResponse(null, { status: 204 });
}
