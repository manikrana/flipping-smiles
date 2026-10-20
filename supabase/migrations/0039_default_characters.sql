alter table characters
  alter column source_image_url drop not null;

alter table characters
  add column if not exists is_default boolean not null default false,
  add column if not exists default_gender text
    check (default_gender in ('boy', 'girl'));

create index if not exists characters_default_idx on characters (is_default, default_gender);
