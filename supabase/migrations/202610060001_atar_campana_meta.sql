-- Atar una campaña de Meta a la de la aplicación: que se pueda de verdad.
--
-- El botón "Completar" de la pestaña de Meta Ads guardaba los ingresos y los
-- cualificados —esa tabla sí tiene permiso de escritura— pero el enlace no se
-- guardaba nunca. meta_campaigns solo tenía política de lectura, así que la
-- actualización salía filtrada por RLS y PostgREST respondía "204, todo bien"
-- sin tocar una fila. Desde la aplicación no había forma de notarlo: ni error,
-- ni aviso, ni cambio.
--
-- No se abre la tabla entera a escritura: la rellena la sincronización con
-- Meta, y dejar que el navegador cambie el nombre o el estado de una campaña
-- sería pedir que la próxima lectura lo pise. En su lugar, una función que
-- toca solo lo que decide una persona: a qué campaña se ata.
--
-- Atar o desatar a mano deja la decisión bloqueada, para que la lectura de la
-- mañana no vuelva a unir (ni a soltar) esa campaña por su cuenta.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.meta_campaign_set_link(p_meta_id text, p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]) then
    raise exception 'No tienes permiso para atar campañas de Meta.';
  end if;

  update public.meta_campaigns
     set campaign_id = p_campaign_id,
         link_locked = true,
         linked_by = 'persona',
         updated_at = now()
   where meta_id = p_meta_id;

  if not found then
    raise exception 'No existe esa campaña de Meta.';
  end if;
end;
$$;

revoke execute on function public.meta_campaign_set_link(text, uuid) from public, anon;
grant execute on function public.meta_campaign_set_link(text, uuid) to authenticated;
