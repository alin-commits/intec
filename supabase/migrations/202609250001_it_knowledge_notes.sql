-- IT knowledge base ("Notas" tab inside Tickets): how-to guides, manuals and
-- procedures for solving recurring IT problems. The body is a list of blocks
-- (heading, text, steps, checklist, table, code) stored as JSON; manuals and
-- other files hang off each note in a private bucket.
-- Same access as tickets: admin/it manage, direction can read.

create table if not exists public.it_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 200),
  category text not null default 'solution'
    check (category in ('solution', 'manual', 'procedure', 'reference', 'other')),
  content jsonb not null default '[]'::jsonb
    check (jsonb_typeof(content) = 'array' and octet_length(content::text) <= 500000),
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists it_notes_updated_at_idx on public.it_notes (updated_at);
create index if not exists it_notes_created_by_idx on public.it_notes (created_by);
create index if not exists it_notes_updated_by_idx on public.it_notes (updated_by);

drop trigger if exists it_notes_set_updated_at on public.it_notes;
create trigger it_notes_set_updated_at before update on public.it_notes
for each row execute function public.set_updated_at();

create table if not exists public.it_note_files (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.it_notes(id) on delete cascade,
  path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  size_bytes bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists it_note_files_note_id_idx on public.it_note_files (note_id);
create index if not exists it_note_files_created_by_idx on public.it_note_files (created_by);

alter table public.it_notes enable row level security;
alter table public.it_note_files enable row level security;

drop policy if exists it_notes_read on public.it_notes;
create policy it_notes_read on public.it_notes
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it','direction']::app_role[]));

drop policy if exists it_notes_insert on public.it_notes;
create policy it_notes_insert on public.it_notes
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

drop policy if exists it_notes_update on public.it_notes;
create policy it_notes_update on public.it_notes
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

drop policy if exists it_notes_delete on public.it_notes;
create policy it_notes_delete on public.it_notes
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

drop policy if exists it_note_files_read on public.it_note_files;
create policy it_note_files_read on public.it_note_files
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it','direction']::app_role[]));

drop policy if exists it_note_files_insert on public.it_note_files;
create policy it_note_files_insert on public.it_note_files
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

drop policy if exists it_note_files_delete on public.it_note_files;
create policy it_note_files_delete on public.it_note_files
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

-- Private bucket for manuals and attachments (max 25 MB). Files are opened
-- through short-lived signed URLs, never public links.
insert into storage.buckets (id, name, public, file_size_limit)
values ('it-notes', 'it-notes', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists it_note_objects_read on storage.objects;
create policy it_note_objects_read on storage.objects
for select to authenticated
  using (bucket_id = 'it-notes' and public.current_user_has_any_role(ARRAY['admin','it','direction']::app_role[]));

drop policy if exists it_note_objects_insert on storage.objects;
create policy it_note_objects_insert on storage.objects
for insert to authenticated
  with check (bucket_id = 'it-notes' and public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

drop policy if exists it_note_objects_delete on storage.objects;
create policy it_note_objects_delete on storage.objects
for delete to authenticated
  using (bucket_id = 'it-notes' and public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));
