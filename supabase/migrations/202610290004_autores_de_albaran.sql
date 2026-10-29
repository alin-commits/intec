-- Quién hace cada albarán, y a qué comercial se le apunta.
--
-- Un albarán lo hace una persona, pero la venta se le cuenta al comercial que
-- lleva el cliente. Sage guarda las dos cosas: el comercial en
-- CodigoComisionista y quien lo hizo en _TS_SysUsuario —o, en los de la
-- tienda, en el operador del TPV—. Con las dos se ve cuántos albaranes hace un
-- comercial que se le apuntan a otro.
--
-- Lo comprobado antes de escribir esto, en 90 días de albaranes: el 81 % lleva
-- usuario, y la mayor parte del resto son de tienda, que llevan el operador
-- del TPV.
--
-- Una trampa que hay que tener presente: el número de usuario de Sage no es el
-- de comercial. El usuario 24 no es el comercial 24. Por eso quién es quién se
-- apunta a mano, en sage_author_reps, y nunca se deduce del número.
--
-- Se puede volver a ejecutar sin romper nada.

-- ---------- Lo que manda el agente ----------

-- Albaranes por día, autor y comercial asignado. Agrupados, no uno a uno: para
-- contar no hace falta más, y son cientos de filas por mes en vez de miles.
create table if not exists public.sage_delivery_authors (
  id bigint generated always as identity primary key,
  company_code smallint not null,
  day date not null,
  -- _TS_SysUsuario. 0 cuando el albarán no lo lleva.
  author_user smallint not null default 0,
  -- T_CodigoOperador, en los de la tienda. Vacío cuando no es del TPV.
  tpv_operator text not null default '',
  -- El comercial al que se le apunta la venta. Nulo: sin comercial asignado.
  rep_code integer,
  documents integer not null default 0,
  net_amount numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists sage_delivery_authors_dia on public.sage_delivery_authors (day);

-- Los usuarios de Sage: el código y el nombre con el que entran. Nada más: la
-- tabla de Sage guarda también contraseñas y el agente no las lee.
create table if not exists public.sage_users (
  code smallint primary key,
  name text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Los operadores del TPV y el usuario de Sage al que corresponden.
create table if not exists public.sage_tpv_operators (
  company_code smallint not null,
  code text not null,
  description text,
  sage_user_name text,
  updated_at timestamptz not null default now(),
  primary key (company_code, code)
);

-- ---------- Lo que se apunta en el Hub ----------

/*
  Quién es quién: cada autor de albaranes, con el comercial que es o marcado
  como de oficina.

  El autor va como texto: «u:25» es el usuario 25 de Sage, y «t:1:150» un
  operador de TPV de la sociedad 1 que Sage no enlaza con ningún usuario. Así
  cualquier autor se puede asignar, venga de donde venga.

  El comercial es la persona del panel —la clave con la que el panel junta las
  fichas repetidas de alguien—, no una ficha de Sage: alguien con ficha en dos
  sociedades es una sola persona.
*/
create table if not exists public.sage_author_reps (
  author text primary key check (author ~ '^(u:\d+|t:\d+:.+)$'),
  rep_key text,
  is_office boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (not (is_office and rep_key is not null))
);

-- ---------- Quién lo lee y quién lo escribe ----------

alter table public.sage_delivery_authors enable row level security;
alter table public.sage_users enable row level security;
alter table public.sage_tpv_operators enable row level security;
alter table public.sage_author_reps enable row level security;

-- Lo lee quien lee el panel de ventas, como el resto de tablas de Sage.
drop policy if exists sage_delivery_authors_read on public.sage_delivery_authors;
create policy sage_delivery_authors_read on public.sage_delivery_authors for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));
drop policy if exists sage_users_read on public.sage_users;
create policy sage_users_read on public.sage_users for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));
drop policy if exists sage_tpv_operators_read on public.sage_tpv_operators;
create policy sage_tpv_operators_read on public.sage_tpv_operators for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

-- Quién es quién lo lee el panel y lo apuntan administración y dirección,
-- los mismos que ponen los objetivos.
drop policy if exists sage_author_reps_read on public.sage_author_reps;
create policy sage_author_reps_read on public.sage_author_reps for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));
drop policy if exists sage_author_reps_write on public.sage_author_reps;
create policy sage_author_reps_write on public.sage_author_reps for all to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

-- ---------- La ingesta ----------

