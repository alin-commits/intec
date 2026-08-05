-- Corrige el aviso de rendimiento "Auth RLS Initialization Plan" del
-- advisor de Supabase: envolver auth.uid() en (select auth.uid()) permite
-- que Postgres lo evalúe una vez por consulta en vez de una vez por fila.
-- Mismo comportamiento de acceso, mejor rendimiento a medida que crezcan
-- las tablas.

drop policy if exists inquiries_staff_insert on public.inquiries;
create policy inquiries_staff_insert on public.inquiries
for insert to authenticated with check (
  public.current_user_role() in ('admin', 'commercial') and created_by = (select auth.uid())
);

drop policy if exists inquiries_recent_undo_or_admin on public.inquiries;
create policy inquiries_recent_undo_or_admin on public.inquiries
for delete to authenticated using (
  public.current_user_role() = 'admin'
  or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes')
);

drop policy if exists campaigns_admin_insert on public.campaigns;
create policy campaigns_admin_insert on public.campaigns
for insert to authenticated with check (public.current_user_role() = 'admin' and created_by = (select auth.uid()));

drop policy if exists leads_staff_insert on public.leads;
create policy leads_staff_insert on public.leads
for insert to authenticated with check (
  public.current_user_role() in ('admin', 'commercial') and created_by = (select auth.uid())
);
