create table gemini_call_log (
  id uuid primary key default gen_random_uuid(),
  call_type text not null,
  story_id uuid references stories(id) on delete set null,
  page_id uuid references story_pages(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on gemini_call_log(story_id);
create index on gemini_call_log(page_id);
create index on gemini_call_log(order_id);
create index on gemini_call_log(created_at);
