-- The "brand page" (right-hand page of the first interior spread, next to
-- the front endpaper) can now hold a generated image -- e.g. Flipping Smiles
-- branding / line art -- instead of always printing blank.
alter table stories
  add column brand_page_prompt text,
  add column brand_page_image_url text;
