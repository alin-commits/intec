-- Los albaranes uno a uno, con quién los hizo y a quién se facturan.
--
-- El panel de albaranes por comercial cuenta con totales por día. Para tener
-- el control hace falta ver cuáles son: al pulsar «Pablo le hizo 64 a Ana
-- Beltrán», la lista de esos 64, con fecha, número, cliente e importe.
--
-- Mismo camino que los pedidos uno a uno: el agente los manda por tramos y se
-- guardan en la función de autores (sage_ingest_authors), que borra el tramo
-- y lo escribe entero.
--
-- Se puede volver a ejecutar sin romper nada.

create table if not exists public.sage_delivery_documents (
  company_code smallint not null,
  fiscal_year smallint not null,
  series text not null default '',
  number integer not null,
  day date not null,
  customer_code text,
  -- CodigoComisionista: a quién se factura. Nulo: sin comercial.
  rep_code integer,
  -- _TS_SysUsuario; 0 si no lo lleva.
  author_user smallint not null default 0,
  -- T_CodigoOperador, en los de la tienda.
  tpv_operator text not null default '',
  net_amount numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_code, fiscal_year, series, number)
);
create index if not exists sage_delivery_documents_dia on public.sage_delivery_documents (day);

alter table public.sage_delivery_documents enable row level security;
drop policy if exists sage_delivery_documents_read on public.sage_delivery_documents;
create policy sage_delivery_documents_read on public.sage_delivery_documents for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

-- ---------- La ingesta, con los albaranes uno a uno ----------

/*
  La misma función de autores de antes, con una parte más: los albaranes uno
  a uno. Como los totales, por tramos: se borra el tramo y se escribe entero.
  Si un albarán cambia de fecha y cae en otro tramo, la clave lo actualiza en
  vez de repetirlo.
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

  if jsonb_typeof(p->'delivery_documents') = 'array' and v_desde is not null and v_hasta is not null then
    delete from sage_delivery_documents where day between v_desde and v_hasta;
    insert into sage_delivery_documents (company_code, fiscal_year, series, number, day, customer_code, rep_code,
                                         author_user, tpv_operator, net_amount, updated_at)
    select distinct on (x.company_code, x.fiscal_year, coalesce(btrim(x.series), ''), x.number)
           x.company_code, x.fiscal_year, coalesce(btrim(x.series), ''), x.number, x.day, nullif(btrim(x.customer_code), ''),
           x.rep_code, coalesce(x.author_user, 0), coalesce(btrim(x.tpv_operator), ''), coalesce(x.net_amount, 0), now()
    from jsonb_to_recordset(p->'delivery_documents') as x(company_code smallint, fiscal_year smallint, series text,
         number integer, day date, customer_code text, rep_code integer, author_user smallint, tpv_operator text, net_amount numeric)
    where x.day between v_desde and v_hasta and x.fiscal_year is not null and x.number is not null
    order by x.company_code, x.fiscal_year, coalesce(btrim(x.series), ''), x.number
    on conflict (company_code, fiscal_year, series, number) do update set
      day = excluded.day, customer_code = excluded.customer_code, rep_code = excluded.rep_code,
      author_user = excluded.author_user, tpv_operator = excluded.tpv_operator, net_amount = excluded.net_amount, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('delivery_documents', v_n);
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

-- ---------- La lista que abre el panel ----------

/*
  Los albaranes de un tramo, con el autor resuelto igual que en
  sage_authors_summary (el usuario; si no, el usuario de su operador de TPV;
  si no, el operador) y el nombre del cliente.

  - p_authors: solo los de estos autores ("u:25", "t:1:150").
  - p_not_authors: los de cualquier autor menos estos y menos los sin autor.
    Es «otros empleados»: todo el que no es de ningún comercial.
  - p_reps: solo los que se facturan a estas fichas, como "1:51" (sociedad y
    comisionista); "1:sin" son los de la sociedad 1 sin comercial.
*/
create or replace function public.sage_delivery_documents_list(
  p_from date,
  p_to date,
  p_authors text[] default null,
  p_not_authors text[] default null,
  p_reps text[] default null,
  p_companies smallint[] default null
)
returns table(company_code smallint, fiscal_year smallint, series text, number integer, day date,
              customer_code text, customer_name text, rep_code integer, author text, author_name text, net_amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with resueltos as (
    select d.company_code as empresa, d.fiscal_year as ejercicio, d.series as serie, d.number as numero, d.day as dia,
      d.customer_code as cliente, d.rep_code as comisionista, d.net_amount as neto,
      case
        when d.author_user > 0 then 'u:' || d.author_user
        when d.tpv_operator <> '' then coalesce('u:' || enlazado.code, 't:' || d.company_code || ':' || d.tpv_operator)
        else 'desconocido'
      end as autor,
      case
        when d.author_user > 0 then coalesce(su.name, 'Usuario ' || d.author_user)
        when d.tpv_operator <> '' then coalesce(enlazado.name, nullif(btrim(o.description), ''), 'TPV ' || d.tpv_operator)
        else 'Sin autor apuntado'
      end as nombre_autor
    from sage_delivery_documents d
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
  select r.empresa, r.ejercicio, r.serie, r.numero, r.dia, r.cliente, c.name, r.comisionista, r.autor, r.nombre_autor, r.neto
  from resueltos r
  left join sage_customers c on c.company_code = r.empresa and c.code = r.cliente
  where (p_authors is null or r.autor = any(p_authors))
    and (p_not_authors is null or (r.autor <> 'desconocido' and not (r.autor = any(p_not_authors))))
    and (p_reps is null or (r.empresa || ':' || coalesce(r.comisionista::text, 'sin')) = any(p_reps));
$$;
revoke execute on function public.sage_delivery_documents_list(date, date, text[], text[], text[], smallint[]) from public, anon;
grant execute on function public.sage_delivery_documents_list(date, date, text[], text[], text[], smallint[]) to authenticated;
