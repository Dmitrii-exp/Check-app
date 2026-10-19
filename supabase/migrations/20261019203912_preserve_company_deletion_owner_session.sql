-- The owner must be able to continue a long-running deletion. Their Auth account
-- and all its sessions are removed last by the deletion handler.
do $$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.begin_company_deletion(uuid,uuid,text)'::regprocedure);
  if position('delete from auth.sessions where user_id=any(ids);' in definition)=0 then
    raise exception 'Unexpected deletion function definition';
  end if;
  execute replace(definition,'delete from auth.sessions where user_id=any(ids);',
    'delete from auth.sessions where user_id=any(ids) and user_id<>p_actor;');
end $$;
