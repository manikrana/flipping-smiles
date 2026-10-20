alter table story_pages
  add column image_url_girl text,
  add column hero_on_page   boolean not null default true;
