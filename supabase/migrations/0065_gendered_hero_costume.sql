alter table stories drop column if exists hero_costume_description;
alter table stories add column hero_costume_description_boy text;
alter table stories add column hero_costume_description_girl text;

-- Caches the order-time costumed identity sheet so it's generated once per
-- order and reused for every page + cover swap in that order, not once per call.
alter table orders add column costumed_sheet_url text;
