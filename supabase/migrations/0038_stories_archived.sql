alter table stories
  add column if not exists archived boolean not null default false;

create index if not exists stories_archived_idx on stories (archived);
