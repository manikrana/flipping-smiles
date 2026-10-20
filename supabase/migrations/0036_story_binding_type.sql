alter table stories
  add column if not exists binding_type       text not null default 'hardcover',
  add column if not exists print_provider_id  uuid references print_providers(id) on delete set null;
