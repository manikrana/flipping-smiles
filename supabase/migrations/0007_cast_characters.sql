-- Global character library (distinct from customer photo "characters" table)
create table cast_characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  reference_url text,
  created_at timestamptz not null default now()
);

-- Which characters appear in which stories
create table story_cast (
  story_id uuid not null references stories(id) on delete cascade,
  character_id uuid not null references cast_characters(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (story_id, character_id)
);

create index on story_cast(story_id, sort_order);

-- Migrate any existing story_characters data
insert into cast_characters (id, name, description, reference_url, created_at)
select id, name, description, reference_url, created_at from story_characters;

insert into story_cast (story_id, character_id, sort_order)
select story_id, id, sort_order from story_characters;

drop table story_characters;
