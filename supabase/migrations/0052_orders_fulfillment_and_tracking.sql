-- 0045 dropped and rebuilt orders_status_check without 'preview_ready',
-- which 0021 had added and which generate/actions.ts + PdfExporter.tsx
-- still read/write. Restore it. Also add tracking columns populated by
-- the Gelato shipping webhook.

alter table orders
  drop constraint if exists orders_status_check;

alter table orders
  add constraint orders_status_check
  check (status in (
    'pending_payment',
    'payment_submitted',
    'paid',
    'generating',
    'preview_ready',
    'pdf_ready',
    'sent_to_print',
    'shipped',
    'delivered'
  ));

alter table orders
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists carrier_name text;
