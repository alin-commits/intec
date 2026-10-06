-- El organizador de publicaciones: las fotos que están por subir, con su
-- texto, su orden y si ya se publicaron o no.
--
-- Hasta ahora el visor del feed era una mesa de pruebas que no guardaba nada.
-- Sirve para mirar, pero no para trabajar: lo que se prepara un lunes hay que
-- volver a montarlo el martes. Esto lo guarda, por marca y por red, para que
-- el feed preparado esté donde está todo lo demás y lo vea quien tenga que
-- verlo.
--
-- Decisiones que conviene recordar:
--
--   · El orden lo pone una persona arrastrando, no la fecha. Instagram enseña
--     el perfil por orden de publicación, así que lo que importa es cómo quedan
--     unas al lado de otras, no el día. Por eso hay `position` y no hay fecha.
--   · `status` solo tiene dos valores. Un post está por subir o ya está
--     subido; cualquier otra cosa es inventarse trabajo.
--   · Borrar lo puede hacer marketing, sin la regla de los diez minutos que
--     llevan las tablas de datos. Esto es material de trabajo, no contabilidad:
--     si alguien descarta una foto que ya no va, tiene que poder hacerlo.
--   · Las fotos van en un cubo privado. Son material sin publicar: no tienen
--     por qué ser accesibles con la dirección a secas.
--
-- Se puede volver a ejecutar sin romper nada.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  network text not null default 'instagram' check (network in ('instagram', 'facebook', 'linkedin')),
  -- Dónde está la foto dentro del cubo 'social-posts'.
  image_path text not null,
  -- El nombre con el que la subieron, para reconocerla y para la descarga.
  file_name text,
  caption text,
  status text not null default 'pendiente' check (status in ('pendiente', 'subida')),
  -- Cuanto más bajo, más arriba en el feed: lo nuevo entra por delante.
  position integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_posts_unit_network_idx on public.social_posts (business_unit_id, network, position);

drop trigger if exists social_posts_set_updated_at on public.social_posts;
create trigger social_posts_set_updated_at before update on public.social_posts
for each row execute function public.set_updated_at();

alter table public.social_posts enable row level security;

-- Lo ve quien ve el resto de métricas de redes.
drop policy if exists social_posts_read_by_role on public.social_posts;
create policy social_posts_read_by_role on public.social_posts
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin', 'commercial', 'marketing', 'viewer', 'direction']::app_role[])));

drop policy if exists social_posts_staff_insert on public.social_posts;
create policy social_posts_staff_insert on public.social_posts
for insert to authenticated
  with check (
    (select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[]))
    and created_by = (select auth.uid())
  );

drop policy if exists social_posts_staff_update on public.social_posts;
create policy social_posts_staff_update on public.social_posts
for update to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])));

drop policy if exists social_posts_staff_delete on public.social_posts;
create policy social_posts_staff_delete on public.social_posts
for delete to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])));

-- ---------- El cubo de las fotos ----------
-- 25 MB por foto: una foto de móvil sin comprimir ronda los 5.

insert into storage.buckets (id, name, public, file_size_limit)
values ('social-posts', 'social-posts', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists social_post_objects_read on storage.objects;
create policy social_post_objects_read on storage.objects
for select to authenticated
  using (bucket_id = 'social-posts' and (select public.current_user_has_any_role(ARRAY['admin', 'commercial', 'marketing', 'viewer', 'direction']::app_role[])));

drop policy if exists social_post_objects_insert on storage.objects;
create policy social_post_objects_insert on storage.objects
for insert to authenticated
  with check (bucket_id = 'social-posts' and (select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])));

drop policy if exists social_post_objects_delete on storage.objects;
create policy social_post_objects_delete on storage.objects
for delete to authenticated
  using (bucket_id = 'social-posts' and (select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])));

comment on table public.social_posts is
  'Publicaciones preparadas para redes: foto, texto, orden en el feed y si ya está subida. El orden lo decide una persona, no la fecha.';
