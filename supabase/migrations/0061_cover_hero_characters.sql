alter table stories
  add column cover_hero_boy_character_id uuid references cast_characters(id),
  add column cover_hero_girl_character_id uuid references cast_characters(id);
