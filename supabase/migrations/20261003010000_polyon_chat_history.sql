-- Durable POLYON chat history for serverless deployments.
create table if not exists private.polyon_chat_history (
  conversation_id text primary key,
  payload text not null check (octet_length(payload) <= 2000000),
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists polyon_chat_history_updated_at_idx
  on private.polyon_chat_history (updated_at desc);

create or replace function public.polyon_chat_history_upsert(
  p_conversation_id text, p_payload text, p_created_at timestamptz default null, p_updated_at timestamptz default null
)
returns table (conversation_id text, payload text, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if length(trim(p_conversation_id)) = 0 or length(p_conversation_id) > 200 then raise exception 'Invalid conversation id'; end if;
  if p_payload is null or octet_length(p_payload) > 2000000 then raise exception 'Invalid chat history payload'; end if;
  insert into private.polyon_chat_history(conversation_id,payload,created_at,updated_at)
  values(trim(p_conversation_id),p_payload,coalesce(p_created_at,now()),coalesce(p_updated_at,now()))
  on conflict (conversation_id) do update set
    payload=excluded.payload, created_at=private.polyon_chat_history.created_at, updated_at=excluded.updated_at;
  return query select h.conversation_id,h.payload,h.created_at,h.updated_at
    from private.polyon_chat_history h where h.conversation_id=trim(p_conversation_id);
end;
$$;

create or replace function public.polyon_chat_history_get(p_conversation_id text)
returns table (conversation_id text,payload text,created_at timestamptz,updated_at timestamptz)
language sql security definer set search_path = ''
as $$
  select h.conversation_id,h.payload,h.created_at,h.updated_at
  from private.polyon_chat_history h where h.conversation_id=trim(p_conversation_id) limit 1;
$$;

create or replace function public.polyon_chat_history_list(p_limit integer default 50)
returns table (conversation_id text,payload text,created_at timestamptz,updated_at timestamptz)
language sql security definer set search_path = ''
as $$
  select h.conversation_id,h.payload,h.created_at,h.updated_at
  from private.polyon_chat_history h order by h.updated_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;

revoke all on table private.polyon_chat_history from public,anon,authenticated;
revoke execute on function public.polyon_chat_history_upsert(text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke execute on function public.polyon_chat_history_get(text) from public,anon,authenticated;
revoke execute on function public.polyon_chat_history_list(integer) from public,anon,authenticated;
grant execute on function public.polyon_chat_history_upsert(text,text,timestamptz,timestamptz) to anon;
grant execute on function public.polyon_chat_history_get(text) to anon;
grant execute on function public.polyon_chat_history_list(integer) to anon;
