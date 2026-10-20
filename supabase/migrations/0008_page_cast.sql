create table page_cast (
  page_id uuid not null references story_pages(id) on delete cascade,
  character_id uuid not null references cast_characters(id) on delete cascade,
  primary key (page_id, character_id)
);

create index on page_cast(page_id);
