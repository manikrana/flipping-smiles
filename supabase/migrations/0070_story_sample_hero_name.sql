-- Per-book sample name shown on customer-facing covers and titles while
-- browsing, before a child's real name is entered. Gender-neutral by choice so
-- one name fits both the boy and girl cover variants. NULL = fall back to the
-- hashed default list in apps/store/src/lib/heroNames.ts.
alter table stories add column if not exists sample_hero_name text;

update stories set sample_hero_name = 'Alex' where slug = 'the-night-of-christmas-magic';
