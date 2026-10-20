alter table orders add column gender text not null default 'boy' check (gender in ('boy', 'girl'));
