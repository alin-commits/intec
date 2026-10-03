-- Dos arreglos de la revisión de seguridad.
--
-- 1. Quién creó un registro y cuándo no se puede cambiar.
--    Borrar lo de otro solo lo puede hacer administración; el resto solo borra
--    lo suyo en los 10 minutos siguientes a crearlo. Pero al editar se podía
--    reescribir el autor y la fecha de un registro de un compañero, hacerlo
--    "propio y recién creado" y borrarlo sin dejar rastro. Ahora, al editar, el
--    autor y la fecha se quedan como estaban (salvo con la clave de servicio).
--
-- 2. Restringir una carpeta de Contraseñas restringe también sus subcarpetas.
--    La lista de quién ve una carpeta solo valía para esa carpeta: las
--    credenciales de sus subcarpetas seguían a la vista de todos. Ahora decide
--    la carpeta más cercana con lista (la propia o la primera de encima), igual
--    que ya comprueba la aplicación al mostrar una contraseña.

create or replace function public.freeze_authorship()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.freeze_authorship() from public, anon, authenticated;

drop trigger if exists inquiries_freeze_authorship on public.inquiries;
create trigger inquiries_freeze_authorship before update on public.inquiries
  for each row execute function public.freeze_authorship();
drop trigger if exists sales_entries_freeze_authorship on public.sales_entries;
create trigger sales_entries_freeze_authorship before update on public.sales_entries
  for each row execute function public.freeze_authorship();
drop trigger if exists mailing_campaigns_freeze_authorship on public.mailing_campaigns;
create trigger mailing_campaigns_freeze_authorship before update on public.mailing_campaigns
  for each row execute function public.freeze_authorship();
drop trigger if exists social_media_stats_freeze_authorship on public.social_media_stats;
create trigger social_media_stats_freeze_authorship before update on public.social_media_stats
  for each row execute function public.freeze_authorship();
drop trigger if exists meta_ads_entries_freeze_authorship on public.meta_ads_entries;
create trigger meta_ads_entries_freeze_authorship before update on public.meta_ads_entries
  for each row execute function public.freeze_authorship();

-- Las carpetas que esta persona no puede ver: las que tienen lista sin ella y
-- todo lo que cuelga de ellas, salvo que una subcarpeta tenga su propia lista.
create or replace function public.vault_blocked_categories()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select c.id as folder, c.id as ancestor, c.parent_id, 0 as depth
    from public.vault_categories c
    union all
    select chain.folder, p.id, p.parent_id, chain.depth + 1
    from chain
    join public.vault_categories p on p.id = chain.parent_id
    where chain.depth < 20
  ),
  nearest as (
    select distinct on (chain.folder) chain.folder, chain.ancestor
    from chain
    where exists (select 1 from public.vault_category_access a where a.category_id = chain.ancestor)
    order by chain.folder, chain.depth
  )
  select coalesce(array_agg(n.folder), '{}'::uuid[])
  from nearest n
  where not exists (
    select 1 from public.vault_category_access mine
    where mine.category_id = n.ancestor and mine.user_id = auth.uid()
  );
$$;
revoke execute on function public.vault_blocked_categories() from public, anon;
grant execute on function public.vault_blocked_categories() to authenticated;
