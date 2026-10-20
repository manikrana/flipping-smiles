create table order_pages (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  page_number         int not null,
  scene_prompt        text not null,
  hero_name           text not null,
  image_url           text,
  upscaled_image_url  text,
  generation_status   text not null default 'pending'
                        check (generation_status in ('pending','processing','upscaling','done','failed')),
  replicate_job_id    text,
  upscale_job_id      text,
  error_message       text,
  created_at          timestamptz not null default now(),
  unique (order_id, page_number)
);

create index on order_pages (order_id);
create index on order_pages (generation_status);
