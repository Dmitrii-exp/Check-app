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

select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('employee'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.assert_true(public.current_role()='employee','Employee fixture context');
select pg_temp.assert_true((select count(*)=0 from public.profiles where company_id=pg_temp.fixture('foreign_company')),'Cross-company profiles hidden');
select pg_temp.assert_true((select count(*)=0 from public.equipment where company_id=pg_temp.fixture('foreign_company')),'Cross-company equipment hidden');
select pg_temp.assert_true((select count(*)=1 from public.subscriptions where company_id=pg_temp.fixture('company')),'Worker can restore actual subscription');
select pg_temp.expect_denied($q$update public.profiles set role='manager' where id=pg_temp.fixture('employee')$q$);
select pg_temp.expect_denied($q$update public.subscriptions set plan_id='ultra' where company_id=pg_temp.fixture('company')$q$);
select pg_temp.expect_denied($q$insert into public.super_admins(user_id) values(auth.uid())$q$);
select pg_temp.expect_denied($q$select public.grant_unlimited_company(pg_temp.fixture('company'),'forged')$q$);
select pg_temp.expect_denied($q$delete from public.equipment where id=pg_temp.fixture('equipment')$q$);
select pg_temp.expect_denied($q$delete from public.tasks where id=pg_temp.fixture('task')$q$);
select pg_temp.expect_denied($q$delete from public.completions where id=pg_temp.fixture('old_report')$q$);
select pg_temp.expect_denied($q$update public.completions set comment='rewritten' where id=pg_temp.fixture('old_report')$q$);
select pg_temp.expect_denied($q$update public.tasks set title='forged' where id=pg_temp.fixture('task')$q$);
select pg_temp.expect_denied($q$update public.tasks set status='done' where id=pg_temp.fixture('task')$q$);
select pg_temp.expect_denied($q$update public.tasks set status='blocked',blocked_comment='Reason',blocked_worker_name='Worker' where id=pg_temp.fixture('other_task')$q$);
select pg_temp.expect_denied($q$insert into public.tasks(company_id,department_id,date,title) values(pg_temp.fixture('company'),pg_temp.fixture('department'),current_date,'forged')$q$);
select pg_temp.expect_denied($q$insert into public.completions(company_id,department_id,task_id,equipment_id,action_id,user_id,title,date,worker_name)
  values(pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('task'),pg_temp.fixture('equipment'),pg_temp.fixture('action'),auth.uid(),'Maintenance',current_date,'Worker')$q$);
insert into public.tasks(company_id,department_id,equipment_id,action_id,date,title)
  values(pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment2'),pg_temp.fixture('action2'),current_date,'Due maintenance');
select pg_temp.expect_denied($q$insert into public.tasks(company_id,department_id,equipment_id,action_id,date,title)
  values(pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('equipment2'),pg_temp.fixture('action2'),current_date,'Due maintenance')$q$);
update public.tasks set status='blocked',blocked_comment='Reason',blocked_worker_name='Worker',blocked_at=now() where id=pg_temp.fixture('blocked_task');
insert into storage.objects(bucket_id,name,owner_id) values('equipment-photos',pg_temp.fixture('company')||'/'||pg_temp.fixture('department')||'/'||pg_temp.fixture('task')||'/fixture.jpg',auth.uid()::text);
insert into public.completions(company_id,department_id,task_id,equipment_id,action_id,user_id,title,date,worker_name,photo_path)
  values(pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('task'),pg_temp.fixture('equipment'),pg_temp.fixture('action'),auth.uid(),'Maintenance',current_date,'Worker',pg_temp.fixture('company')||'/'||pg_temp.fixture('department')||'/'||pg_temp.fixture('task')||'/fixture.jpg');
update public.tasks set status='done' where id=pg_temp.fixture('task');
select pg_temp.assert_true((select status='done' from public.tasks where id=pg_temp.fixture('task')),'Photo report and completion remain working');
select pg_temp.assert_true(not check_app_private.photo_access('equipment-photos',pg_temp.fixture('company')||'/'||pg_temp.fixture('department')||'/'||pg_temp.fixture('task')||'/fixture.jpg',auth.uid()::text,'delete'),'Worker cannot delete submitted report photo');
select pg_temp.assert_true(not check_app_private.photo_access('equipment-photos',pg_temp.fixture('foreign_company')||'/x.jpg',auth.uid()::text,'read'),'Foreign company photos hidden');
select pg_temp.expect_denied($q$insert into storage.objects(bucket_id,name,owner_id) values('equipment-photos',pg_temp.fixture('company')||'/'||pg_temp.fixture('equipment')||'/forged.jpg',auth.uid()::text)$q$);

reset role;
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('responsible'),'role','authenticated')::text,true);
set local role authenticated;
update public.equipment set name='Allowed lead edit' where id=pg_temp.fixture('equipment');
select pg_temp.assert_true((select name='Allowed lead edit' from public.equipment where id=pg_temp.fixture('equipment')),'Department lead can manage equipment');
select pg_temp.expect_denied($q$update public.equipment set name='frozen change' where id=pg_temp.fixture('frozen_equipment')$q$);
select pg_temp.expect_denied($q$insert into public.equipment(company_id,department_id,name) values(pg_temp.fixture('company'),pg_temp.fixture('department'),'over quota')$q$);
select pg_temp.expect_denied($q$insert into public.one_time_tasks(company_id,department_id,assigned_user_id,created_by,description,due_date)
  values(pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('foreign_manager'),auth.uid(),'forged',current_date)$q$);
