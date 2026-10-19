-- Preserve existing data and read-only history. Enforce writes at the database boundary.
create schema if not exists check_app_private;
revoke all on schema check_app_private from public,anon;
grant usage on schema check_app_private to authenticated;

create or replace function check_app_private.plan_limits()
returns table(max_departments integer,max_equipment integer,work_active boolean)
language plpgsql stable security definer set search_path='' as $$
declare v_plan text; v_expiry timestamptz;
begin
  if auth.uid() is null then return query select 0,0,false; return; end if;
  if public.current_company_is_unlimited() then return query select 2147483647,2147483647,true; return; end if;
  select plan_id,expires_at into v_plan,v_expiry from public.subscriptions where company_id=public.current_company_id();
  work_active := coalesce(v_plan,'free')='free' or v_expiry>now();
  if v_plan is null or (v_plan<>'free' and (v_expiry is null or v_expiry<=now())) then v_plan:='free'; end if;
  max_departments := case v_plan when 'standard' then 3 when 'standard_plus' then 5 when 'premium' then 10 when 'ultra' then 20 else 1 end;
  max_equipment := case v_plan when 'lite' then 15 when 'standard' then 25 when 'standard_plus' then 25 when 'premium' then 25 when 'ultra' then 25 else 5 end;
  work_active := coalesce(work_active,false);
  return next;
end $$;

create or replace function check_app_private.department_active(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.departments d,check_app_private.plan_limits() lim
    where d.id=p_id and d.company_id=public.current_company_id()
      and (select count(*) from public.departments x where x.company_id=d.company_id
        and (x.created_at,x.id)<(d.created_at,d.id))<lim.max_departments);
$$;
create or replace function check_app_private.equipment_active(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.equipment e,check_app_private.plan_limits() lim
    where e.id=p_id and e.company_id=public.current_company_id() and check_app_private.department_active(e.department_id)
      and (select count(*) from public.equipment x where x.company_id=e.company_id and x.department_id=e.department_id
        and (x.created_at,x.id)<(e.created_at,e.id))<lim.max_equipment);
$$;

create or replace function check_app_private.guard_profile_write()
returns trigger language plpgsql set search_path='' as $$
declare previous public.profiles%rowtype;
begin
  -- Registration RPCs run as their trusted owner; public clients run as authenticated.
  if current_user not in ('anon','authenticated') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' then
    if old.role='manager' then raise exception using errcode='42501',message='Company owner cannot be removed by a client'; end if;
    return old;
  end if;
  if tg_op='INSERT' then
    select * into previous from public.profiles where id=new.id;
    if not found then raise exception using errcode='42501',message='Use the registration or invitation flow'; end if;
    -- An upsert may only update an existing accessible profile.
    if new.company_id is distinct from previous.company_id or new.role='manager' and previous.role<>'manager' then
      raise exception using errcode='42501',message='Profile privilege escalation denied';
    end if;
    return new;
  end if;
  if (new.id,new.company_id,new.created_at) is distinct from (old.id,old.company_id,old.created_at) then
    raise exception using errcode='42501',message='Profile identity is immutable';
  end if;
  if old.role='manager' then
    if new.role is distinct from old.role or new.department_id is distinct from old.department_id or
       (old.id<>auth.uid() and new is distinct from old) then
      raise exception using errcode='42501',message='Company owner role is protected';
    end if;
  elsif new.role='manager' then
    raise exception using errcode='42501',message='Creating a company owner is not permitted';
  end if;
  if new.department_id is not null and not exists(select 1 from public.departments d
     where d.id=new.department_id and d.company_id=new.company_id) then
    raise exception using errcode='42501',message='Invalid profile department';
  end if;
  return new;
end $$;
create trigger a_check_app_profile_guard before insert or update or delete on public.profiles
  for each row execute function check_app_private.guard_profile_write();

-- Replace broad ALL policies with operation-specific rights.
drop policy equipment_access on public.equipment;
create policy equipment_read on public.equipment for select to authenticated using
  (company_id=public.current_company_id() and (public.current_role()='manager' or department_id=public.current_department_id()));
create policy equipment_write on public.equipment for all to authenticated using
  (company_id=public.current_company_id() and (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id())))
  with check (company_id=public.current_company_id() and (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id())));
