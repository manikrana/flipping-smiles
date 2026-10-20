-- Enable RLS on all public tables.
-- Both apps use the service role key server-side, which bypasses RLS.
-- These policies ensure the anon key (PostgREST) can never read or write any data.
-- "Service role" access is implicit — service_role bypasses RLS entirely in Supabase.

-- ── Core story tables ─────────────────────────────────────────────────────────

alter table stories              enable row level security;
alter table story_pages          enable row level security;

-- Published stories are publicly readable (storefront needs slug lookup)
create policy "Public can read published stories"
  on stories for select
  using (status = 'ready');

-- story_pages for published stories are readable (storefront preview)
create policy "Public can read pages of published stories"
  on story_pages for select
  using (
    exists (
      select 1 from stories s
      where s.id = story_pages.story_id
        and s.status = 'ready'
    )
  );

-- ── Character tables ──────────────────────────────────────────────────────────

alter table characters                enable row level security;
alter table cast_characters           enable row level security;
alter table cast_character_references enable row level security;
alter table page_cast                 enable row level security;

-- No public access — service role only
create policy "No public access" on characters               for all using (false);
create policy "No public access" on cast_characters          for all using (false);
create policy "No public access" on cast_character_references for all using (false);
create policy "No public access" on page_cast                for all using (false);

-- ── Orders & order pages (PII) ────────────────────────────────────────────────

alter table orders      enable row level security;
alter table order_pages enable row level security;

-- No public access — service role only
create policy "No public access" on orders      for all using (false);
create policy "No public access" on order_pages for all using (false);

-- ── Print providers (public catalogue data) ───────────────────────────────────

alter table print_providers           enable row level security;
alter table print_provider_trim_sizes enable row level security;

create policy "Public can read print providers"
  on print_providers for select using (true);

create policy "Public can read trim sizes"
  on print_provider_trim_sizes for select using (true);

-- ── Feedback ─────────────────────────────────────────────────────────────────
-- Already had RLS + policies from migration 0027 — no changes needed.

-- analytics_events table is created separately (migration 0035) — RLS handled there.
