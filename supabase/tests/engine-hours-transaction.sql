-- Run as database owner. No existing customer data is modified; every fixture rolls back.
begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
create temporary table engine_fixture(k text primary key,id uuid not null default gen_random_uuid());
insert into engine_fixture(k) select unnest(array['company','foreign_company','department','foreign_department','manager','employee','foreign_employee','equipment','zero_equipment','exact_equipment','foreign_equipment','hours_action','days_action','exact_action','zero_action']);
create function pg_temp.h(p_key text) returns uuid language sql security definer as 'select id from pg_temp.engine_fixture where k=p_key';
grant select on engine_fixture to authenticated;
create function pg_temp.hour_assert(p_value boolean,p_message text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'FAILED: %',p_message; end if; end $$;
create function pg_temp.hour_expect_error(p_sql text,p_state text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlstate=p_state then return; end if;
    raise exception 'FAILED: expected %, received %: %',p_state,sqlstate,sqlerrm;
  end;
  raise exception 'FAILED: prohibited operation succeeded';
end $$;
insert into auth.users(id,aud,role,email) select id,'authenticated','authenticated',id::text||'@hour-test.invalid' from engine_fixture where k in ('manager','employee','foreign_employee');
insert into public.companies(id,name) values(pg_temp.h('company'),'TRANSACTION-ONLY HOURS'),(pg_temp.h('foreign_company'),'TRANSACTION-ONLY FOREIGN HOURS');
insert into public.departments(id,company_id,name,invite_code) values
 (pg_temp.h('department'),pg_temp.h('company'),'Workshop',pg_temp.h('department')::text),
 (pg_temp.h('foreign_department'),pg_temp.h('foreign_company'),'Foreign',pg_temp.h('foreign_department')::text);
insert into public.profiles(id,company_id,department_id,name,role) values
 (pg_temp.h('manager'),pg_temp.h('company'),null,'Owner','manager'),
 (pg_temp.h('employee'),pg_temp.h('company'),pg_temp.h('department'),'Worker','employee'),
 (pg_temp.h('foreign_employee'),pg_temp.h('foreign_company'),pg_temp.h('foreign_department'),'Foreign','employee');
insert into public.subscriptions(company_id,plan_id) values(pg_temp.h('company'),'free'),(pg_temp.h('foreign_company'),'free');
insert into public.equipment(id,company_id,department_id,name) values
 (pg_temp.h('equipment'),pg_temp.h('company'),pg_temp.h('department'),'Compressor'),
 (pg_temp.h('zero_equipment'),pg_temp.h('company'),pg_temp.h('department'),'Zero meter'),
 (pg_temp.h('exact_equipment'),pg_temp.h('company'),pg_temp.h('department'),'Exact threshold'),
 (pg_temp.h('foreign_equipment'),pg_temp.h('foreign_company'),pg_temp.h('foreign_department'),'Foreign equipment');
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.h('manager'),'role','authenticated')::text,true);
set local role authenticated;
select public.record_equipment_hours(pg_temp.h('equipment'),3560,null);
select public.record_equipment_hours(pg_temp.h('zero_equipment'),0,null);
select public.record_equipment_hours(pg_temp.h('exact_equipment'),4000,null);
insert into public.maintenance_actions(id,company_id,department_id,equipment_id,name,frequency,schedule_type,hours_interval,next_due_hours) values
 (pg_temp.h('hours_action'),pg_temp.h('company'),pg_temp.h('department'),pg_temp.h('equipment'),'Oil change',1,'hours',2000,1),
 (pg_temp.h('zero_action'),pg_temp.h('company'),pg_temp.h('department'),pg_temp.h('zero_equipment'),'Zero schedule',1,'hours',2000,1),
 (pg_temp.h('exact_action'),pg_temp.h('company'),pg_temp.h('department'),pg_temp.h('exact_equipment'),'Exact schedule',1,'hours',2000,1);
insert into public.maintenance_actions(id,company_id,department_id,equipment_id,name,frequency) values
 (pg_temp.h('days_action'),pg_temp.h('company'),pg_temp.h('department'),pg_temp.h('equipment'),'Daily inspection',7);
