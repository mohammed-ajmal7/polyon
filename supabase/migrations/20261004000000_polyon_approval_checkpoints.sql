create table if not exists private.polyon_approval_checkpoints (
  approval_id text primary key,
  status text not null,
  payload text not null,
  updated_at timestamptz not null default now()
);

create index if not exists polyon_approval_checkpoints_status_updated_idx
  on private.polyon_approval_checkpoints (status, updated_at desc);

revoke all on private.polyon_approval_checkpoints from public, anon, authenticated;

create or replace function public.polyon_approval_checkpoint_upsert(
  p_approval_id text,
  p_status text,
  p_payload text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_approval_id is null or length(pg_catalog.btrim(p_approval_id)) = 0 then
    raise exception 'approval id is required';
  end if;
  if p_status is null or p_status not in ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED') then
    raise exception 'invalid approval status';
  end if;
  if pg_catalog.octet_length(coalesce(p_payload, '')) > 4000000 then
    raise exception 'approval checkpoint exceeds 4MB';
  end if;
  insert into private.polyon_approval_checkpoints (approval_id, status, payload, updated_at)
  values (p_approval_id, p_status, coalesce(p_payload, '{}'), now())
  on conflict (approval_id) do update
  set status = excluded.status, payload = excluded.payload, updated_at = now();
end;
$$;

create or replace function public.polyon_approval_checkpoint_get(p_approval_id text)
returns table(approval_id text, status text, payload text, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.approval_id, c.status, c.payload, c.updated_at
  from private.polyon_approval_checkpoints c
  where c.approval_id = p_approval_id limit 1;
$$;

create or replace function public.polyon_approval_checkpoint_list(p_limit integer default 100)
returns table(approval_id text, status text, payload text, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.approval_id, c.status, c.payload, c.updated_at
  from private.polyon_approval_checkpoints c
  where c.status = 'PENDING'
  order by c.updated_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke execute on function public.polyon_approval_checkpoint_upsert(text,text,text) from public, authenticated;
revoke execute on function public.polyon_approval_checkpoint_get(text) from public, authenticated;
revoke execute on function public.polyon_approval_checkpoint_list(integer) from public, authenticated;
grant execute on function public.polyon_approval_checkpoint_upsert(text,text,text) to anon;
grant execute on function public.polyon_approval_checkpoint_get(text) to anon;
grant execute on function public.polyon_approval_checkpoint_list(integer) to anon;