/*
  Lo que manda el agente de autores, en su propia función como compras y
  pagos: así no se toca sage_ingest, y si esto falla la lectura sigue.

  Los albaranes por autor van por tramos: se borra el tramo que cubre el envío
  y se escribe entero, igual que la venta por día. Solo si el envío lo trae: un
  envío sin esa parte no borra nada.
*/
create or replace function public.sage_ingest_authors(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_desde date := nullif(p->>'covered_from', '')::date;
  v_hasta date := nullif(p->>'covered_to', '')::date;
begin
  perform pg_advisory_xact_lock(hashtext('public.sage_ingest'));

  if jsonb_typeof(p->'delivery_authors') = 'array' and v_desde is not null and v_hasta is not null then
    delete from sage_delivery_authors where day between v_desde and v_hasta;
    insert into sage_delivery_authors (company_code, day, author_user, tpv_operator, rep_code, documents, net_amount, updated_at)
    select x.company_code, x.day, coalesce(x.author_user, 0), coalesce(btrim(x.tpv_operator), ''), x.rep_code,
           sum(coalesce(x.documents, 0)), sum(coalesce(x.net_amount, 0)), now()
    from jsonb_to_recordset(p->'delivery_authors') as x(company_code smallint, day date, author_user smallint,
         tpv_operator text, rep_code integer, documents integer, net_amount numeric)
    where x.day between v_desde and v_hasta
    group by x.company_code, x.day, coalesce(x.author_user, 0), coalesce(btrim(x.tpv_operator), ''), x.rep_code;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('delivery_authors', v_n);
  end if;

  if jsonb_typeof(p->'sage_users') = 'array' then
    insert into sage_users (code, name, is_active, updated_at)
    select distinct on (x.code) x.code, btrim(x.name), coalesce(x.is_active, true), now()
    from jsonb_to_recordset(p->'sage_users') as x(code smallint, name text, is_active boolean)
    where x.code is not null and nullif(btrim(x.name), '') is not null
    on conflict (code) do update set name = excluded.name, is_active = excluded.is_active, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('sage_users', v_n);
  end if;

  if jsonb_typeof(p->'tpv_operators') = 'array' then
    insert into sage_tpv_operators (company_code, code, description, sage_user_name, updated_at)
    select distinct on (x.company_code, btrim(x.code)) x.company_code, btrim(x.code), x.description, nullif(btrim(x.sage_user_name), ''), now()
    from jsonb_to_recordset(p->'tpv_operators') as x(company_code smallint, code text, description text, sage_user_name text)
    where nullif(btrim(x.code), '') is not null
    on conflict (company_code, code) do update set
      description = excluded.description, sage_user_name = excluded.sage_user_name, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('tpv_operators', v_n);
  end if;

  return v_counts;
end;
$$;
revoke execute on function public.sage_ingest_authors(jsonb) from public, anon, authenticated;

-- ---------- Lo que lee el panel ----------

/*
  Albaranes de un tramo por autor y comercial asignado.

  El autor sale resuelto: el usuario de Sage si el albarán lo lleva; si no, el
  usuario al que corresponde su operador de TPV; y si el operador no está
  enlazado con nadie, el propio operador. El nombre, el de Sage.

  El operador se enlaza con el usuario por el nombre con el que entra, sin
  mayúsculas ni espacios de más, y como mucho con uno: si dos usuarios se
  llamaran igual, un mismo albarán no puede contar dos veces.

  Va por mes ("2026-09") para que el panel pueda quedarse con los meses
  marcados aunque no vayan seguidos.
*/
-- Si cambia lo que devuelve, «create or replace» no basta: hay que quitarla.
drop function if exists public.sage_authors_summary(date, date, smallint[]);
create or replace function public.sage_authors_summary(p_from date, p_to date, p_companies smallint[] default null)
returns table(month text, company_code smallint, author text, author_name text, rep_code integer, documents bigint, net_amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with resueltos as (
    select to_char(d.day, 'YYYY-MM') as month, d.company_code, d.rep_code, d.documents, d.net_amount,
      case
        when d.author_user > 0 then 'u:' || d.author_user
        when d.tpv_operator <> '' then coalesce('u:' || enlazado.code, 't:' || d.company_code || ':' || d.tpv_operator)
        else 'desconocido'
      end as author,
      case
        when d.author_user > 0 then coalesce(su.name, 'Usuario ' || d.author_user)
        when d.tpv_operator <> '' then coalesce(enlazado.name, nullif(btrim(o.description), ''), 'TPV ' || d.tpv_operator)
        else 'Sin autor apuntado'
      end as author_name
    from sage_delivery_authors d
    left join sage_users su on su.code = d.author_user
    left join sage_tpv_operators o on o.company_code = d.company_code and o.code = d.tpv_operator
    left join lateral (
      select u.code, u.name from sage_users u
      where o.sage_user_name is not null and lower(btrim(u.name)) = lower(btrim(o.sage_user_name))
      order by u.code limit 1
    ) enlazado on true
    where d.day between p_from and p_to
      and (p_companies is null or d.company_code = any(p_companies))
  )
  select r.month, r.company_code, r.author, r.author_name, r.rep_code, sum(r.documents)::bigint, sum(r.net_amount)
  from resueltos r
  group by r.month, r.company_code, r.author, r.author_name, r.rep_code;
$$;
revoke execute on function public.sage_authors_summary(date, date, smallint[]) from public, anon;
grant execute on function public.sage_authors_summary(date, date, smallint[]) to authenticated;
