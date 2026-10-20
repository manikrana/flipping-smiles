create type layout_type as enum ('overlay_bottom', 'split_horizontal');

alter table stories
  add column layout_type   layout_type not null default 'overlay_bottom',
  add column text_panel_bg jsonb,
  add column trim_size_id  uuid references print_provider_trim_sizes(id);
