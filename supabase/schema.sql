-- Private storage for Deadline.
-- Run this in Supabase: SQL Editor → New query → paste → Run.
-- Safe to run again. It also locks down the old public setup.

create table if not exists public.app_state (
  id integer primary key check (id = 1),
  data jsonb not null default '{"deadlines": [], "notes": [], "deleted": {}}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_state (id)
values (1)
on conflict (id) do nothing;

-- Row level security ON with NO policies = the public anon/publishable key
-- can't read or write anything. Only the server (service role) can, and the
-- server only talks to browsers that know the passphrase.
alter table public.app_state enable row level security;

drop policy if exists "Anyone can read the shared tracker" on public.app_state;
drop policy if exists "Anyone can update the shared tracker" on public.app_state;

revoke all on public.app_state from anon, authenticated;

-- The app no longer uses Realtime (it would need public read access).
do $$
begin
  alter publication supabase_realtime drop table public.app_state;
exception when others then null;
end $$;
