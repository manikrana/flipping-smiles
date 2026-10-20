alter table stories
  add column generation_style text not null default 'pixar-3d'
    check (generation_style in ('pixar-3d'));
