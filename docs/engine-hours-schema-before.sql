-- Server definitions captured before the additive engine-hour migration.
-- Reference backup only. A frontend rollback must retain the additive schema and
-- extended task generator once hour schedules exist. Do not discard meter history.
CREATE OR REPLACE FUNCTION check_app_private.guard_business_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_role text; v_department uuid; lim record; v_task public.tasks%rowtype; v_action public.maintenance_actions%rowtype;
begin
  if current_user not in ('anon','authenticated') then return new; end if;
  v_role := public.current_role();
  if auth.uid() is null or new.company_id is distinct from public.current_company_id() then
    raise exception using errcode='42501',message='Company access denied';
  end if;
  -- Serialize quota checks, generated tasks and reports for this company.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('check-app:'||new.company_id::text,0));
  if tg_op='INSERT' then
    -- Existing rows are validated by the UPDATE trigger after ON CONFLICT.
    if tg_table_name='departments' and exists(select 1 from public.departments where id=new.id) then return new; end if;
    if tg_table_name='equipment' and exists(select 1 from public.equipment where id=new.id) then return new; end if;
    if tg_table_name='maintenance_actions' and exists(select 1 from public.maintenance_actions where id=new.id) then return new; end if;
    if tg_table_name='tasks' and exists(select 1 from public.tasks where id=new.id) then return new; end if;
    if tg_table_name='completions' and exists(select 1 from public.completions where id=new.id) then return new; end if;
    if tg_table_name='one_time_tasks' and exists(select 1 from public.one_time_tasks where id=new.id) then return new; end if;
    if tg_table_name='consumable_requests' and exists(select 1 from public.consumable_requests where id=new.id) then return new; end if;
  else
    if (new.id,new.company_id,new.created_at) is distinct from (old.id,old.company_id,old.created_at) then
      raise exception using errcode='42501',message='Record identity is immutable';
    end if;
    if new is not distinct from old then return new; end if;
  end if;
  select * into lim from check_app_private.plan_limits();
  if tg_table_name='departments' then
    if tg_op='INSERT' and (select count(*) from public.departments where company_id=new.company_id)>=lim.max_departments then
      raise exception using errcode='42501',message='Department limit reached';
    end if;
    if tg_op='UPDATE' and not check_app_private.department_active(new.id) then raise exception using errcode='42501',message='Department is frozen by the plan'; end if;
    return new;
  end if;
  if tg_op='UPDATE' and new.department_id is distinct from old.department_id then
    raise exception using errcode='42501',message='Record department is immutable';
  end if;
  select company_id into v_department from public.departments where id=new.department_id;
  if v_department is distinct from new.company_id then raise exception using errcode='42501',message='Invalid department'; end if;
  if not check_app_private.department_active(new.department_id) then raise exception using errcode='42501',message='Department is frozen by the plan'; end if;
  if tg_table_name='equipment' then
    if tg_op='INSERT' and (select count(*) from public.equipment where company_id=new.company_id and department_id=new.department_id)>=lim.max_equipment then
      raise exception using errcode='42501',message='Equipment limit reached';
    end if;
    if tg_op='UPDATE' and not check_app_private.equipment_active(new.id) then raise exception using errcode='42501',message='Equipment is frozen by the plan'; end if;
    return new;
  end if;
  if tg_table_name in ('maintenance_actions','tasks','completions') then
    if new.equipment_id is not null and not exists(select 1 from public.equipment e
      where e.id=new.equipment_id and e.company_id=new.company_id and e.department_id=new.department_id) then
      raise exception using errcode='42501',message='Invalid equipment reference';
    end if;
    if new.equipment_id is not null and not check_app_private.equipment_active(new.equipment_id) then
      raise exception using errcode='42501',message='Equipment is frozen by the plan';
    end if;
  end if;
  if tg_table_name='maintenance_actions' then return new; end if;
  if tg_table_name in ('tasks','completions') then
    if new.action_id is not null then
      select * into v_action from public.maintenance_actions where id=new.action_id;
      if not found or (v_action.company_id,v_action.department_id,v_action.equipment_id) is distinct from
         (new.company_id,new.department_id,new.equipment_id) then raise exception using errcode='42501',message='Invalid maintenance reference'; end if;
    end if;
  end if;
  if tg_table_name='tasks' then
    if not lim.work_active then raise exception using errcode='42501',message='Subscription expired'; end if;
    if new.assigned_user_id is not null and not exists(select 1 from public.profiles p
      where p.id=new.assigned_user_id and p.company_id=new.company_id and (p.role='manager' or p.department_id=new.department_id)) then
      raise exception using errcode='42501',message='Invalid task assignee';
    end if;
    if v_role='employee' then
      if new.assigned_user_id is not null and new.assigned_user_id<>auth.uid() then raise exception using errcode='42501',message='Task belongs to another user'; end if;
      if tg_op='INSERT' then
        if new.action_id is null or new.date<>(now() at time zone 'UTC')::date or new.status<>'pending' or
           new.title is distinct from v_action.name or coalesce(new.description,'')<>coalesce(v_action.description,'') or
           new.assigned_user_id is not null or new.blocked_at is not null or new.blocked_comment is not null or new.blocked_worker_name is not null then
          raise exception using errcode='42501',message='Only a due maintenance task can be generated';
        end if;
        if exists(select 1 from public.tasks t where t.action_id=new.action_id and (t.status<>'done' or t.date=new.date)) or
           exists(select 1 from public.completions c where c.action_id=new.action_id and new.date-c.date<v_action.frequency) then
          raise exception using errcode='42501',message='Maintenance is not due';
        end if;
      elsif (to_jsonb(new)-array['status','blocked_comment','blocked_worker_name','blocked_at']) is distinct from
            (to_jsonb(old)-array['status','blocked_comment','blocked_worker_name','blocked_at']) or old.status='done' then
        raise exception using errcode='42501',message='Only the execution result can be changed';
      end if;
    end if;
    if new.status='done' and not exists(select 1 from public.completions c where c.task_id=new.id and c.company_id=new.company_id) then
      raise exception using errcode='42501',message='A photo report is required';
    end if;
    if new.status='blocked' and (nullif(trim(new.blocked_comment),'') is null or nullif(trim(new.blocked_worker_name),'') is null) then
      raise exception using errcode='42501',message='Worker and reason are required';
    end if;
  elsif tg_table_name='completions' then
    if tg_op='INSERT' then
      if not lim.work_active then raise exception using errcode='42501',message='Subscription expired'; end if;
      select * into v_task from public.tasks where id=new.task_id;
      if not found or v_task.status='done' or (v_task.company_id,v_task.department_id,v_task.action_id,v_task.equipment_id) is distinct from
         (new.company_id,new.department_id,new.action_id,new.equipment_id) or new.user_id<>auth.uid() or
         (v_role='employee' and v_task.assigned_user_id is not null and v_task.assigned_user_id<>auth.uid()) then
        raise exception using errcode='42501',message='Invalid report task or author';
      end if;
      if exists(select 1 from public.completions c where c.task_id=new.task_id) then raise exception using errcode='42501',message='Task already reported'; end if;
      if nullif(trim(new.worker_name),'') is null or nullif(trim(new.photo_path),'') is null or not exists(select 1 from storage.objects o
        where o.bucket_id='equipment-photos' and o.name=new.photo_path and o.owner_id=auth.uid()::text) then
        raise exception using errcode='42501',message='Worker and an uploaded photo are required';
      end if;
    elsif (new.user_id,new.task_id,new.action_id,new.equipment_id,new.date,new.time) is distinct from
          (old.user_id,old.task_id,old.action_id,old.equipment_id,old.date,old.time) and pg_trigger_depth()=1 then
      raise exception using errcode='42501',message='Report identity is immutable';
    end if;
  elsif tg_table_name='one_time_tasks' then
    if not lim.work_active then raise exception using errcode='42501',message='Subscription expired'; end if;
    if tg_op='INSERT' and not exists(select 1 from public.profiles p where p.id=new.assigned_user_id and p.company_id=new.company_id
      and p.department_id=new.department_id and p.role='employee') then raise exception using errcode='42501',message='Invalid task assignee'; end if;
    if new.status='done' and not exists(select 1 from storage.objects o where o.bucket_id='equipment-photos' and o.name=new.photo_path and o.owner_id=auth.uid()::text) then
      raise exception using errcode='42501',message='An uploaded photo is required';
    end if;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION check_app_private.company_lifecycle_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_deleting timestamptz;
