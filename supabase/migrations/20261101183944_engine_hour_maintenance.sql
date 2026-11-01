-- Additive: existing date-based schedules retain their frequency and behavior.
set lock_timeout = '5s';
alter table public.equipment add column engine_hours numeric(12,1), add column engine_hours_updated_at timestamptz,
  add constraint equipment_engine_hours_check check(engine_hours >= 0 and engine_hours <= 999999999.9);
alter table public.maintenance_actions add column schedule_type text not null default 'days',
  add column hours_interval numeric(12,1), add column next_due_hours numeric(12,1),
  add constraint maintenance_hours_schedule_check check(
    (schedule_type='days' and hours_interval is null and next_due_hours is null) or
    (schedule_type='hours' and hours_interval > 0 and hours_interval <= 999999999.9 and next_due_hours > 0
      and hours_interval is not null and next_due_hours is not null));
alter table public.tasks add column due_engine_hours numeric(12,1);
alter table public.completions add column engine_hours numeric(12,1);

create table public.equipment_hour_readings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  previous_hours numeric(12,1), engine_hours numeric(12,1) not null,
  recorded_at timestamptz not null default now(),
  constraint readings_nonnegative check(engine_hours >= 0 and engine_hours <= 999999999.9)
);
create index equipment_hour_readings_scope_idx on public.equipment_hour_readings(company_id,department_id,equipment_id,recorded_at desc);
create index equipment_hour_readings_equipment_idx on public.equipment_hour_readings(equipment_id);
create index equipment_hour_readings_department_idx on public.equipment_hour_readings(department_id);
create index equipment_hour_readings_user_idx on public.equipment_hour_readings(user_id);
alter table public.equipment_hour_readings enable row level security;
revoke all on public.equipment_hour_readings from anon, authenticated;
grant select on public.equipment_hour_readings to authenticated;
create policy equipment_hour_readings_read on public.equipment_hour_readings for select to authenticated
using(company_id=(select public.current_company_id()) and
  ((select public.current_role())='manager' or department_id=(select public.current_department_id())));

create function check_app_private.guard_engine_hour_fields() returns trigger
language plpgsql set search_path='' as $$
declare e public.equipment%rowtype; a public.maintenance_actions%rowtype; t public.tasks%rowtype;
begin
  if tg_table_name='equipment' then
    if tg_op='INSERT' then
      if new.engine_hours is not null then raise exception 'Внесите показания отдельной кнопкой «Моточасы»'; end if;
    elsif (new.engine_hours,new.engine_hours_updated_at) is distinct from (old.engine_hours,old.engine_hours_updated_at) then
      if current_user in ('anon','authenticated') then
        raise exception using errcode='42501',message='Внесите показания отдельной кнопкой «Моточасы»';
      end if;
      if new.engine_hours is null or new.engine_hours < old.engine_hours then raise exception 'Показания нельзя уменьшать'; end if;
    end if;
  elsif tg_table_name='maintenance_actions' then
    if tg_op='INSERT' and new.schedule_type='hours' then
      select * into e from public.equipment where id=new.equipment_id;
      if e.engine_hours is null then raise exception 'Сначала внесите текущие моточасы оборудования'; end if;
      if new.hours_interval is null or new.hours_interval<=0 then raise exception 'Укажите положительный интервал моточасов'; end if;
      new.next_due_hours:=greatest(new.hours_interval,ceil(e.engine_hours/new.hours_interval)*new.hours_interval);
    elsif tg_op='UPDATE' and current_user in ('anon','authenticated') and
      (new.schedule_type,new.hours_interval,new.next_due_hours) is distinct from (old.schedule_type,old.hours_interval,old.next_due_hours) then
      raise exception using errcode='42501',message='Для изменения периодичности создайте новый регламент';
    end if;
  elsif tg_table_name='tasks' then
    if tg_op='UPDATE' and new.due_engine_hours is distinct from old.due_engine_hours then
      raise exception 'Порог созданной задачи нельзя изменять';
    end if;
    if tg_op='INSERT' then
      select * into a from public.maintenance_actions where id=new.action_id;
      if a.schedule_type='hours' then
        select * into e from public.equipment where id=new.equipment_id;
        if new.due_engine_hours is distinct from a.next_due_hours or e.engine_hours is null or e.engine_hours<a.next_due_hours then
          raise exception 'Порог ТО по моточасам ещё не достигнут';
        end if;
      elsif new.due_engine_hours is not null then raise exception 'Неверный тип периодичности задачи'; end if;
    end if;
  elsif tg_table_name='completions' then
    if tg_op='INSERT' then
      select * into t from public.tasks where id=new.task_id;
      if t.due_engine_hours is not null then
        select * into e from public.equipment where id=t.equipment_id;
        new.engine_hours:=e.engine_hours;
      else new.engine_hours:=null; end if;
    elsif new.engine_hours is distinct from old.engine_hours then raise exception 'Показания в отчёте нельзя изменять'; end if;
  end if;
  return new;
