-- Fase operativa: usuarios y soporte para gestión desde la plataforma.

alter table public.profiles add column if not exists email text;

update public.profiles as profiles
set email = users.email
from auth.users as users
where profiles.id = users.id and profiles.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      email = excluded.email;
  return new;
end;
$$;

create index if not exists profiles_role_active_idx on public.profiles(role, is_active);
create index if not exists leads_updated_at_idx on public.leads(updated_at desc);
create index if not exists inquiries_created_by_created_at_idx on public.inquiries(created_by, created_at desc);
