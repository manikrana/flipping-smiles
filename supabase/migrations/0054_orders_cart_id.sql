alter table orders add column if not exists cart_id uuid;
create index if not exists orders_cart_id_idx on orders (cart_id);
