-- La revisión de los formularios de Meta, cada hora.
--
-- Los leads entran al momento por el aviso de Meta; esta revisión es la red de
-- seguridad por si algún aviso se pierde. Vercel, en su plan gratuito, solo
-- deja programar tareas una vez al día, así que la lanza la base de datos:
-- pg_cron la programa y pg_net llama a la aplicación.
--
-- La clave no está aquí (este archivo va a git): se guardó aparte en la caja
-- fuerte de Supabase como 'meta_leads_cron_secret', y es la misma que
-- META_LEADS_CRON_SECRET en Vercel. Solo sirve para lanzar esta revisión.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Se puede volver a ejecutar: primero se quita la tarea si ya existía.
select cron.unschedule(jobid) from cron.job where jobname = 'meta-formularios-cada-hora';

-- A y cuarto de cada hora (la del gasto va a las 6:30 UTC, sin pisarse).
select cron.schedule(
  'meta-formularios-cada-hora',
  '15 * * * *',
  $job$
    select net.http_get(
      url := 'https://app.suministrointec.com/api/cron/meta-leads',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'meta_leads_cron_secret')
      ),
      timeout_milliseconds := 30000
    );
  $job$
);
