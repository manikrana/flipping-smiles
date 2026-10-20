alter table story_pages
  add column if not exists preview_eligible boolean not null default false;
