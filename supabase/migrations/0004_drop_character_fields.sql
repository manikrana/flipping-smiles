alter table story_pages
  drop column if exists character_prompt,
  drop column if exists character_position;
