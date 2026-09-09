-- Free-text "time to resolve" field on tickets, editable on any ticket
-- (public-submitted or manually created), by whoever can already manage
-- tickets (admin/it) — same RLS as the rest of the row via tickets_admin_update.

alter table public.tickets
  add column resolution_time text;