select pg_temp.hour_assert((select next_due_hours=4000 and next_due_hours-3560=440 from public.maintenance_actions where id=pg_temp.h('hours_action')),'3560/2000 -> 4000; 440 remaining; client cannot forge next threshold');
select pg_temp.hour_assert((select next_due_hours=2000 from public.maintenance_actions where id=pg_temp.h('zero_action')),'Zero reading does not schedule TO at zero');
select pg_temp.hour_assert(public.ensure_due_maintenance_tasks()=2,'Only calendar and exactly-reached hour threshold are due');
select pg_temp.hour_assert(public.ensure_due_maintenance_tasks()=0,'Generation is idempotent');
select pg_temp.hour_assert((select count(*)=0 from public.tasks where action_id=pg_temp.h('hours_action')),'No premature task at 3560');
select pg_temp.hour_expect_error($q$update public.equipment set engine_hours=4000 where id=pg_temp.h('equipment')$q$,'42501');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.h('employee'),'role','authenticated')::text,true);
set local role authenticated;
select public.record_equipment_hours(pg_temp.h('equipment'),3999.9,3560);
select pg_temp.hour_assert((select count(*)=0 from public.tasks where action_id=pg_temp.h('hours_action')),'Decimal reading below threshold is not due');
select pg_temp.hour_expect_error($q$select public.record_equipment_hours(pg_temp.h('equipment'),4000,3560)$q$,'40001');
select pg_temp.hour_expect_error($q$select public.record_equipment_hours(pg_temp.h('equipment'),-1,3999.9)$q$,'22023');
select pg_temp.hour_expect_error($q$select public.record_equipment_hours(pg_temp.h('equipment'),3999,3999.9)$q$,'22023');
select pg_temp.hour_expect_error($q$select public.record_equipment_hours(pg_temp.h('equipment'),4000.12,3999.9)$q$,'22023');
select pg_temp.hour_expect_error($q$select public.record_equipment_hours(pg_temp.h('equipment'),'NaN',3999.9)$q$,'22023');
select pg_temp.hour_expect_error($q$select public.record_equipment_hours(pg_temp.h('foreign_equipment'),4000,null)$q$,'42501');
select public.record_equipment_hours(pg_temp.h('equipment'),4000,3999.9);
select public.record_equipment_hours(pg_temp.h('equipment'),4000,4000);
select pg_temp.hour_assert((select count(*)=1 from public.tasks where action_id=pg_temp.h('hours_action') and due_engine_hours=4000 and status='pending'),'Employee reading reaches threshold and generates exactly one ordinary task');
select pg_temp.hour_assert((select count(*)=3 from public.equipment_hour_readings where equipment_id=pg_temp.h('equipment')),'Audit captures first reading, 3999.9, 4000; retry adds no duplicate');
insert into storage.objects(bucket_id,name,owner_id) values('equipment-photos',pg_temp.h('company')||'/'||pg_temp.h('department')||'/'||(select id::text from public.tasks where action_id=pg_temp.h('hours_action'))||'/test.jpg',auth.uid()::text);
insert into public.completions(company_id,department_id,task_id,action_id,equipment_id,user_id,title,date,worker_name,photo_path,engine_hours)
select company_id,department_id,id,action_id,equipment_id,auth.uid(),title,current_date,'Worker',pg_temp.h('company')||'/'||pg_temp.h('department')||'/'||id::text||'/test.jpg',9999 from public.tasks where action_id=pg_temp.h('hours_action');
update public.tasks set status='done' where action_id=pg_temp.h('hours_action');
select pg_temp.hour_assert((select engine_hours=4000 from public.completions where action_id=pg_temp.h('hours_action')),'Completion snapshots actual reading, ignores spoofed client reading');
select pg_temp.hour_assert((select next_due_hours=6000 from public.maintenance_actions where id=pg_temp.h('hours_action')),'Next TO after completing 4000 is 6000');
select pg_temp.hour_assert(public.ensure_due_maintenance_tasks()=0,'Completion does not regenerate same hour task');
select public.record_equipment_hours(pg_temp.h('equipment'),8500,4000);
select pg_temp.hour_assert((select count(*)=1 from public.tasks where action_id=pg_temp.h('hours_action') and status='pending' and due_engine_hours=6000),'Large jump retains one overdue task at the original threshold');
insert into storage.objects(bucket_id,name,owner_id) select 'equipment-photos',pg_temp.h('company')||'/'||pg_temp.h('department')||'/'||id::text||'/jump.jpg',auth.uid()::text from public.tasks where action_id=pg_temp.h('hours_action') and status='pending';
insert into public.completions(company_id,department_id,task_id,action_id,equipment_id,user_id,title,date,worker_name,photo_path)
select company_id,department_id,id,action_id,equipment_id,auth.uid(),title,current_date,'Worker',pg_temp.h('company')||'/'||pg_temp.h('department')||'/'||id::text||'/jump.jpg' from public.tasks where action_id=pg_temp.h('hours_action') and status='pending';
update public.tasks set status='done' where action_id=pg_temp.h('hours_action') and status='pending';
select pg_temp.hour_assert((select next_due_hours=10000 from public.maintenance_actions where id=pg_temp.h('hours_action')),'Late servicing advances to next aligned threshold, without fictional missed reports');
select pg_temp.hour_assert((select count(*)=1 from public.tasks where action_id=pg_temp.h('days_action')),'Date task was not duplicated or removed');
reset role;
update public.subscriptions set plan_id='lite',expires_at=now()-interval '1 day' where company_id=pg_temp.h('company');
set local role authenticated;
select pg_temp.hour_assert(public.ensure_due_maintenance_tasks()=0,'Expired plan still pauses task generation');
select pg_temp.hour_expect_error($q$select public.record_equipment_hours(pg_temp.h('equipment'),9000,8500)$q$,'42501');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.h('foreign_employee'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.hour_assert((select count(*)=0 from public.equipment_hour_readings),'Foreign company cannot read meter history');
reset role;
select 'PASS: aligned thresholds, employee RPC, decimals, stale/decrease/input/tenant guards, idempotence, audit, real photo completion, late servicing and expired plan' as result;
rollback;
