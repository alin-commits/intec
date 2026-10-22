-- El rol de compras.
--
-- OJO: esta migración solo CREA el valor del enum. Postgres no deja usar un
-- valor nuevo en la misma transacción en la que se añade, así que los permisos
-- van aparte, en 202610220005_rol_compras_permisos.sql. Hay que ejecutar esta
-- primero y la otra después, no las dos juntas.
--
--   purchasing : lleva los pedidos a proveedor. Ve Compras y nada más; no toca
--                ventas, ni leads, ni el gestor de contraseñas salvo que se le
--                dé aparte.
--
-- Se puede volver a ejecutar sin romper nada.

alter type public.app_role add value if not exists 'purchasing';
