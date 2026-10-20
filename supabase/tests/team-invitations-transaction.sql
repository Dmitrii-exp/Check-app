-- All fixtures and writes are rolled back. Run as the database owner.
begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
create temporary table check_security_fixture(k text primary key,id uuid not null default gen_random_uuid());
insert into check_security_fixture(k) select unnest(array['company','foreign_company','department','frozen_department','foreign_department',
  'manager','responsible','employee','other_employee','foreign_manager','new_owner','new_joiner',
  'equipment','equipment2','frozen_equipment','foreign_equipment','action','action2','task','other_task','blocked_task','old_task','old_report']);
create function pg_temp.fixture(p_key text) returns uuid language sql security definer as
  'select id from pg_temp.check_security_fixture where k=p_key';
grant select on check_security_fixture to authenticated;
create function pg_temp.assert_true(p_value boolean,p_message text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'FAILED: %',p_message; end if; end $$;
create function pg_temp.expect_denied(p_sql text) returns void language plpgsql as $$
declare n integer;
begin
  begin
    execute p_sql;
    get diagnostics n=row_count;
    if n<>0 then raise exception 'FAILED: prohibited write succeeded: %',p_sql; end if;
  exception when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm <> 'SUPER ADMIN access required' then raise; end if;
  end;
end $$;
insert into auth.users(id,aud,role,email) select id,'authenticated','authenticated',id::text||'@check-test.invalid'
  from check_security_fixture where k in ('manager','responsible','employee','other_employee','foreign_manager','new_owner','new_joiner');
insert into public.companies(id,name) values(pg_temp.fixture('company'),'TRANSACTION-ONLY SECURITY TEST'),(pg_temp.fixture('foreign_company'),'TRANSACTION-ONLY FOREIGN TEST');
insert into public.departments(id,company_id,name,invite_code,created_at) values
  (pg_temp.fixture('department'),pg_temp.fixture('company'),'Main',upper(pg_temp.fixture('department')::text),now()-interval '2 days'),
  (pg_temp.fixture('frozen_department'),pg_temp.fixture('company'),'Frozen',upper(pg_temp.fixture('frozen_department')::text),now()-interval '1 day'),
  (pg_temp.fixture('foreign_department'),pg_temp.fixture('foreign_company'),'Foreign',upper(pg_temp.fixture('foreign_department')::text),now());
insert into public.profiles(id,company_id,department_id,name,role) values
  (pg_temp.fixture('manager'),pg_temp.fixture('company'),null,'Owner','manager'),
  (pg_temp.fixture('responsible'),pg_temp.fixture('company'),pg_temp.fixture('department'),'Lead','responsible'),
  (pg_temp.fixture('employee'),pg_temp.fixture('company'),pg_temp.fixture('department'),'Worker','employee'),
  (pg_temp.fixture('other_employee'),pg_temp.fixture('company'),pg_temp.fixture('department'),'Other worker','employee'),
  (pg_temp.fixture('foreign_manager'),pg_temp.fixture('foreign_company'),null,'Foreign owner','manager');
insert into public.subscriptions(company_id,plan_id) values(pg_temp.fixture('company'),'free'),(pg_temp.fixture('foreign_company'),'free');
insert into public.equipment(id,company_id,department_id,name,created_at) values
  (pg_temp.fixture('equipment'),pg_temp.fixture('company'),pg_temp.fixture('department'),'Machine',now()-interval '6 days'),
  (pg_temp.fixture('equipment2'),pg_temp.fixture('company'),pg_temp.fixture('department'),'Machine 2',now()-interval '5 days'),
  (gen_random_uuid(),pg_temp.fixture('company'),pg_temp.fixture('department'),'Machine 3',now()-interval '4 days'),
  (gen_random_uuid(),pg_temp.fixture('company'),pg_temp.fixture('department'),'Machine 4',now()-interval '3 days'),
  (gen_random_uuid(),pg_temp.fixture('company'),pg_temp.fixture('department'),'Machine 5',now()-interval '2 days'),
  (pg_temp.fixture('frozen_equipment'),pg_temp.fixture('company'),pg_temp.fixture('department'),'Machine 6',now()-interval '1 day'),
  (pg_temp.fixture('foreign_equipment'),pg_temp.fixture('foreign_company'),pg_temp.fixture('foreign_department'),'Foreign machine',now());
insert into public.maintenance_actions(id,company_id,department_id,equipment_id,name,frequency) values
  (pg_temp.fixture('action'),pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment'),'Maintenance',7),
  (pg_temp.fixture('action2'),pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment2'),'Due maintenance',7);
insert into public.tasks(id,company_id,department_id,equipment_id,action_id,date,title,status,assigned_user_id) values
  (pg_temp.fixture('task'),pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment'),pg_temp.fixture('action'),current_date,'Maintenance','pending',null),
  (pg_temp.fixture('other_task'),pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment'),pg_temp.fixture('action'),current_date,'Assigned','pending',pg_temp.fixture('other_employee')),
  (pg_temp.fixture('blocked_task'),pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment'),pg_temp.fixture('action'),current_date,'Pending','pending',null),
  (pg_temp.fixture('old_task'),pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment'),pg_temp.fixture('action'),current_date-10,'Previous','done',null);
insert into public.completions(id,company_id,department_id,task_id,equipment_id,action_id,user_id,title,date,worker_name)
  values(pg_temp.fixture('old_report'),pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('old_task'),pg_temp.fixture('equipment'),pg_temp.fixture('action'),pg_temp.fixture('other_employee'),'Previous',current_date-10,'Other worker');


-- Confirmed recipient identity and metadata-only drafts.
update auth.users set email_confirmed_at=now() where id=pg_temp.fixture('new_joiner');
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('manager'),'role','service_role')::text,true);
create temporary table invite_result as select public.company_invitation_admin(pg_temp.fixture('manager'),'create',pg_temp.fixture('new_joiner')::text||'@check-test.invalid',pg_temp.fixture('department')) j;
select pg_temp.assert_true(not (j ? 'token_hash') and not (j ? 'token'),'Draft discloses no capability') from invite_result;
select public.company_invitation_admin(pg_temp.fixture('manager'),'send',null,null,(select (j->>'id')::uuid from invite_result),repeat('a',64));
select public.resolve_company_invitation(repeat('a',64));
select public.accept_company_email_invitation(pg_temp.fixture('new_joiner'),repeat('a',64),'Invited worker');
select pg_temp.assert_true((select role='employee' and department_id=pg_temp.fixture('department') from public.profiles where id=pg_temp.fixture('new_joiner')),'Invited user always starts as employee');
do $$begin
 begin perform public.accept_company_email_invitation(pg_temp.fixture('new_joiner'),repeat('a',64),'Again');raise exception 'FAILED: token reused';
 exception when invalid_parameter_value then null; end;
end$$;
select pg_temp.assert_true(not has_function_privilege('authenticated','public.company_invitation_admin(uuid,text,text,uuid,uuid,text,boolean)','execute'),'Invitation admin is server-only');
select pg_temp.assert_true(not has_function_privilege('anon','public.resolve_company_invitation(text)','execute'),'Recipient resolver is server-only');
select pg_temp.assert_true(not has_table_privilege('authenticated','check_app_private.company_invitations','select'),'Invitation hashes are private');
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('employee'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.expect_denied($q$select public.set_company_member_role(auth.uid(),'manager',null)$q$);
select pg_temp.expect_denied($q$delete from public.companies where id=pg_temp.fixture('company')$q$);
select pg_temp.expect_denied($q$update public.equipment set name='forged' where id=pg_temp.fixture('equipment')$q$);
select pg_temp.expect_denied($q$insert into public.maintenance_actions(company_id,department_id,equipment_id,name,frequency) values(pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment'),'forged',7)$q$);
insert into public.consumable_requests(company_id,department_id,created_by,item_name,quantity,unit) values(pg_temp.fixture('company'),pg_temp.fixture('department'),auth.uid(),'Allowed request',1,'шт.');
select pg_temp.expect_denied($q$update public.consumable_requests set item_name='changed' where created_by=auth.uid()$q$);
reset role;
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('responsible'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.subscriptions),'Lead cannot read billing');
select pg_temp.expect_denied($q$select public.set_company_member_role(pg_temp.fixture('employee'),'responsible',pg_temp.fixture('department'))$q$);
select pg_temp.expect_denied($q$delete from public.companies where id=pg_temp.fixture('company')$q$);
select pg_temp.expect_denied($q$insert into public.maintenance_actions(company_id,department_id,equipment_id,name,frequency) values(pg_temp.fixture('foreign_company'),pg_temp.fixture('foreign_department'),pg_temp.fixture('foreign_equipment'),'forged',7)$q$);
insert into public.maintenance_actions(company_id,department_id,equipment_id,name,frequency) values(pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment'),'Allowed rule',7);
reset role;
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('manager'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.expect_denied($q$select public.set_company_member_role(auth.uid(),'employee',pg_temp.fixture('department'))$q$);
select public.set_company_member_role(pg_temp.fixture('employee'),'manager',null);
select pg_temp.assert_true((select role='manager' from public.profiles where id=pg_temp.fixture('employee')),'Owner can appoint network manager');
select public.set_company_member_role(pg_temp.fixture('employee'),'responsible',pg_temp.fixture('department'));
select pg_temp.assert_true((select role='employee' from public.profiles where id=pg_temp.fixture('responsible')),'Previous department lead demoted');
select public.set_company_member_role(pg_temp.fixture('employee'),'employee',pg_temp.fixture('department'));
select pg_temp.expect_denied($q$select public.set_company_member_role(pg_temp.fixture('foreign_manager'),'manager',null)$q$);
reset role;
select 'PASS: email capability privacy and one-time use, default employee, 3-role assignment, last owner, staff billing isolation, employee consumables and protected writes' as result;
rollback;
