alter table orders
  drop constraint if exists orders_status_check;

alter table orders
  add constraint orders_status_check
  check (status in (
    'pending_payment','paid','generating',
    'preview_ready','pdf_ready','sent_to_print','shipped','delivered'
  ));
