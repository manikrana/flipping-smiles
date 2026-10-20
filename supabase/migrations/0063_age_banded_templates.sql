create table story_page_age_variants (
  page_id uuid not null references story_pages(id) on delete cascade,
  age_band text not null check (age_band in ('1-4','5-8','9-12')),
  image_url text,
  created_at timestamptz not null default now(),
  primary key (page_id, age_band)
);
create index on story_page_age_variants(page_id);

create table story_cover_age_variants (
  story_id uuid not null references stories(id) on delete cascade,
  age_band text not null check (age_band in ('1-4','5-8','9-12')),
  image_url text,
  created_at timestamptz not null default now(),
  primary key (story_id, age_band)
);
create index on story_cover_age_variants(story_id);
