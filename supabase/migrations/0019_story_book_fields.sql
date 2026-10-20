alter table stories
  add column status text not null default 'draft',
  add column dedication_text text,
  add column end_page_text text not null default 'The End',
  add column back_cover_text text,
  add column cover_layout jsonb;
