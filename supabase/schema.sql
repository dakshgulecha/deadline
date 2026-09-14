-- Shared state for the single public tracker URL.
-- Run this once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.app_state (
  id integer primary key check (id = 1),
  data jsonb not null default '{"deadlines": [], "notes": [], "selectedNoteId": null}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_state (id)
values (1)
on conflict (id) do nothing;

alter table public.app_state enable row level security;

grant select, update on public.app_state to anon;

drop policy if exists "Anyone can read the shared tracker" on public.app_state;
create policy "Anyone can read the shared tracker"
on public.app_state for select
to anon
using (true);

drop policy if exists "Anyone can update the shared tracker" on public.app_state;
create policy "Anyone can update the shared tracker"
on public.app_state for update
to anon
using (true)
with check (true);

-- Optional but useful for immediate refreshes in connected browsers.
alter publication supabase_realtime add table public.app_state;
