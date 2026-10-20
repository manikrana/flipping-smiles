import { createServerClient } from "@/lib/supabase/server";
import { estimateCallCost } from "@/lib/geminiPricing";

// Mirrors apps/studio/src/lib/geminiLog.ts -- every real Gemini API call this
// app makes gets logged here, so admins can see actual call counts per page,
// per book, and over time. Logged at the orchestration layer (functions that
// already have supabase + story/page/order context), not inside the
// low-level lib/gemini.ts wrappers.
export type GeminiCallType =
  | "template_page_base"
  | "template_cover_base"
  | "template_cover_display"
  | "template_age_band_resize"
  | "character_sheet"
  | "character_head_sheet"
  | "character_cartoon"
  | "costumed_sheet_generate"
  | "costumed_sheet_judge"
  | "order_fillin_page"
  | "order_judge_page"
  | "order_wardrobe_judge_page"
  | "order_zone_judge_page"
  | "order_preserve_judge_page"
  | "order_dupe_judge_page"
  | "order_fillin_cover"
  | "order_judge_cover"
  | "order_wardrobe_judge_cover"
  | "order_preserve_judge_cover"
  | "order_dupe_judge_cover"
  | "order_rank_judge_page"
  | "order_rank_judge_cover";

export async function logGeminiCall(
  supabase: ReturnType<typeof createServerClient>,
  params: { callType: GeminiCallType; storyId?: string | null; pageId?: string | null; orderId?: string | null }
): Promise<void> {
  try {
    await supabase.from("gemini_call_log").insert({
      call_type: params.callType,
      story_id: params.storyId ?? null,
      page_id: params.pageId ?? null,
      order_id: params.orderId ?? null,
      estimated_cost_usd: estimateCallCost(params.callType),
    });
  } catch (err) {
    console.error("[gemini-log] failed to record call:", err);
  }
}
