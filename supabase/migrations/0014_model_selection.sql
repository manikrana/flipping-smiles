alter table stories
  add column scene_model text not null default 'flux';

alter table cast_characters
  add column reference_model text not null default 'flux-1.1-pro';