insert into public.one_time_tasks(company_id,department_id,assigned_user_id,created_by,description,due_date)
  values(pg_temp.fixture('company'),pg_temp.fixture('department'),pg_temp.fixture('employee'),auth.uid(),'Allowed assignment',current_date);

reset role;
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('manager'),'role','authenticated')::text,true);
set local role authenticated;
update public.profiles set role='responsible' where id=pg_temp.fixture('other_employee');
select pg_temp.assert_true((select role='responsible' from public.profiles where id=pg_temp.fixture('other_employee')),'Owner can appoint department lead');
select pg_temp.expect_denied($q$update public.profiles set role='manager' where id=pg_temp.fixture('employee')$q$);
select pg_temp.expect_denied($q$insert into public.profiles(id,company_id,name,role) values(pg_temp.fixture('employee'),pg_temp.fixture('company'),'forged','manager') on conflict(id) do update set role=excluded.role$q$);
select pg_temp.expect_denied($q$delete from public.profiles where id=auth.uid()$q$);
select pg_temp.expect_denied($q$update public.profiles set company_id=pg_temp.fixture('foreign_company') where id=auth.uid()$q$);
select pg_temp.expect_denied($q$update public.equipment set created_at=now()-interval '100 days' where id=pg_temp.fixture('frozen_equipment')$q$);
select pg_temp.expect_denied($q$update public.departments set name='frozen change' where id=pg_temp.fixture('frozen_department')$q$);
insert into public.equipment(id,company_id,department_id,name) select id,company_id,department_id,name from public.equipment where id=pg_temp.fixture('frozen_equipment')
  on conflict(id) do update set name=excluded.name;
insert into public.profiles(id,company_id,department_id,name,phone,role) select id,company_id,department_id,name,phone,role from public.profiles where company_id=pg_temp.fixture('company')
  on conflict(id) do update set name=excluded.name,phone=excluded.phone,role=excluded.role,department_id=excluded.department_id;
update public.completions set comment='Allowed owner correction' where id=pg_temp.fixture('old_report');
select pg_temp.assert_true((select comment='Allowed owner correction' from public.completions where id=pg_temp.fixture('old_report')),'Owner can correct report');

reset role;
update public.subscriptions set plan_id='lite',expires_at=now()-interval '1 day' where company_id=pg_temp.fixture('company');
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('employee'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.expect_denied($q$update public.tasks set blocked_comment='expired change' where id=pg_temp.fixture('blocked_task')$q$);
select pg_temp.assert_true((select count(*)>0 from public.completions),'Expired company retains read-only history');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('new_owner'),'role','authenticated')::text,true);
set local role authenticated;
select public.bootstrap_company('TRANSACTION-ONLY NEW COMPANY','Main',pg_temp.fixture('new_owner')::text,'New owner','');
select pg_temp.assert_true(public.current_role()='manager','Registration still creates company owner');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.fixture('new_joiner'),'role','authenticated')::text,true);
set local role authenticated;
select public.join_company_by_invite(pg_temp.fixture('department')::text,'New worker','');
select pg_temp.assert_true(public.current_role()='employee','Invitation still creates worker');
reset role;
select 'PASS: role escalation, company isolation, quota/freeze, worker report, history/photo deletion, lead assignment, registration and invitations' as result;
rollback;