drop policy actions_access on public.maintenance_actions;
create policy actions_read on public.maintenance_actions for select to authenticated using
  (company_id=public.current_company_id() and (public.current_role()='manager' or department_id=public.current_department_id()));
create policy actions_write on public.maintenance_actions for all to authenticated using
  (company_id=public.current_company_id() and (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id())))
  with check (company_id=public.current_company_id() and (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id())));
drop policy tasks_access on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using
  (company_id=public.current_company_id() and (public.current_role()='manager' or department_id=public.current_department_id()));
create policy tasks_create on public.tasks for insert to authenticated with check
  (company_id=public.current_company_id() and (public.current_role()='manager' or department_id=public.current_department_id()));
create policy tasks_update on public.tasks for update to authenticated using
  (company_id=public.current_company_id() and (public.current_role()='manager' or department_id=public.current_department_id())) with check
  (company_id=public.current_company_id() and (public.current_role()='manager' or department_id=public.current_department_id()));
create policy tasks_delete on public.tasks for delete to authenticated using
  (company_id=public.current_company_id() and (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id())));
drop policy completions_access on public.completions;
create policy completions_read on public.completions for select to authenticated using
  (company_id=public.current_company_id() and (public.current_role()='manager' or department_id=public.current_department_id()));
create policy completions_create on public.completions for insert to authenticated with check
  (company_id=public.current_company_id() and (user_id=auth.uid() or public.current_role()='manager') and
    (public.current_role()='manager' or department_id=public.current_department_id()));
create policy completions_update on public.completions for update to authenticated using
  (company_id=public.current_company_id() and public.current_role()='manager') with check
  (company_id=public.current_company_id() and public.current_role()='manager');
create policy completions_delete on public.completions for delete to authenticated using
  (company_id=public.current_company_id() and public.current_role()='manager');

-- Every company member needs the true plan when restoring a session; UI controls stay role-specific.
drop policy subscriptions_access on public.subscriptions;
create policy subscriptions_read on public.subscriptions for select to authenticated using (company_id=public.current_company_id());

create or replace function check_app_private.guard_business_write()
returns trigger language plpgsql set search_path='' as $$
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
end $$;

drop trigger enforce_department_limit on public.departments;
drop trigger enforce_equipment_limit on public.equipment;
do $$ declare t text; begin
  foreach t in array array['departments','equipment','maintenance_actions','tasks','completions','one_time_tasks','consumable_requests'] loop
    execute format('create trigger a_check_app_business_guard before insert or update on public.%I for each row execute function check_app_private.guard_business_write()',t);
    execute format('revoke truncate,references,trigger on public.%I from anon,authenticated',t);
  end loop;
end $$;
revoke truncate,references,trigger on public.profiles from anon,authenticated;

-- Qualify outer columns: the previous comparisons accidentally compared p.company_id to itself.
alter policy one_time_tasks_insert on public.one_time_tasks with check
  (company_id=public.current_company_id() and created_by=auth.uid() and
   (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id())) and
   exists(select 1 from public.profiles p where p.id=one_time_tasks.assigned_user_id and p.company_id=one_time_tasks.company_id
     and p.department_id=one_time_tasks.department_id and p.role='employee'));

revoke all on all functions in schema check_app_private from public,anon,authenticated;
grant execute on function check_app_private.plan_limits(),check_app_private.department_active(uuid),check_app_private.equipment_active(uuid) to authenticated;
-- Trigger functions are invoked by the database and do not need a client EXECUTE grant.

