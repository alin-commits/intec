-- Cuando una campaña se archiva en Meta, darla por finalizada aquí también.
--
-- Hasta ahora el estado de Meta se guardaba pero no salía de la pestaña de Meta
-- Ads: en Campañas una campaña podía seguir saliendo "Activa" meses después de
-- haberse apagado en Meta. Quien mira el panel no tiene por qué entrar en Meta
-- para saber qué sigue corriendo.
--
-- Qué se toca y qué no, a propósito:
--
--   · ARCHIVED o DELETED en Meta  ->  "Finalizada" aquí. Esa campaña ya no
--     vuelve: lo dice Meta, no una suposición.
--   · PAUSED NO toca nada: una campaña pausada se reanuda al día siguiente, y
--     darla por terminada sería mentir.
--   · Solo se tocan las que aquí están "Activa". Una que alguien archivó o dejó
--     en borrador a mano se queda como está: lo que decide una persona manda.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.meta_sync_campaign_status()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tocadas integer;
begin
  update public.campaigns c
     set status = 'finished',
         updated_at = now()
    from public.meta_campaigns m
   where m.campaign_id = c.id
     and upper(m.status) in ('ARCHIVED', 'DELETED')
     and c.status = 'active';
  get diagnostics tocadas = row_count;
  return tocadas;
end;
$$;

revoke execute on function public.meta_sync_campaign_status() from public, anon, authenticated;
-- Solo la llama la sincronización, que corre con la clave de servicio.
grant execute on function public.meta_sync_campaign_status() to service_role;
