create table if not exists analytics_events (
  id          uuid        primary key default gen_random_uuid(),
  event_name  text        not null,
  session_id  text,
  story_id    uuid        references stories(id) on delete set null,
  order_id    uuid        references orders(id)  on delete set null,
  properties  jsonb       not null default '{}',
  created_at  timestamptz not null default now()
);

create index on analytics_events (event_name, created_at desc);
create index on analytics_events (story_id,   created_at desc);
create index on analytics_events (session_id);
create index on analytics_events (created_at desc);
