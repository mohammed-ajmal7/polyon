-- The first Chat History implementation was reverted. Its old RPCs are unused.
-- Keep the private table inaccessible and remove public RPC execution privileges.
revoke all on table private.polyon_chat_history from public, anon, authenticated;
revoke execute on function public.polyon_chat_history_upsert(text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.polyon_chat_history_get(text) from public, anon, authenticated;
revoke execute on function public.polyon_chat_history_list(integer) from public, anon, authenticated;
