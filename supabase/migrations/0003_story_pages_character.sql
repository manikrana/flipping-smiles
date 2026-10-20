alter table story_pages
  add column character_prompt text not null default '',
  add column character_position jsonb not null default '{"x": 0.05, "y": 0.2, "width": 0.4, "height": 0.75}';
