-- Corrige dos avisos del linter de seguridad de Supabase (get_advisors)
-- detectados tras revisar el proyecto ya desplegado:
--
-- 1) "Function Search Path Mutable": set_updated_at, force_created_at y
--    prevent_self_role_change no fijaban search_path, lo que en teoría
--    permite que un search_path manipulado en la sesión altere a qué
--    objetos resuelven los nombres sin esquema dentro de la función.
-- 2) "Public/Authenticated Can Execute SECURITY DEFINER Function":
--    handle_new_user y capture_lead_status_change son funciones de
--    disparador (RETURNS TRIGGER) que solo deben ejecutarse desde su
--    trigger, nunca como llamada RPC directa; current_user_role solo
--    debe poder invocarse estando autenticado (lo necesitan las
--    políticas RLS), nunca de forma anónima.
--
-- Migración puramente aditiva: no modifica tablas ni políticas.

alter function public.set_updated_at() set search_path = public;
alter function public.force_created_at() set search_path = public;
alter function public.prevent_self_role_change() set search_path = public;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.capture_lead_status_change() from public, anon, authenticated;
revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;
