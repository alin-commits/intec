-- El rol de propietario, primera parte: crear el valor.
--
-- Va en su propia migración a propósito. Postgres no deja usar un valor nuevo
-- de un enum en la misma transacción en que se añade, y el editor de Supabase
-- ejecuta cada script dentro de una transacción. Si esto y la parte 2 fueran el
-- mismo archivo, fallaría con "unsafe use of new value of enum type".
--
-- Ejecuta este primero, y después 202609290009_propietario_intocable.sql.
--
-- Qué es el propietario: un escudo, no un permiso. No abre ninguna puerta que
-- no abra ya "admin" — quien lo tenga sigue necesitando admin para trabajar.
-- Lo único que hace es que nadie pueda degradarle, desactivarle ni borrarle.
-- Por eso no aparece en ninguna política: no hay 182 reglas que tocar.

alter type public.app_role add value if not exists 'owner';
