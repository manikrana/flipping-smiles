-- Head turnaround (six large head-and-shoulders views: front, 3/4 left, left
-- profile, back, 3/4 right, right profile) generated from the cartoon
-- portrait. The full-body sheet's face is only ~10% of panel height, too
-- small for the model to copy faithfully -- this is the face reference for
-- every page/cover fill-in. Nullable: existing characters get one generated
-- the first time an order needs it.
alter table characters add column if not exists head_sheet_url text;
