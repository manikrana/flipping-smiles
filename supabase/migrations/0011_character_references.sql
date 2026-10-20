create table cast_character_references (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references cast_characters(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now()
);

create index on cast_character_references(character_id);

-- Migrate existing reference_url values into the new table
insert into cast_character_references (character_id, image_url)
select id, reference_url
from cast_characters
where reference_url is not null;
