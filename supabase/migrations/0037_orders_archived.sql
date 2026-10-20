alter table orders
  add column if not exists archived boolean not null default false;

create index if not exists orders_archived_idx on orders (archived);
