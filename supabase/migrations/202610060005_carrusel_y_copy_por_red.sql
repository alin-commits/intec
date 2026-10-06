-- El organizador, con carruseles y con el copy separado por red.
--
-- Dos cosas que faltaban para poder trabajar de verdad:
--
--   · Instagram y Facebook se publican juntos, con la misma foto y distinto
--     texto. Tener una lista para cada uno obligaba a subir la foto dos veces.
--     Ahora hay una sola lista para los dos y el texto va por red dentro de la
--     ficha: `captions` es {"instagram": "...", "facebook": "..."}. LinkedIn
--     sigue siendo su propia lista, porque ahí los creativos son otros —y
--     porque ya hay publicaciones guardadas en ella que no se van a mover.
--   · Un post puede llevar varias fotos. Instagram lo llama carrusel y en el
--     perfil solo se ve la primera, así que la rejilla no cambia; lo que cambia
--     es que una publicación deja de ser "una foto" y pasa a ser "sus fotos,
--     en orden".
--
-- Lo que ya hay se conserva: cada copy escrito se guarda bajo la red en la que
-- se escribió, y la foto de cada publicación pasa a ser la primera de su
-- carrusel.
--
-- `social_posts.image_path` se queda sin tocar y pasa a ser nullable: el código
-- que está en producción lo lee hasta que suba el nuevo, así que no se borra
-- en la misma migración. Cuando esté desplegado se puede quitar.
--
-- Se puede volver a ejecutar sin romper nada.

-- ---------- 1. El copy, por red ----------

alter table public.social_posts add column if not exists captions jsonb not null default '{}'::jsonb;

update public.social_posts
   set captions = jsonb_build_object(network, caption)
 where caption is not null
   and btrim(caption) <> ''
   and captions = '{}'::jsonb;

comment on column public.social_posts.captions is
  'El texto de cada red: {"instagram": "...", "facebook": "..."}. Vacío en una red significa que ahí no se publica.';

-- ---------- 2. Instagram y Facebook, en la misma lista ----------
-- La columna sigue admitiendo los tres valores, pero 'facebook' deja de usarse
-- como lista: ese texto vive ahora en captions->>'facebook'.

update public.social_posts
   set captions = captions || jsonb_build_object('facebook', coalesce(captions->>'facebook', caption)),
       network = 'instagram'
 where network = 'facebook';

comment on column public.social_posts.network is
  'La lista a la que pertenece: ''instagram'' (Instagram y Facebook juntos) o ''linkedin''.';

-- ---------- 3. Las fotos de cada publicación ----------

create table if not exists public.social_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  image_path text not null,
  file_name text,
  -- El orden dentro del carrusel; la 0 es la que se ve en el perfil.
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists social_post_images_post_idx on public.social_post_images (post_id, position);

-- Lo que ya hay: cada publicación estrena carrusel con su foto de siempre.
insert into public.social_post_images (post_id, image_path, file_name, position)
select p.id, p.image_path, p.file_name, 0
  from public.social_posts p
 where p.image_path is not null
   and not exists (select 1 from public.social_post_images i where i.post_id = p.id);

alter table public.social_posts alter column image_path drop not null;

alter table public.social_post_images enable row level security;

drop policy if exists social_post_images_read_by_role on public.social_post_images;
create policy social_post_images_read_by_role on public.social_post_images
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin', 'commercial', 'marketing', 'viewer', 'direction']::app_role[])));

drop policy if exists social_post_images_staff_insert on public.social_post_images;
create policy social_post_images_staff_insert on public.social_post_images
for insert to authenticated
  with check ((select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])));

drop policy if exists social_post_images_staff_update on public.social_post_images;
create policy social_post_images_staff_update on public.social_post_images
for update to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])));

drop policy if exists social_post_images_staff_delete on public.social_post_images;
create policy social_post_images_staff_delete on public.social_post_images
for delete to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])));

comment on table public.social_post_images is
  'Las fotos de una publicación, en orden. Una sola es un post normal; varias, un carrusel: en el perfil solo se ve la primera.';
