-- Expose a bounded, read-only list of durable POLYON runs for Chat History.
create or replace function public.polyon_run_list(p_limit integer default 50)
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
   order by r.updated_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke execute on function public.polyon_run_list(integer) from public, anon, authenticated;
grant execute on function public.polyon_run_list(integer) to anon;
