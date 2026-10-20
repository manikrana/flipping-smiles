create table story_characters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  name text not null,
  description text not null,
  reference_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index on story_characters(story_id, sort_order);
