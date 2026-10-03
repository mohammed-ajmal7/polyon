-- Secure the chat RPCs that access the private conversation table.
-- SECURITY DEFINER is required because anon must not have direct table access.
-- The empty search_path prevents object-shadowing attacks.

create or replace function public.polyon_chat_conversation_upsert(
  p_conversation_id text,
  p_payload text,
  p_created_at timestamptz,
  p_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_conversation_id is null or length(pg_catalog.btrim(p_conversation_id)) = 0 then
    raise exception 'conversation id is required';
  end if;
  if pg_catalog.octet_length(coalesce(p_payload, '')) > 2000000 then
    raise exception 'conversation payload exceeds 2MB';
  end if;
  insert into private.polyon_chat_history (conversation_id, payload, created_at, updated_at)
  values (p_conversation_id, coalesce(p_payload, '{}'), p_created_at, p_updated_at)
  on conflict (conversation_id) do update
  set payload = excluded.payload, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.polyon_chat_conversation_get(p_conversation_id text)
returns table(conversation_id text, payload text, created_at timestamptz, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select h.conversation_id, h.payload, h.created_at, h.updated_at
  from private.polyon_chat_history h
  where h.conversation_id = p_conversation_id
  limit 1;
$$;

create or replace function public.polyon_chat_conversation_list(p_limit integer default 50)
returns table(conversation_id text, payload text, created_at timestamptz, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select h.conversation_id, h.payload, h.created_at, h.updated_at
  from private.polyon_chat_history h
  order by h.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke execute on function public.polyon_chat_conversation_upsert(text,text,timestamptz,timestamptz) from public, authenticated;
revoke execute on function public.polyon_chat_conversation_get(text) from public, authenticated;
revoke execute on function public.polyon_chat_conversation_list(integer) from public, authenticated;
grant execute on function public.polyon_chat_conversation_upsert(text,text,timestamptz,timestamptz) to anon;
grant execute on function public.polyon_chat_conversation_get(text) to anon;
grant execute on function public.polyon_chat_conversation_list(integer) to anon;
