-- Character sheet: generated from the customer's cartoon headshot,
-- used as identity reference when generating per-order scenes via Nano Banana Pro
alter table characters
  add column if not exists sheet_url text default null;