end $$;
revoke all on function check_app_private.guard_engine_hour_fields() from public,anon,authenticated;
create trigger b_engine_hour_fields before insert or update on public.equipment for each row execute function check_app_private.guard_engine_hour_fields();
create trigger b_engine_hour_fields before insert or update on public.maintenance_actions for each row execute function check_app_private.guard_engine_hour_fields();
create trigger b_engine_hour_fields before insert or update on public.tasks for each row execute function check_app_private.guard_engine_hour_fields();
create trigger b_engine_hour_fields before insert or update on public.completions for each row execute function check_app_private.guard_engine_hour_fields();

create function check_app_private.audit_equipment_hours() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.engine_hours is distinct from old.engine_hours then
    insert into public.equipment_hour_readings(company_id,department_id,equipment_id,user_id,previous_hours,engine_hours)
    values(new.company_id,new.department_id,new.id,auth.uid(),old.engine_hours,new.engine_hours);
  end if;
  return new;
end $$;
revoke all on function check_app_private.audit_equipment_hours() from public,anon,authenticated;
create trigger z_audit_equipment_hours after update on public.equipment for each row execute function check_app_private.audit_equipment_hours();

create function check_app_private.advance_engine_hour_schedule() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id=new.task_id;
  if t.due_engine_hours is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('check-app:'||new.company_id::text,0));
    update public.maintenance_actions set next_due_hours=greatest(t.due_engine_hours+hours_interval,
      (floor(new.engine_hours/hours_interval)+1)*hours_interval)
    where id=t.action_id and company_id=new.company_id and schedule_type='hours';
  end if;
  return new;
end $$;
revoke all on function check_app_private.advance_engine_hour_schedule() from public,anon,authenticated;
create trigger z_advance_engine_hour_schedule after insert on public.completions for each row execute function check_app_private.advance_engine_hour_schedule();

create or replace function public.ensure_due_maintenance_tasks() returns integer
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=public.current_company_id(); n integer; h integer; lim record;
begin
 if v_company is null then raise exception using errcode='42501',message='Company access required'; end if;
 perform 1 from public.companies where id=v_company and deletion_requested_at is null for share;
 if not found then raise exception using errcode='42501',message='Company unavailable'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('check-app:'||v_company::text,0));
 select * into lim from check_app_private.plan_limits();
 if not lim.work_active then return 0; end if;
 insert into public.tasks(company_id,department_id,action_id,equipment_id,date,status,title,equip_name,equip_code,description)
 select a.company_id,a.department_id,a.id,a.equipment_id,(now() at time zone 'UTC')::date,'pending',a.name,e.name,e.code,a.description
 from public.maintenance_actions a join public.equipment e on e.id=a.equipment_id and e.company_id=a.company_id and e.department_id=a.department_id
 where a.company_id=v_company and a.schedule_type='days' and (public.current_role()='manager' or a.department_id=public.current_department_id())
 and check_app_private.department_active(a.department_id) and check_app_private.equipment_active(a.equipment_id)
 and not exists(select 1 from public.tasks t where t.action_id=a.id and (t.status<>'done' or t.date=(now() at time zone 'UTC')::date))
 and not exists(select 1 from public.completions c where c.action_id=a.id and (now() at time zone 'UTC')::date-c.date<a.frequency);
 get diagnostics n=row_count;
 insert into public.tasks(company_id,department_id,action_id,equipment_id,date,status,title,equip_name,equip_code,description,due_engine_hours)
 select a.company_id,a.department_id,a.id,a.equipment_id,(now() at time zone 'UTC')::date,'pending',a.name,e.name,e.code,a.description,a.next_due_hours
 from public.maintenance_actions a join public.equipment e on e.id=a.equipment_id and e.company_id=a.company_id and e.department_id=a.department_id
 where a.company_id=v_company and a.schedule_type='hours' and e.engine_hours>=a.next_due_hours
 and (public.current_role()='manager' or a.department_id=public.current_department_id())
 and check_app_private.department_active(a.department_id) and check_app_private.equipment_active(a.equipment_id)
 and not exists(select 1 from public.tasks t where t.action_id=a.id and t.status<>'done');
 get diagnostics h=row_count;
 return n+h;
