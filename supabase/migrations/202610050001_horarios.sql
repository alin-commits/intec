-- El cuadrante de horarios: quién trabaja, cuándo, y qué pasa esta semana.
--
-- Hoy esto vive en un Excel que se rehace cada mes a mano. El problema del
-- Excel no es el Excel: es que 24 personas por 20 días son 480 celdas, así que
-- rellenarlo entero es inviable y acaba copiándose del mes anterior con los
-- errores incluidos.
--
-- Por eso aquí no se guarda el horario de cada día. Se guarda:
--
--   · el turno HABITUAL de cada persona (de lunes a viernes, mañana y tarde);
--   · y encima, solo lo que se sale de lo habitual: festivos, vacaciones,
--     bajas, tardes libres y el horario raro de un día suelto.
--
-- En el octubre que hay sobre la mesa eso son unas 40 excepciones en vez de
-- 480 celdas, y el resto del cuadrante se dibuja solo todos los meses.
--
-- Los festivos van aparte, en su propia tabla: son de toda la casa y marcarlos
-- persona por persona sería volver al problema de antes.
--
-- Se puede volver a ejecutar entera sin romper nada.

-- ---------- Quién ----------

create table if not exists public.staff_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.staff_departments(id) on delete restrict,
  -- El nombre que sale en el cuadrante, que es el corto: "JUAN CARLOS", no el
  -- nombre completo del contrato.
  display_name text not null,
  -- Si además tiene cuenta en la aplicación, se ata; la mayoría de la plantilla
  -- no la tiene, así que es opcional.
  profile_id uuid references public.profiles(id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_members_department_idx on public.staff_members (department_id, sort_order);

-- ---------- El turno de siempre ----------
-- Una fila por persona y día de la semana (1 lunes … 5 viernes). Sin fila, ese
-- día no trabaja. La tarde puede ir vacía: hay quien solo hace mañana.

create table if not exists public.staff_shift_templates (
  member_id uuid not null references public.staff_members(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  morning_start time,
  morning_end time,
  afternoon_start time,
  afternoon_end time,
  updated_at timestamptz not null default now(),
  primary key (member_id, weekday),
  constraint staff_shift_templates_algo_que_decir check (
    (morning_start is not null and morning_end is not null)
    or (afternoon_start is not null and afternoon_end is not null)
  )
);

-- ---------- Lo que se sale de lo habitual ----------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'staff_exception_kind') then
    create type public.staff_exception_kind as enum ('vacaciones', 'baja', 'permiso', 'tarde_libre', 'horario', 'no_trabaja');
  end if;
end
$$;

create table if not exists public.staff_exceptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.staff_members(id) on delete cascade,
  day date not null,
  kind public.staff_exception_kind not null,
  -- Solo para 'horario' y 'tarde_libre': las horas de ese día en concreto.
  morning_start time,
  morning_end time,
  afternoon_start time,
  afternoon_end time,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, day)
);
create index if not exists staff_exceptions_day_idx on public.staff_exceptions (day);

-- ---------- Festivos y avisos de la semana ----------

create table if not exists public.staff_holidays (
  day date primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- El aviso en rojo que lleva la cabecera de algunas semanas, como
-- "NO SE LIBRA POR FESTIVO 12/10". Una por semana, guardada por su lunes.
create table if not exists public.staff_week_notes (
  week_start date primary key,
  note text not null,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

-- ---------- Quién ve y quién escribe ----------
-- Ver: administración y dirección, que son quienes miran la plantilla entera.
-- Escribir: solo administración, como el resto de lo que reparte trabajo.

do $$
declare
  t text;
begin
  foreach t in array array['staff_departments', 'staff_members', 'staff_shift_templates', 'staff_exceptions', 'staff_holidays', 'staff_week_notes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_has_any_role(ARRAY[''admin'',''direction'']::app_role[])))',
      t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.current_user_has_any_role(ARRAY[''admin'']::app_role[]))) with check ((select public.current_user_has_any_role(ARRAY[''admin'']::app_role[])))',
      t || '_write', t);
  end loop;
end
$$;

-- ---------- Los departamentos ----------
-- En el orden en que salen en el cuadrante de papel, que es el orden en que la
-- gente lo lee. Los nombres de las personas NO van aquí: este archivo acaba en
-- un repositorio público.

insert into public.staff_departments (name, sort_order) values
  ('RESPONSABLES', 10),
  ('COMERCIALES', 20),
  ('ADMINISTRACIÓN', 30),
  ('WEB', 40),
  ('MK+IT', 50),
  ('COMPRAS', 60),
  ('DAAC', 70),
  ('TIENDA', 80),
  ('ALMACÉN', 90),
  ('SAT', 100)
on conflict (name) do update set sort_order = excluded.sort_order;
