-- Fuera las vistas puente de los nombres viejos.
--
-- La migración anterior renombró meta_ads_entries a ads_entries y meta_sync_runs
-- a ads_sync_runs, y dejó dos vistas con los nombres de antes para que lo que
-- estaba desplegado siguiera funcionando mientras salía la versión nueva.
--
-- Ya salió, así que nadie las pide. Se quitan por lo mismo que se pusieron: una
-- vista con nombre de tabla que nadie usa es una trampa para quien venga luego y
-- crea que ahí vive algo.
--
-- Se puede volver a ejecutar sin romper nada.

drop view if exists public.meta_ads_entries;
drop view if exists public.meta_sync_runs;
