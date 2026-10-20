alter table stories
  rename column back_cover_qr_url to back_cover_website_qr_url;

alter table stories
  add column back_cover_social_qr_url text,
  add column back_cover_tagline text;
