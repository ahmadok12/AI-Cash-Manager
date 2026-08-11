-- Run once in Supabase Dashboard → SQL Editor.
create table if not exists public.cashbook_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  transactions jsonb not null default '[]'::jsonb,
  closings jsonb not null default '[]'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  spreadsheet_id text,
  updated_at timestamptz not null default now()
);

alter table public.cashbook_state enable row level security;

drop policy if exists "Users read their own cashbook" on public.cashbook_state;
create policy "Users read their own cashbook"
on public.cashbook_state for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create their own cashbook" on public.cashbook_state;
create policy "Users create their own cashbook"
on public.cashbook_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own cashbook" on public.cashbook_state;
create policy "Users update their own cashbook"
on public.cashbook_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their own cashbook" on public.cashbook_state;
create policy "Users delete their own cashbook"
on public.cashbook_state for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.cashbook_state from anon;
grant select, insert, update, delete on table public.cashbook_state to authenticated;
