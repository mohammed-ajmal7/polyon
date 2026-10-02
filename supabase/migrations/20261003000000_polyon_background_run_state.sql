-- Durable POLYON run state for serverless execution.
-- The backing table is private; only the two narrowly scoped RPC functions are exposed.
-- The application stores execution results encrypted with POLYON_API_TOKEN.

create schema if not exists private;

create table if not exists private.polyon_background_runs (
  run_id text primary key,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  mode text not null,
  mode_reason text,
  started_at timestamptz not null,
  finished_at timestamptz,
  payload text,
  error text,
  updated_at timestamptz not null default now()
);

create index if not exists polyon_background_runs_updated_at_idx
  on private.polyon_background_runs (updated_at desc);

create or replace function public.polyon_run_upsert(
  p_run_id text,
  p_status text,
  p_mode text,
  p_mode_reason text default null,
  p_started_at timestamptz default null,
  p_finished_at timestamptz default null,
  p_payload text default null,
  p_error text default null
)
returns table (
  run_id text,
  status text,
  mode text,
  mode_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  payload text,
  error text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(trim(p_run_id)) = 0 or length(p_run_id) > 200 then
    raise exception 'Invalid run id';
  end if;

  if p_status not in ('running', 'succeeded', 'failed') then
    raise exception 'Invalid run status';
  end if;

  insert into private.polyon_background_runs (
    run_id, status, mode, mode_reason, started_at, finished_at, payload, error, updated_at
  )
  values (
    trim(p_run_id), p_status, p_mode, p_mode_reason,
    coalesce(p_started_at, now()), p_finished_at, p_payload, p_error, now()
  )
  on conflict on constraint polyon_background_runs_pkey do update set
    status = excluded.status,
    mode = excluded.mode,
    mode_reason = excluded.mode_reason,
    started_at = private.polyon_background_runs.started_at,
    finished_at = excluded.finished_at,
    payload = excluded.payload,
    error = excluded.error,
    updated_at = now();

  return query
    select r.run_id, r.status, r.mode, r.mode_reason, r.started_at,
           r.finished_at, r.payload, r.error, r.updated_at
      from private.polyon_background_runs r
     where r.run_id = trim(p_run_id);
end;
$$;

create or replace function public.polyon_run_get(p_run_id text)
returns table (
  run_id text,
  status text,
  mode text,
  mode_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  payload text,
  error text,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select r.run_id, r.status, r.mode, r.mode_reason, r.started_at,
         r.finished_at, r.payload, r.error, r.updated_at
    from private.polyon_background_runs r
   where r.run_id = trim(p_run_id)
   limit 1;
$$;

revoke all on table private.polyon_background_runs from public, anon, authenticated;
revoke execute on function public.polyon_run_upsert(text,text,text,text,timestamptz,timestamptz,text,text) from public, anon, authenticated;
revoke execute on function public.polyon_run_get(text) from public, anon, authenticated;

grant execute on function public.polyon_run_upsert(text,text,text,text,timestamptz,timestamptz,text,text) to anon;
grant execute on function public.polyon_run_get(text) to anon;
