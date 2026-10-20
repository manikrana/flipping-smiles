// Flat per-call_type cost estimates (USD), used both to price new calls at
// write time (logGeminiCall) and to backfill historical rows in migration
// 0068_gemini_call_cost.sql. Keep these two in sync -- this file is the
// source of truth for every call logged from here on; the migration only
// covers what was logged before cost tracking existed.
//
// These are estimates, not metered actuals -- Gemini responses aren't
// currently logged with their real token usage. Derived from Gemini 3.1
// Flash Image's published per-token pricing ($0.25/M input tokens, $1.50/M
// text-output tokens, $60/M image-output tokens -- confirmed live via
// WebSearch) applied to each call shape's typical request/response size:
// a judge call is vision-input + a few dozen text-output tokens and NO
// image-output tokens (the expensive part of any call to this model); an
// image-generation call is one or more vision inputs plus one generated
// image.
export const GEMINI_CALL_COST_USD: Record<string, number> = {
  // Judge / validation calls.
  order_judge_page: 0.0004,
  order_judge_cover: 0.0004,
  order_wardrobe_judge_page: 0.0004,
  order_wardrobe_judge_cover: 0.0004,
  order_zone_judge_page: 0.0004,
  order_preserve_judge_page: 0.0004,
  order_preserve_judge_cover: 0.0004,
  order_dupe_judge_page: 0.0004,
  order_dupe_judge_cover: 0.0004,
  order_rank_judge_page: 0.001,
  order_rank_judge_cover: 0.001,
  order_reverify_judge_page: 0.0004,
  costumed_sheet_judge: 0.0004,
  template_character_count_judge: 0.0004,
  // Image-generation calls.
  order_fillin_page: 0.09,
  order_fillin_cover: 0.09,
  template_page_base: 0.09,
  template_cover_base: 0.09,
  template_cover_display: 0.09,
  template_age_band_resize: 0.07,
  character_cartoon: 0.07,
  costumed_sheet_generate: 0.09,
  character_sheet: 0.12,
  character_head_sheet: 0.12,
};

export function estimateCallCost(callType: string): number {
  return GEMINI_CALL_COST_USD[callType] ?? 0;
}

// Every call_type logged under the order-generation pipeline is either a
// real image edit/generation or a validation judge over an already-generated
// image -- "judge" appears in every validation call_type's name and nothing
// else's, so this is an exact, not heuristic, split.
export function isValidationCallType(callType: string): boolean {
  return callType.includes("judge");
}
