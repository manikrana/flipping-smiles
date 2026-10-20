create table print_providers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

create table print_provider_trim_sizes (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references print_providers(id) on delete cascade,
  name        text not null,
  width_in    numeric(6,3) not null,
  height_in   numeric(6,3) not null,
  bleed_in    numeric(6,3) not null default 0.125,
  safety_in   numeric(6,3) not null default 0.5,
  dpi         int not null default 300,
  created_at  timestamptz not null default now()
);

-- Seed: Lulu
insert into print_providers (name, slug) values ('Lulu', 'lulu');

insert into print_provider_trim_sizes (provider_id, name, width_in, height_in, bleed_in, safety_in, dpi)
select id, 'Square 8.5"×8.5"', 8.5, 8.5, 0.125, 0.5, 300
from print_providers where slug = 'lulu';
