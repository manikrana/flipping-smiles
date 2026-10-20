alter table cast_characters
  add column lora_status text not null default 'none',
  add column lora_url text,
  add column trigger_word text;
