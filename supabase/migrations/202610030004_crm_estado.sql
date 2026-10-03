-- En qué punto está cada contacto del CRM: sin contactar, contactado, con
-- oferta enviada, interesado, ganado o perdido. Así se ve de un vistazo con
-- quién hay que seguir. La fecha del último cambio de estado se apunta sola.

alter table public.crm_contacts add column if not exists status text not null default 'sin_contactar';
alter table public.crm_contacts drop constraint if exists crm_contacts_status_check;
alter table public.crm_contacts add constraint crm_contacts_status_check
  check (status in ('sin_contactar', 'contactado', 'oferta_enviada', 'interesado', 'ganado', 'perdido'));
alter table public.crm_contacts add column if not exists status_changed_at timestamptz;

create or replace function public.crm_contact_status_changed()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.crm_contact_status_changed() from public, anon, authenticated;

drop trigger if exists crm_contacts_status_changed on public.crm_contacts;
create trigger crm_contacts_status_changed
  before insert or update of status on public.crm_contacts
  for each row execute function public.crm_contact_status_changed();

-- Los que ya había quedan "sin contactar" desde que se crearon.
update public.crm_contacts set status_changed_at = created_at where status_changed_at is null;
