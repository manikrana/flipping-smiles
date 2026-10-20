-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Stories
create table stories (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  description text not null,
  age_min     int not null default 3,
  age_max     int not null default 8,
  languages   text[] not null default '{en}',
  cover_image_url text,
  price_usd   numeric(10, 2) not null default 29.99,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Story pages (ordered)
create table story_pages (
  id           uuid primary key default gen_random_uuid(),
  story_id     uuid not null references stories(id) on delete cascade,
  page_number  int not null,
  text         text not null,   -- supports {{hero_name}} placeholder
  scene_prompt text not null,   -- prompt for Replicate image generation
  image_url    text,
  created_at   timestamptz not null default now(),
  unique (story_id, page_number)
);

-- Characters (one per order, generated from uploaded photo)
create table characters (
  id                  uuid primary key default gen_random_uuid(),
  source_image_url    text not null,
  cartoon_image_url   text,
  hero_name           text not null,
  generation_status   text not null default 'pending'
                        check (generation_status in ('pending','processing','done','failed')),
  replicate_job_id    text,
  created_at          timestamptz not null default now()
);

-- Orders
create table orders (
  id                       uuid primary key default gen_random_uuid(),
  story_id                 uuid not null references stories(id),
  character_id             uuid not null references characters(id),
  language                 text not null default 'en',
  hero_name                text not null,
  status                   text not null default 'pending_payment'
                             check (status in (
                               'pending_payment','paid','generating',
                               'pdf_ready','sent_to_print','shipped','delivered'
                             )),
  stripe_payment_intent_id text,
  pdf_url                  text,
  shipping_address         jsonb not null,
  amount_usd               numeric(10, 2) not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger stories_updated_at before update on stories
  for each row execute function set_updated_at();

create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();

-- Indexes
create index on story_pages (story_id, page_number);
create index on orders (story_id);
create index on orders (character_id);
create index on orders (status);
create index on orders (stripe_payment_intent_id);
