create table brand_settings (
  id text primary key default 'default',
  company_name text,
  website_url text,
  instagram_url text,
  back_cover_leading_text text default 'There''s more smiles ahead',
  updated_at timestamptz not null default now()
);

insert into brand_settings (id) values ('default');

-- Service role (both apps, server-side) bypasses RLS entirely. This just
-- ensures the anon key can never read or write it, matching every other
-- table (see 0046_enable_rls.sql).
alter table brand_settings enable row level security;