end $$;
revoke all on function public.ensure_due_maintenance_tasks() from public,anon;
grant execute on function public.ensure_due_maintenance_tasks() to authenticated;

-- The privileged implementation stays outside the exposed API schema.
create function check_app_private.record_equipment_hours(p_equipment_id uuid,p_hours numeric,p_expected_hours numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=public.current_company_id(); e public.equipment%rowtype; lim record;
begin
 if auth.uid() is null or c is null or public.current_role() not in ('manager','responsible','employee') then
   raise exception using errcode='42501',message='Войдите в приложение'; end if;
 if p_hours is null or p_hours::text in ('NaN','Infinity','-Infinity') or p_hours<0 or p_hours>999999999.9 or p_hours<>round(p_hours,1) then
   raise exception using errcode='22023',message='Укажите неотрицательные моточасы, не более одного знака после запятой'; end if;
 perform 1 from public.companies where id=c and deletion_requested_at is null for share;
 if not found then raise exception using errcode='42501',message='Компания недоступна'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('check-app:'||c::text,0));
 select * into e from public.equipment where id=p_equipment_id and company_id=c for update;
 if not found or (public.current_role()<>'manager' and e.department_id is distinct from public.current_department_id()) then
   raise exception using errcode='42501',message='Нет доступа к оборудованию'; end if;
 select * into lim from check_app_private.plan_limits();
 if not lim.work_active or not check_app_private.department_active(e.department_id) or not check_app_private.equipment_active(e.id) then
   raise exception using errcode='42501',message='Оборудование недоступно по текущей подписке'; end if;
 if e.engine_hours is distinct from p_expected_hours then
   raise exception using errcode='40001',message='Другой сотрудник уже обновил показания. Закройте окно и обновите данные'; end if;
 if p_hours<e.engine_hours then raise exception using errcode='22023',message='Показания нельзя уменьшать'; end if;
 if e.engine_hours is distinct from p_hours then
   update public.equipment set engine_hours=p_hours,engine_hours_updated_at=now() where id=e.id returning * into e;
 end if;
 perform public.ensure_due_maintenance_tasks();
 return to_jsonb(e);
end $$;
revoke all on function check_app_private.record_equipment_hours(uuid,numeric,numeric) from public,anon;
grant execute on function check_app_private.record_equipment_hours(uuid,numeric,numeric) to authenticated;
create function public.record_equipment_hours(p_equipment_id uuid,p_hours numeric,p_expected_hours numeric)
returns jsonb language sql security invoker set search_path='' as $$
 select check_app_private.record_equipment_hours(p_equipment_id,p_hours,p_expected_hours);
$$;
revoke all on function public.record_equipment_hours(uuid,numeric,numeric) from public,anon;
grant execute on function public.record_equipment_hours(uuid,numeric,numeric) to authenticated;
notify pgrst, 'reload schema';