create or replace function check_app_private.photo_access(p_bucket text,p_name text,p_owner text,p_operation text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype; v_id uuid; v_department uuid; v_linked boolean;
begin
  select * into p from public.profiles where id=auth.uid();
  if not found or p_bucket not in ('equipment-photos','consumable-photos') or
     split_part(p_name,'/',1)<>p.company_id::text then return false; end if;
  if p_operation='read' and p.role='manager' then return true; end if;
  if p_operation='delete' and p.role='manager' then return true; end if;
  if p_operation='read' then
    return (p_owner=auth.uid()::text) or
      (p_bucket='equipment-photos' and (
        exists(select 1 from public.equipment e where e.photo_path=p_name and e.company_id=p.company_id and e.department_id=p.department_id) or
        exists(select 1 from public.completions c where c.photo_path=p_name and c.company_id=p.company_id and c.department_id=p.department_id) or
        exists(select 1 from public.one_time_tasks t where t.photo_path=p_name and t.company_id=p.company_id and
          (p.role='responsible' and t.department_id=p.department_id or t.assigned_user_id=auth.uid())))) or
      (p_bucket='consumable-photos' and exists(select 1 from public.consumable_requests c
        where c.photo_path=p_name and c.company_id=p.company_id and c.department_id=p.department_id));
  end if;
  if p_operation='delete' then
    v_linked := (p_bucket='equipment-photos' and (
      exists(select 1 from public.equipment where photo_path=p_name) or
      exists(select 1 from public.completions where photo_path=p_name) or
      exists(select 1 from public.one_time_tasks where photo_path=p_name))) or
      (p_bucket='consumable-photos' and exists(select 1 from public.consumable_requests where photo_path=p_name));
    if not v_linked and p_owner=auth.uid()::text then return true; end if;
    if p_bucket='equipment-photos' then
      return p.role='responsible' and exists(select 1 from public.equipment e
        where e.photo_path=p_name and e.company_id=p.company_id and e.department_id=p.department_id)
        and not exists(select 1 from public.completions where photo_path=p_name)
        and not exists(select 1 from public.one_time_tasks where photo_path=p_name);
    end if;
    return exists(select 1 from public.consumable_requests c where c.photo_path=p_name and c.company_id=p.company_id
      and c.department_id=p.department_id and c.created_by=auth.uid() and c.status='needed');
  end if;
  if p_operation<>'insert' then return false; end if;
  -- Metadata is set by the Storage API, never trust a caller-supplied owner.
  if p_owner is distinct from auth.uid()::text then return false; end if;
  begin v_id:=split_part(p_name,'/',2)::uuid; exception when invalid_text_representation then return false; end;
  if p_bucket='consumable-photos' then return check_app_private.department_active(p.department_id) or p.role='manager'; end if;
  if array_length(string_to_array(p_name,'/'),1)=3 then
    -- Equipment photos are uploaded before the equipment row is inserted.
    return p.role='manager' or (p.role='responsible' and check_app_private.department_active(p.department_id));
  end if;
  v_department:=v_id;
  if not check_app_private.department_active(v_department) or (p.role<>'manager' and v_department is distinct from p.department_id) or
     not (select work_active from check_app_private.plan_limits()) then return false; end if;
  if split_part(p_name,'/',3)='one-time' then
    begin v_id:=split_part(p_name,'/',4)::uuid; exception when invalid_text_representation then return false; end;
    return exists(select 1 from public.one_time_tasks t where t.id=v_id and t.company_id=p.company_id
      and t.department_id=v_department and t.assigned_user_id=auth.uid() and t.status='pending');
  end if;
  begin v_id:=split_part(p_name,'/',3)::uuid; exception when invalid_text_representation then return false; end;
  return exists(select 1 from public.tasks t where t.id=v_id and t.company_id=p.company_id and t.department_id=v_department
    and t.status<>'done' and check_app_private.equipment_active(t.equipment_id)
    and (p.role<>'employee' or t.assigned_user_id is null or t.assigned_user_id=auth.uid()));
end $$;
revoke all on function check_app_private.photo_access(text,text,text,text) from public,anon;
grant execute on function check_app_private.photo_access(text,text,text,text) to authenticated;

drop policy equipment_photos_select_company on storage.objects;
drop policy equipment_photos_insert_company on storage.objects;
drop policy equipment_photos_delete_company on storage.objects;
drop policy consumable_photos_select_company on storage.objects;
drop policy consumable_photos_insert_company on storage.objects;
drop policy consumable_photos_delete_company on storage.objects;
create policy check_app_photos_read on storage.objects for select to authenticated using
  (check_app_private.photo_access(bucket_id,name,owner_id,'read'));
create policy check_app_photos_insert on storage.objects for insert to authenticated with check
  (check_app_private.photo_access(bucket_id,name,owner_id,'insert'));
create policy check_app_photos_delete on storage.objects for delete to authenticated using
  (check_app_private.photo_access(bucket_id,name,owner_id,'delete'));

update storage.buckets set file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp']
  where id='equipment-photos';
