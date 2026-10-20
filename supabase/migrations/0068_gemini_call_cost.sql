-- Per-call cost tracking for gemini_call_log, so order cost can be broken
-- down by image-generation vs. validation (judge) calls, and by call_type.
-- estimated_cost_usd is a flat per-call_type rate, not a metered actual --
-- Gemini responses aren't currently logged with their real token usage, so
-- this is the best available estimate. Keep this rate table in sync with
-- apps/studio/src/lib/geminiPricing.ts and apps/store/src/lib/geminiPricing.ts
-- (the source of truth for new calls going forward; this migration only
-- backfills historical rows logged before cost tracking existed).

alter table gemini_call_log
  add column if not exists estimated_cost_usd numeric(12, 6) not null default 0;

update gemini_call_log set estimated_cost_usd = case call_type
  -- Judge / validation calls -- vision input, short text-only output, no
  -- image-output tokens (the expensive part of any Gemini image-model call).
  when 'order_judge_page'            then 0.0004
  when 'order_judge_cover'           then 0.0004
  when 'order_zone_judge_page'       then 0.0004
  when 'order_preserve_judge_page'   then 0.0004
  when 'order_preserve_judge_cover'  then 0.0004
  when 'order_dupe_judge_page'       then 0.0004
  when 'order_dupe_judge_cover'      then 0.0004
  when 'order_reverify_judge_page'   then 0.0004
  when 'costumed_sheet_judge'        then 0.0004
  when 'template_character_count_judge' then 0.0004
  -- Image-generation calls -- one or more vision inputs, one generated image.
  when 'order_fillin_page'           then 0.09
  when 'order_fillin_cover'          then 0.09
  when 'template_page_base'          then 0.09
  when 'template_cover_base'         then 0.09
  when 'template_cover_display'      then 0.09
  when 'template_age_band_resize'    then 0.07
  when 'character_cartoon'           then 0.07
  when 'costumed_sheet_generate'     then 0.09
  when 'character_sheet'             then 0.12
  else 0
end;

create index on gemini_call_log(order_id, estimated_cost_usd);
