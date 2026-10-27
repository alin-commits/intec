-- El rol de la agencia externa.
--
-- OJO: esta migración solo CREA el valor del enum. Postgres no deja usar un
-- valor nuevo en la misma transacción en la que se añade, así que los permisos
-- van aparte, en 202610270003_rol_agencia_permisos.sql. Hay que ejecutar esta
-- primero y la otra después, no las dos juntas.
--
--   agency : la agencia que lleva la captación por fuera. Ve las consultas que
--            entran —y las ventas apuntadas de esas consultas— de las unidades
--            que se le asignen, y nada más. No escribe: ni crea, ni edita, ni
--            borra. Es un comercial sin manos.
--
-- Se puede volver a ejecutar sin romper nada.

alter type public.app_role add value if not exists 'agency';
