-- Replace Lulu with Gelato as the print provider. Lulu was the original seed
-- (0024_print_providers.sql) but the actual print pipeline (cover generation,
-- PDF/X-4 export, fulfillment via submitToGelato()) has been Gelato-only for
-- a while -- this migration just makes the print_providers table match reality.
--
-- The new trim size uses Gelato's real spec (200mm square trim, 3mm bleed,
-- 300 DPI -- see PAGE_TRIM_MM/PAGE_BLEED_MM/PRINT_DPI in
-- apps/studio/src/lib/layout.ts) instead of Lulu's placeholder 8.5"x8.5".

begin;

insert into print_providers (name, slug) values ('Gelato', 'gelato');

insert into print_provider_trim_sizes (provider_id, name, width_in, height_in, bleed_in, safety_in, dpi)
select id, 'Square 7.874"×7.874" (200mm)', 7.874, 7.874, 0.118, 0.5, 300
from print_providers where slug = 'gelato';

-- Repoint any stories still referencing the old Lulu provider/trim size
-- before removing it (trim_size_id has no ON DELETE clause, so it would
-- otherwise block the delete below with a foreign-key violation).
update stories
set print_provider_id = (select id from print_providers where slug = 'gelato')
where print_provider_id = (select id from print_providers where slug = 'lulu');

update stories
set trim_size_id = (
  select pts.id from print_provider_trim_sizes pts
  join print_providers pp on pp.id = pts.provider_id
  where pp.slug = 'gelato'
)
where trim_size_id in (
  select pts.id from print_provider_trim_sizes pts
  join print_providers pp on pp.id = pts.provider_id
  where pp.slug = 'lulu'
);

-- Removing the provider cascade-deletes its trim size row(s) too
-- (print_provider_trim_sizes.provider_id references print_providers(id) on delete cascade).
delete from print_providers where slug = 'lulu';

commit;
