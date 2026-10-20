alter table stories
  add column cover_swap_template_url text;

alter table order_pages
  add column identity_verified boolean;
