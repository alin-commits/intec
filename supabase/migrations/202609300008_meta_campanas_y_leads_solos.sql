-- Meta sin meter nada a mano: las campañas de Meta se unen solas a la campaña
-- de la aplicación que les corresponde (o la crean si no existe), y los
-- contactos de los formularios de Meta entran solos en Leads.

-- ---------- Campañas ----------

-- Las que crea la sincronización, para distinguirlas y mantenerlas al día.
alter table public.campaigns add column if not exists auto_from_meta boolean not null default false;

-- Cómo se unió cada campaña de Meta, y si la unió (o la soltó) una persona:
-- entonces la sincronización ya no la toca, ni para unirla otra vez.
alter table public.meta_campaigns add column if not exists linked_by text;
alter table public.meta_campaigns add column if not exists link_locked boolean not null default false;

-- La campaña de Meta de la que vino cada lead de formulario (se rellena antes
-- de que exista la tabla de páginas, porque la usa la función de abajo).
alter table public.leads add column if not exists meta_campaign_id text;

-- Un nombre comparable: sin mayúsculas, tildes ni signos. "Blizzcool | Leads |
-- S.Completo" y "BLIZZCOOL LEADS S. COMPLETO" quedan iguales.
create or replace function public.meta_norm(p_text text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(p_text, ''), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç', 'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- Lo que distingue a una campaña, sin la coletilla que pone Meta al promocionar
-- una publicación: "Publicación de Instagram: Cuando llega el calor" se queda
-- en "cuando llega el calor". Sin esto, dos publicaciones distintas parecerían
-- la misma por empezar las dos igual.
create or replace function public.meta_core(p_text text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select btrim(regexp_replace(public.meta_norm(p_text),
    '^(publicacion de (instagram|facebook)|publicacion|(instagram|facebook) post|contenido multimedia de (instagram|facebook) promocionado)\s*', ''));
$$;

/*
  Une cada campaña de Meta sin unir con la de la aplicación. Primero se une
  todo lo que se pueda y después se crea lo que falte:

  1. La que se llama igual (y es la única que se llama así).
  2. Una de la misma marca cuyo nombre contiene el de Meta, o al revés, con
     fechas que se solapan (una semana de margen). Así "Blizzcool | Leads |
     S.Completo" se une con "Blizzcool | Leads | S.Completo | 150€".
  3. Una dada de alta a mano con las mismas fechas: de la misma marca con dos
     días de margen, o de cualquier marca si coinciden exactas (hay campañas de
     Jender lanzadas desde la cuenta de Intec). Solo si ninguna otra campaña de
     Meta encaja igual con ella.
  4. Otra campaña de Meta de la misma cuenta ya unida que es la misma
     publicación promocionada otra vez (mismo nombre), o la misma serie
     ("Carrusel_INTEC_Nov1" a "Nov5") en las mismas fechas.
  5. Si no hay nada, se crea en la aplicación con su marca, fechas y estado.
     Solo si gastó algo o está en marcha (las que nunca se lanzaron no llenan
     la lista), y nunca si hay una hecha a mano de su marca, sin unir, en esas
     fechas: esa es probablemente la misma, y lo decide una persona en vez de
     duplicarla.

  En los pasos 1 a 3, si hay más de una candidata no se apuesta: se deja para
  una persona. Las creadas así se mantienen al día (fechas y estado) con lo que
  diga Meta. Devuelve lo que ha hecho con cada una, para el registro.
*/
create or replace function public.meta_reconcile_campaigns()
returns table(meta_id text, meta_name text, accion text, campaign_id uuid, campaign_name text)
language plpgsql
set search_path to 'public'
as $$
declare
  pasada int;
  m record;
  destino uuid;
  como text;
  candidatas int;
  otras int;
begin
  for pasada in 1..2 loop
    for m in
      select mc.meta_id as mid, mc.name, mc.status, mc.account_id,
        public.meta_norm(mc.name) as norma,
        public.meta_core(mc.name) as nucleo,
        case when mc.started_at < '2000-01-01' then null else mc.started_at::date end as empieza,
        mc.stopped_at::date as acaba,
        a.business_unit_id as marca,
        coalesce((select sum(i.spend) from public.meta_insights_daily i where i.meta_campaign_id = mc.meta_id), 0) as gasto
      from public.meta_campaigns mc
      join public.meta_ad_accounts a on a.account_id = mc.account_id
      where mc.campaign_id is null and not mc.link_locked
      order by mc.started_at nulls last, mc.meta_id
    loop
      destino := null;
      como := null;

      if pasada = 1 then
        -- 1. El mismo nombre.
        select count(*), min(c.id::text)::uuid into candidatas, destino
        from public.campaigns c where public.meta_norm(c.name) = m.norma;
        if candidatas = 1 then como := 'mismo nombre'; else destino := null; end if;

        -- 2. Un nombre parecido, de la misma marca y en fechas.
        if destino is null and m.marca is not null and length(m.nucleo) >= 10 then
          select count(*), min(c.id::text)::uuid into candidatas, destino
          from public.campaigns c
          where c.business_unit_id = m.marca
            and length(public.meta_core(c.name)) >= 10
            and (strpos(m.nucleo, public.meta_core(c.name)) > 0 or strpos(public.meta_core(c.name), m.nucleo) > 0)
            and coalesce(c.start_date, '1900-01-01'::date) <= coalesce(m.acaba, '2999-12-31'::date) + 7
            and coalesce(c.end_date, '2999-12-31'::date) >= coalesce(m.empieza, '1900-01-01'::date) - 7;
          if candidatas = 1 then como := 'nombre parecido'; else destino := null; end if;
        end if;

        -- 3. Una hecha a mano, sin unir, con las mismas fechas.
        if destino is null and m.empieza is not null and m.acaba is not null then
          select count(*), min(c.id::text)::uuid into candidatas, destino
          from public.campaigns c
          where not c.auto_from_meta
            and not exists (select 1 from public.meta_campaigns x where x.campaign_id = c.id)
            and c.start_date is not null and c.end_date is not null
            and ((c.business_unit_id = m.marca and abs(c.start_date - m.empieza) <= 2 and abs(c.end_date - m.acaba) <= 2)
              or (c.start_date = m.empieza and c.end_date = m.acaba));
          if candidatas = 1 then
            -- Y que ninguna otra de Meta sin unir encaje igual con ella.
            select count(*) into otras
            from public.meta_campaigns o
            join public.meta_ad_accounts oa on oa.account_id = o.account_id
            join public.campaigns c on c.id = destino
            where o.campaign_id is null and not o.link_locked and o.meta_id <> m.mid
              and o.started_at is not null and o.stopped_at is not null and o.started_at >= '2000-01-01'
              and ((c.business_unit_id = oa.business_unit_id and abs(c.start_date - o.started_at::date) <= 2 and abs(c.end_date - o.stopped_at::date) <= 2)
                or (c.start_date = o.started_at::date and c.end_date = o.stopped_at::date));
            if otras = 0 then como := 'mismas fechas'; else destino := null; end if;
          else
            destino := null;
          end if;
        end if;
      end if;

      -- 4. La misma publicación otra vez, o la misma serie en las mismas fechas.
      -- Solo con campañas creadas solas o que se llaman igual: una hecha a mano
      -- y unida por fechas es de esa promoción, no de las que vengan después.
      if destino is null then
        select o.campaign_id into destino
        from public.meta_campaigns o
        join public.campaigns t on t.id = o.campaign_id
        where o.account_id = m.account_id and o.meta_id <> m.mid
          and (t.auto_from_meta or public.meta_norm(t.name) = m.norma)
          and (public.meta_norm(o.name) = m.norma
            or (length(regexp_replace(m.norma, '\s*\d+$', '')) >= 8
              and regexp_replace(public.meta_norm(o.name), '\s*\d+$', '') = regexp_replace(m.norma, '\s*\d+$', '')
              and coalesce(o.started_at::date, '1900-01-01'::date) <= coalesce(m.acaba, '2999-12-31'::date) + 7
              and coalesce(o.stopped_at::date, '2999-12-31'::date) >= coalesce(m.empieza, '1900-01-01'::date) - 7))
        order by o.started_at desc nulls last
        limit 1;
        if destino is not null then como := 'misma publicación'; end if;
      end if;

      -- 5. Crearla (solo en la segunda pasada, cuando ya se ha unido lo demás).
      if destino is null and pasada = 2 and m.marca is not null
        and (m.gasto > 0 or m.status in ('ACTIVE', 'IN_PROCESS', 'WITH_ISSUES'))
        and not exists (
          select 1 from public.campaigns c
          where c.business_unit_id = m.marca and not c.auto_from_meta
            and coalesce(c.channel, '') ilike '%meta%'
            and not exists (select 1 from public.meta_campaigns x where x.campaign_id = c.id)
            and coalesce(c.start_date, '1900-01-01'::date) <= coalesce(m.acaba, '2999-12-31'::date)
            and coalesce(c.end_date, '2999-12-31'::date) >= coalesce(m.empieza, '1900-01-01'::date)
        ) then
        insert into public.campaigns (business_unit_id, name, channel, start_date, end_date, status, notes, created_by, auto_from_meta)
        values (
          m.marca, m.name, 'Meta Ads', m.empieza, m.acaba,
          case when m.status = 'ACTIVE' and (m.acaba is null or m.acaba >= current_date) then 'active' else 'finished' end::campaign_status,
          'Creada sola desde Meta Ads. Puedes cambiarle el nombre: seguirá unida.',
          null, true
        )
        returning id into destino;
        como := 'creada';
      end if;

      if destino is not null then
        update public.meta_campaigns set campaign_id = destino, linked_by = como, updated_at = now() where meta_campaigns.meta_id = m.mid;
        meta_id := m.mid;
        meta_name := m.name;
        accion := como;
        campaign_id := destino;
        select c.name into campaign_name from public.campaigns c where c.id = destino;
        return next;
      end if;
    end loop;
  end loop;

  -- Las creadas solas siguen a Meta: empiezan con la primera, acaban con la
  -- última y están activas mientras alguna lo esté.
  update public.campaigns c
  set start_date = s.empieza,
      end_date = s.acaba,
      status = s.estado::campaign_status,
      updated_at = now()
  from (
    select mc.campaign_id,
      min(case when mc.started_at < '2000-01-01' then null else mc.started_at::date end) as empieza,
      case when bool_or(mc.stopped_at is null) then null else max(mc.stopped_at::date) end as acaba,
      case when bool_or(mc.status = 'ACTIVE' and (mc.stopped_at is null or mc.stopped_at::date >= current_date)) then 'active' else 'finished' end as estado
    from public.meta_campaigns mc
    where mc.campaign_id is not null
    group by mc.campaign_id
  ) s
  where c.id = s.campaign_id and c.auto_from_meta
    and (c.start_date is distinct from s.empieza or c.end_date is distinct from s.acaba or c.status::text <> s.estado);

  -- Los leads de un formulario que llegaron antes de que su campaña estuviera
  -- unida se quedan ahora con ella.
  update public.leads l
  set campaign_id = mc.campaign_id
  from public.meta_campaigns mc
  where l.campaign_id is null and l.meta_campaign_id = mc.meta_id and mc.campaign_id is not null;
end;
$$;

revoke all on function public.meta_reconcile_campaigns() from public, anon, authenticated;
grant execute on function public.meta_reconcile_campaigns() to service_role;

-- ---------- Leads de los formularios de Meta ----------

-- El identificador del lead en Meta: el mismo formulario no entra dos veces
-- aunque Meta avise dos veces o la revisión de la mañana lo vuelva a ver.
alter table public.leads add column if not exists meta_lead_id text;
create unique index if not exists leads_meta_lead_id_key on public.leads (meta_lead_id) where meta_lead_id is not null;

-- Las páginas de Facebook de donde salen los formularios. Las descubre la
-- sincronización con el token de cada portfolio; la marca sale de la cuenta
-- publicitaria o del nombre de la página.
create table if not exists public.meta_pages (
  page_id text primary key,
  name text not null,
  token_key text not null,
  business_unit_id uuid references public.business_units (id),
  is_active boolean not null default true,
  subscribed_at timestamptz,
  last_leads_check timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lo que ha avisado Meta y qué se hizo con cada aviso, para ver por qué un
-- lead no entró sin tener que buscar en los registros del servidor.
create table if not exists public.meta_lead_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  via text not null,
  leadgen_id text,
  page_id text,
  form_id text,
  ok boolean not null,
  message text,
  lead_id uuid references public.leads (id) on delete set null
);
create index if not exists meta_lead_events_received_idx on public.meta_lead_events (received_at desc);

alter table public.meta_pages enable row level security;
alter table public.meta_lead_events enable row level security;

-- Solo lectura, para quien ya ve Meta; escribe únicamente la sincronización,
-- que va con la clave de servicio.
drop policy if exists meta_pages_read on public.meta_pages;
create policy meta_pages_read on public.meta_pages for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'marketing', 'direction']::app_role[])));
drop policy if exists meta_lead_events_read on public.meta_lead_events;
create policy meta_lead_events_read on public.meta_lead_events for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'marketing']::app_role[])));

revoke insert, update, delete on public.meta_pages from anon, authenticated;
revoke insert, update, delete on public.meta_lead_events from anon, authenticated;
