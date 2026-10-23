-- El agente de Sage sabe decir que está ocupado, no solo que sigue vivo.
--
-- El agente se protege de leer Sage dos veces a la vez con un turno: la tarea
-- de cada minuto, la que recoge lo que se pide con el botón, no espera. Si hay
-- una lectura larga en marcha —el repaso de la noche, o una relectura a mano—
-- se sale sin preguntarle nada al Hub.
--
-- Visto desde el panel eso era indistinguible de un servidor apagado: el botón
-- decía «el servidor de Sage no está recogiendo peticiones, revisa la tarea» y
-- mandaba a mirar una tarea que estaba perfectamente, haciendo su trabajo.
--
-- Con esta columna el agente puede decir «sigo aquí, pero ocupado», y el panel
-- lo cuenta como lo que es: una espera, no una avería.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.sage_agent_status add column if not exists busy_since timestamptz;

comment on column public.sage_agent_status.busy_since is
  'Desde cuándo el agente está ocupado con otra lectura y no puede recoger peticiones. Nulo: libre.';
