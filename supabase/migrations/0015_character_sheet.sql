alter table cast_character_references
  add column view text not null default 'other';

alter table cast_characters
  add column sheet_url text;
