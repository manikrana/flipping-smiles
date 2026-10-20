-- Generic sliding-window rate-limit store, replacing the Upstash Redis
-- dependency (its instance went stale/unreachable). One row per attempt;
-- count rows within the window to check the limit. `key` is namespaced per
-- limiter (e.g. "cartoonize:<ip>") so this table can serve future limiters
-- too, not just cartoonize.

create table if not exists rate_limit_hits (
  id          uuid        primary key default gen_random_uuid(),
  key         text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists rate_limit_hits_key_created_idx on rate_limit_hits (key, created_at desc);

alter table rate_limit_hits enable row level security;

-- Server-side only, always via the service role key (which bypasses RLS
-- anyway) -- no anon/public access at all, in either direction.
create policy "No public access"
  on rate_limit_hits for all
  using (false)
  with check (false);
