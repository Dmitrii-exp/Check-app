begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create temporary table deletion_fixture as select gen_random_uuid() company_id,gen_random_uuid() other_company,
  gen_random_uuid() owner_id,gen_random_uuid() employee_id,gen_random_uuid() other_owner,gen_random_uuid() department_id;
insert into auth.users(id,aud,role,email)
  select id,'authenticated','authenticated',id::text||'@check-delete-test.invalid' from deletion_fixture,
  lateral unnest(array[owner_id,employee_id,other_owner]) id;
insert into public.companies(id,name) select company_id,'ROLLBACK DELETE TEST' from deletion_fixture union all select other_company,'ROLLBACK SENTINEL' from deletion_fixture;
insert into public.profiles(id,company_id,name,role) select owner_id,company_id,'Owner','manager' from deletion_fixture
  union all select employee_id,company_id,'Worker','employee' from deletion_fixture
  union all select other_owner,other_company,'Sentinel','manager' from deletion_fixture;
insert into public.departments(id,company_id,name,invite_code) select department_id,company_id,'Main',upper(department_id::text) from deletion_fixture;
update public.profiles set department_id=deletion_fixture.department_id from deletion_fixture where id=employee_id;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare f record; r jsonb; begin
  select * into f from deletion_fixture;
  begin perform public.begin_company_deletion(f.employee_id,f.company_id,'УДАЛИТЬ'); raise exception 'Employee deletion was accepted'; exception when insufficient_privilege then null; end;
  begin perform public.begin_company_deletion(f.other_owner,f.company_id,'УДАЛИТЬ'); raise exception 'Foreign owner deletion was accepted'; exception when insufficient_privilege then null; end;
  begin perform public.begin_company_deletion(f.owner_id,f.company_id,'удалить'); raise exception 'Wrong confirmation accepted'; exception when invalid_parameter_value then null; end;
  r:=public.begin_company_deletion(f.owner_id,f.company_id,'УДАЛИТЬ');
  if r->>'pending'<>'true' then raise exception 'Freeze not started'; end if;
  r:=public.begin_company_deletion(f.owner_id,f.company_id,'УДАЛИТЬ');
  if r->>'pending'<>'true' then raise exception 'Retry not idempotent'; end if;
  if not exists(select 1 from public.companies where id=f.other_company and deletion_requested_at is null) then raise exception 'Other company changed'; end if;
  if has_function_privilege('authenticated','public.begin_company_deletion(uuid,uuid,text)','execute') or
    has_function_privilege('authenticated','public.company_deletion_batch(uuid,uuid)','execute') then raise exception 'Deletion RPC exposed'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true) from deletion_fixture;
set local role authenticated;
do $$ begin
  if public.current_company_id() is not null or public.current_role() is not null then raise exception 'Deletion did not revoke access'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
savepoint photo_fixture;
insert into storage.objects(bucket_id,name) select 'equipment-photos',company_id::text||'/fixture.jpg' from deletion_fixture;
do $$ declare f record; r jsonb; begin
  select * into f from deletion_fixture;
  r:=public.company_deletion_batch(f.owner_id,f.company_id);
  if r->>'phase'<>'photos' or not exists(select 1 from public.companies where id=f.company_id) then raise exception 'Database deleted before photo cleanup'; end if;
end $$;
rollback to savepoint photo_fixture;
do $$ declare f record; r jsonb; begin
  select * into f from deletion_fixture;
  r:=public.company_deletion_batch(f.owner_id,f.company_id);
  if r->>'phase'<>'accounts' or (r->>'final')::boolean or r->'users'<>jsonb_build_array(f.employee_id) then raise exception 'Incorrect cleanup order'; end if;
  if exists(select 1 from public.companies where id=f.company_id) or exists(select 1 from public.profiles where company_id=f.company_id) then raise exception 'Company data not removed'; end if;
  delete from auth.users where id=f.employee_id;
  r:=public.company_deletion_batch(f.owner_id,f.company_id);
  if not (r->>'final')::boolean or r->'users'<>jsonb_build_array(f.owner_id) then raise exception 'Owner not last'; end if;
  delete from auth.users where id=f.owner_id;
  if exists(select 1 from check_app_private.company_deletions where company_id=f.company_id) then raise exception 'Deletion snapshot retained'; end if;
  if not exists(select 1 from public.profiles where id=f.other_owner and company_id=f.other_company) then raise exception 'Other tenant affected'; end if;
end $$;
select 'PASS: typed confirmation, owner authorization, tenant isolation, access freeze, photos-before-data, owner-last, retry and job cleanup' as result;
rollback;