begin
  -- A share lock serializes in-flight writes against the deletion freeze.
  select deletion_requested_at into v_deleting from public.companies where id=new.company_id for share;
  if v_deleting is not null and pg_trigger_depth()=1 then
    raise exception using errcode='42501',message='Company deletion is in progress';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.current_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.company_id from public.profiles p join public.companies c on c.id=p.company_id
  where p.id=auth.uid() and c.deletion_requested_at is null;
$function$
;
CREATE OR REPLACE FUNCTION public.current_department_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.department_id from public.profiles p join public.companies c on c.id=p.company_id
  where p.id=auth.uid() and c.deletion_requested_at is null;
$function$
;
CREATE OR REPLACE FUNCTION public."current_role"()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.role from public.profiles p join public.companies c on c.id=p.company_id
  where p.id=auth.uid() and c.deletion_requested_at is null;
$function$
;
CREATE OR REPLACE FUNCTION check_app_private.department_active(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.departments d,check_app_private.plan_limits() lim
    where d.id=p_id and d.company_id=public.current_company_id()
      and (select count(*) from public.departments x where x.company_id=d.company_id
        and (x.created_at,x.id)<(d.created_at,d.id))<lim.max_departments);
$function$
;
CREATE OR REPLACE FUNCTION check_app_private.equipment_active(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.equipment e,check_app_private.plan_limits() lim
    where e.id=p_id and e.company_id=public.current_company_id() and check_app_private.department_active(e.department_id)
      and (select count(*) from public.equipment x where x.company_id=e.company_id and x.department_id=e.department_id
        and (x.created_at,x.id)<(e.created_at,e.id))<lim.max_equipment);
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_due_maintenance_tasks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid:=public.current_company_id(); n integer; lim record;
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
 where a.company_id=v_company and (public.current_role()='manager' or a.department_id=public.current_department_id())
 and check_app_private.department_active(a.department_id) and check_app_private.equipment_active(a.equipment_id)
 and not exists(select 1 from public.tasks t where t.action_id=a.id and (t.status<>'done' or t.date=(now() at time zone 'UTC')::date))
 and not exists(select 1 from public.completions c where c.action_id=a.id and (now() at time zone 'UTC')::date-c.date<a.frequency);
 get diagnostics n=row_count;
 return n;
end $function$

