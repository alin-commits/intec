-- El rol de Administración (el departamento), primera parte: crear el valor.
--
-- No confundir con "admin", que en el Hub se llama Administrador y es quien
-- gestiona la plataforma. Administración es quien hace los pagos: entra en
-- Pagos (remesas de confirming, tesorería y bancos) y en nada más de negocio.
--
-- Va en su propia migración porque Postgres no deja usar un valor nuevo de un
-- enum en la misma transacción en que se añade. Después va
-- 202609290012_pagos_solo_administracion.sql.

alter type public.app_role add value if not exists 'accounting';
