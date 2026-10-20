create table feedback (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  type text not null check (type in ('bug', 'feature')),
  title text not null,
  description text not null,
  url text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'dismissed')),
  created_at timestamptz default now()
);

alter table feedback enable row level security;

create policy "Anyone can insert feedback" on feedback for insert with check (true);
create policy "Service role can manage feedback" on feedback for all using (true);
