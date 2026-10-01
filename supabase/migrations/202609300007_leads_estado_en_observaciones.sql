-- Cada cambio de estado de un lead queda apuntado en sus observaciones, con la
-- fecha y lo que ha pasado desde que entró, para ver y controlar lo que se
-- tarda en contactar. Queda, por ejemplo:
--
--   30/09/2026 10:15 · Nuevo → Contactado · 2 días y 3 h después de entrar · Alín
--
-- Va en la base (y no en la pantalla) para que se apunte cambie quien cambie el
-- estado y desde donde sea. El historial de estados (lead_status_history) sigue
-- como estaba.

create or replace function public.lead_status_label(p_status public.lead_status)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_status
    when 'new' then 'Nuevo'
    when 'contact_attempt' then 'Intento de contacto'
    when 'contacted' then 'Contactado'
    when 'offer_sent' then 'Oferta enviada'
    when 'interested' then 'Interesado'
    when 'won' then 'Ganado'
    when 'lost' then 'Perdido'
    when 'invalid' then 'No válido'
    else p_status::text
  end;
$$;

create or replace function public.note_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  segundos bigint;
  tiempo text;
  quien text;
  linea text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  -- Lo que ha pasado desde que entró el lead, dicho como lo diría una persona.
  segundos := greatest(extract(epoch from (now() - new.created_at))::bigint, 0);
  tiempo := case
    when segundos < 3600 then (segundos / 60) || ' min'
    when segundos < 86400 then (segundos / 3600) || ' h ' || ((segundos % 3600) / 60) || ' min'
    else (segundos / 86400) || case when segundos / 86400 = 1 then ' día' else ' días' end
      || case when (segundos % 86400) / 3600 > 0 then ' y ' || ((segundos % 86400) / 3600) || ' h' else '' end
  end;

  -- Quién lo cambia (vacío si lo cambia un proceso automático).
  select nullif(btrim(p.full_name), '') into quien from public.profiles p where p.id = auth.uid();

  linea := to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')
    || ' · ' || public.lead_status_label(old.status) || ' → ' || public.lead_status_label(new.status)
    || ' · ' || tiempo || ' después de entrar'
    || coalesce(' · ' || quien, '');

  new.notes := case
    when coalesce(btrim(new.notes), '') = '' then linea
    else rtrim(new.notes) || E'\n' || linea
  end;
  return new;
end;
$$;

revoke all on function public.note_lead_status_change() from public, anon, authenticated;

drop trigger if exists leads_note_status_change on public.leads;
create trigger leads_note_status_change
  before update of status on public.leads
  for each row execute function public.note_lead_status_change();
