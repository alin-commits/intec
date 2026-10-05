-- Un tipo más de ausencia: la que no está justificada.
--
-- El cuadrante ya distingue vacaciones, baja y permiso, que son ausencias con
-- papel detrás. Faltaba la otra: el día que alguien no vino y todavía no ha
-- traído justificante. Es la que de verdad hay que mirar a fin de mes, así que
-- tiene su propia lista en la pantalla.
--
-- Va en su propia migración porque Postgres no deja usar un valor nuevo de un
-- enum en la misma transacción en que se añade.

alter type public.staff_exception_kind add value if not exists 'no_justificada';
