create table if not exists analytics_events (
  id          uuid        primary key default gen_random_uuid(),
  event_name  text        not null,
  session_id  text,
  story_id    uuid        references stories(id) on delete set null,
  order_id    uuid        references orders(id)  on delete set null,
  properties  jsonb       not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists analytics_events_event_name_idx on analytics_events (event_name, created_at desc);
create index if not exists analytics_events_story_id_idx   on analytics_events (story_id,   created_at desc);
create index if not exists analytics_events_session_id_idx on analytics_events (session_id);
create index if not exists analytics_events_created_at_idx on analytics_events (created_at desc);

alter table analytics_events enable row level security;

-- Anon key can insert events (storefront tracking), but cannot read them
create policy "Public can insert analytics"
  on analytics_events for insert
  with check (true);

create policy "No public reads"
  on analytics_events for select
  using (false);
