-- Storage may evaluate INSERT permissions before attaching owner_id. The Storage
-- API derives the actual owner from the verified JWT, while RLS checks scope.
create or replace function check_app_private.photo_access(p_bucket text,p_name text,p_owner text,p_operation text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_deleting timestamptz; v_company uuid;
begin
  select company_id into v_company from public.profiles where id=auth.uid();
  if v_company is null then return false; end if;
  if p_operation='insert' then
    select deletion_requested_at into v_deleting from public.companies where id=v_company for share;
  else
    select deletion_requested_at into v_deleting from public.companies where id=v_company;
  end if;
  if not found or v_deleting is not null then return false; end if;
  return check_app_private.photo_access_active_company(p_bucket,p_name,
    case when p_operation='insert' then auth.uid()::text else p_owner end,p_operation);
end $$;
revoke all on function check_app_private.photo_access(text,text,text,text) from public,anon;
grant execute on function check_app_private.photo_access(text,text,text,text) to authenticated;
