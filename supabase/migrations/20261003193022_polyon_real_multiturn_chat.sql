-- Durable multi-turn chat payloads.
-- The application is the authorization boundary; the private table is only
-- reachable through these narrowly scoped RPCs.

create or replace function public.polyon_chat_conversation_upsert(
  p_conversation_id text,
  p_payload text,
  p_created_at timestamptz,
  p_updated_at timestamptz
)
returns void
language plpgsql
as $$
begin
  if p_conversation_id is null or length(trim(p_conversation_id)) = 0 then
    raise exception 'conversation id is required';
  end if;
  if octet_length(coalesce(p_payload, '')) > 2000000 then
    raise exception 'conversation payload exceeds 2MB';
  end if;

  insert into private.polyon_chat_history (
    conversation_id, payload, created_at, updated_at
  )
  values (p_conversation_id, coalesce(p_payload, '{}'), p_created_at, p_updated_at)
  on conflict (conversation_id) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at;
end;
$$;

create or replace function public.polyon_chat_conversation_get(p_conversation_id text)
returns table(
  conversation_id text,
  payload text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
as $$
  select h.conversation_id, h.payload, h.created_at, h.updated_at
  from private.polyon_chat_history h
  where h.conversation_id = p_conversation_id
  limit 1;
$$;

create or replace function public.polyon_chat_conversation_list(p_limit integer default 50)
returns table(
  conversation_id text,
  payload text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
as $$
  select h.conversation_id, h.payload, h.created_at, h.updated_at
  from private.polyon_chat_history h
  order by h.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on table private.polyon_chat_history from public, anon, authenticated;
revoke execute on function public.polyon_chat_history_upsert(text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.polyon_chat_history_get(text) from public, anon, authenticated;
revoke execute on function public.polyon_chat_history_list(integer) from public, anon, authenticated;
grant execute on function public.polyon_chat_conversation_upsert(text,text,timestamptz,timestamptz) to anon;
grant execute on function public.polyon_chat_conversation_get(text) to anon;
grant execute on function public.polyon_chat_conversation_list(integer) to anon;
