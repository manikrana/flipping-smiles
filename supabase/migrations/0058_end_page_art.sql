-- The End Page can now have a generated line-art background image (same
-- prompt-based generation as the brand page), with the end page text
-- composited centered on top of it at print time.
alter table stories
  add column end_page_prompt text,
  add column end_page_image_url text;
