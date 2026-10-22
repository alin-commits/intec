-- Una campaña cuya fecha ya pasó deja de decir que está activa.
--
-- Meta no ayuda aquí: su `status` es el interruptor de encendido, no si el
-- calendario de la campaña ha terminado. Una campaña programada del 28/09 al
-- 08/10 sigue figurando como ACTIVE en Meta semanas después de acabar, así que
-- la sincronización —que solo miraba ARCHIVED y DELETED— la dejaba como activa
-- y la tarjeta mentía: "Activa", con unas fechas que terminaron hace dos
-- semanas.
--
-- Se añade lo que sí sabemos con certeza: si la campaña tenía fecha de fin y
-- esa fecha ya pasó, está terminada. Sin fecha de fin no se toca: una campaña
-- abierta sigue abierta mientras Meta no diga lo contrario.
--
-- Las pausadas se quedan como están a propósito. Pausar no es terminar —se
-- pausa un fin de semana y se reanuda el lunes—, y marcarlas como finalizadas
-- obligaría a alguien a reabrirlas a mano cada vez. Eso se enseña en la
-- tarjeta, que es donde hace falta saberlo, sin tocar el estado.
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
  porFecha integer;
begin
  -- Lo que dice Meta: archivada o borrada es que ya no existe.
  update public.campaigns c
     set status = 'finished',
         updated_at = now()
    from public.meta_campaigns m
   where m.campaign_id = c.id
     and upper(m.status) in ('ARCHIVED', 'DELETED')
     and c.status = 'active';
  get diagnostics tocadas = row_count;

  -- Y lo que dice el calendario, que Meta no refleja.
  update public.campaigns c
     set status = 'finished',
         updated_at = now()
   where c.status = 'active'
     and c.end_date is not null
     and c.end_date < current_date;
  get diagnostics porFecha = row_count;

  return tocadas + porFecha;
end;
$$;

revoke execute on function public.meta_sync_campaign_status() from public, anon, authenticated;
-- Solo la llama la sincronización, que corre con la clave de servicio.
grant execute on function public.meta_sync_campaign_status() to service_role;
