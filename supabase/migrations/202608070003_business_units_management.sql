-- Lets admins fully manage business units: create, edit (name/color/logo/
-- active), and delete. Deleting was never actually possible before — there
-- was no DELETE policy on business_units at all.

create policy business_units_admin_delete on public.business_units
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin']::app_role[]));

-- Public bucket: unit logos are brand marks shown on every page, not
-- sensitive, and this keeps UnitBrandMark's plain <Image src> working
-- unchanged via the public storage URL (no signed URLs needed).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-unit-logos', 'business-unit-logos', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy business_unit_logos_public_select on storage.objects
for select to public
  using (bucket_id = 'business-unit-logos');

create policy business_unit_logos_admin_insert on storage.objects
for insert to authenticated
  with check (bucket_id = 'business-unit-logos' and public.current_user_has_any_role(ARRAY['admin']::app_role[]));

create policy business_unit_logos_admin_update on storage.objects
for update to authenticated
  using (bucket_id = 'business-unit-logos' and public.current_user_has_any_role(ARRAY['admin']::app_role[]))
  with check (bucket_id = 'business-unit-logos' and public.current_user_has_any_role(ARRAY['admin']::app_role[]));

create policy business_unit_logos_admin_delete on storage.objects
for delete to authenticated
  using (bucket_id = 'business-unit-logos' and public.current_user_has_any_role(ARRAY['admin']::app_role[]));
