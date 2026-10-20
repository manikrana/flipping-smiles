-- Add payment_submitted status and contact fields for payment facade.

alter table orders
  drop constraint if exists orders_status_check;

alter table orders
  add constraint orders_status_check
  check (status in (
    'pending_payment',
    'payment_submitted',
    'paid',
    'generating',
    'pdf_ready',
    'sent_to_print',
    'shipped',
    'delivered'
  ));

alter table orders
  add column if not exists contact_email text,
  add column if not exists contact_phone text;
