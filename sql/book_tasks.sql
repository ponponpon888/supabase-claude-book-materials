begin;

create table public.book_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  summary text not null check (char_length(summary) between 1 and 500),
  status text not null default 'open'
    check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);

create index book_tasks_owner_idx on public.book_tasks (owner_id);

alter table public.book_tasks enable row level security;
revoke all on table public.book_tasks from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, delete on table public.book_tasks to authenticated;
grant insert (owner_id, summary, status)
  on table public.book_tasks to authenticated;
grant update (summary, status)
  on table public.book_tasks to authenticated;

create policy book_tasks_read_own
  on public.book_tasks for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy book_tasks_create_own
  on public.book_tasks for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy book_tasks_update_own
  on public.book_tasks for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy book_tasks_delete_own
  on public.book_tasks for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;
