-- Invitations are capabilities delivered only by email. No client receives their hashes.
create table check_app_private.company_invitations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 department_id uuid not null references public.departments(id) on delete cascade,
 email text not null check(email=lower(trim(email)) and length(email)<=254),
 created_by uuid references auth.users(id) on delete set null,
 token_hash text unique,
 status text not null default 'draft' check(status in ('draft','sending','pending','accepted','revoked')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 delivery_started_at timestamptz, sent_at timestamptz, accepted_at timestamptz,
 accepted_by uuid references auth.users(id) on delete set null
);
create index check_invitation_company_created on check_app_private.company_invitations(company_id,created_at desc);
alter table check_app_private.company_invitations enable row level security;
revoke all on check_app_private.company_invitations from public,anon,authenticated;

create function check_app_private.require_network_manager(p_actor uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_company uuid;
begin
 select p.company_id into v_company from public.profiles p join public.companies c on c.id=p.company_id
 where p.id=p_actor and p.role='manager' and c.deletion_requested_at is null for share of c;
 if v_company is null then raise exception using errcode='42501',message='Network manager required'; end if;
 return v_company;
end $$;
revoke all on function check_app_private.require_network_manager(uuid) from public,anon,authenticated;

create function public.company_invitation_admin(p_actor uuid,p_mode text,p_email text default null,p_department uuid default null,
 p_invitation uuid default null,p_token_hash text default null,p_delivered boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_company uuid; j check_app_private.company_invitations%rowtype; result jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Server access required'; end if;
 v_company:=check_app_private.require_network_manager(p_actor);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invitations:'||v_company::text,0));
 if p_mode='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'department_id',i.department_id,'status',i.status,
   'created_at',i.created_at,'expires_at',i.expires_at,'sent_at',i.sent_at) order by i.created_at desc),'[]'::jsonb) into result
  from (select * from check_app_private.company_invitations where company_id=v_company order by created_at desc limit 100) i;
  return result;
 end if;
 if p_mode='create' then
  if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   raise exception using errcode='22023',message='Invalid email'; end if;
  if not exists(select 1 from public.departments where id=p_department and company_id=v_company) then
   raise exception using errcode='42501',message='Invalid department'; end if;
  if (select count(*) from check_app_private.company_invitations where created_by=p_actor and created_at>now()-interval '1 hour')>=30 then
   raise exception using errcode='54000',message='Invitation rate limit reached'; end if;
  if exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.company_id=v_company and lower(u.email)=lower(trim(p_email))) then
   raise exception using errcode='22023',message='Employee already belongs to this company'; end if;
  update check_app_private.company_invitations set status='revoked',token_hash=null
   where company_id=v_company and email=lower(trim(p_email)) and status in ('draft','sending','pending');
  insert into check_app_private.company_invitations(company_id,department_id,email,created_by)
   values(v_company,p_department,lower(trim(p_email)),p_actor) returning * into j;
 else
  select * into j from check_app_private.company_invitations where id=p_invitation and company_id=v_company for update;
  if not found then raise exception using errcode='42501',message='Invitation not found'; end if;
  if p_mode='send' then
   if j.status in ('accepted','revoked') then raise exception using errcode='22023',message='Invitation is closed'; end if;
   if j.status='sending' and j.delivery_started_at>now()-interval '2 minutes' then
    raise exception using errcode='55000',message='Invitation is being sent'; end if;
   if j.sent_at>now()-interval '1 minute' then raise exception using errcode='54000',message='Invitation cooldown'; end if;
   if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Invalid token hash'; end if;
   update check_app_private.company_invitations set token_hash=p_token_hash,status='sending',delivery_started_at=now(),expires_at=now()+interval '7 days'
    where id=j.id returning * into j;
  elsif p_mode='finish' then
   if j.token_hash is distinct from p_token_hash then raise exception using errcode='22023',message='Stale delivery'; end if;
   if j.status<>'accepted' then
    update check_app_private.company_invitations set status=case when p_delivered then 'pending' else 'draft' end,
     token_hash=case when p_delivered then token_hash else null end,sent_at=case when p_delivered then now() else sent_at end
     where id=j.id returning * into j;
   end if;
  elsif p_mode='revoke' then
   if j.status='accepted' then raise exception using errcode='22023',message='Invitation already accepted'; end if;
   update check_app_private.company_invitations set status='revoked',token_hash=null where id=j.id returning * into j;
  else raise exception using errcode='22023',message='Invalid invitation action'; end if;
 end if;
 return jsonb_build_object('id',j.id,'email',j.email,'department_id',j.department_id,'status',j.status,'expires_at',j.expires_at,
  'company_name',(select name from public.companies where id=j.company_id),'department_name',(select name from public.departments where id=j.department_id));
end $$;

create function public.resolve_company_invitation(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j check_app_private.company_invitations%rowtype; v_user uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Server access required'; end if;
 select i.* into j from check_app_private.company_invitations i join public.companies c on c.id=i.company_id
 where token_hash=p_token_hash and status in ('sending','pending') and expires_at>now() and c.deletion_requested_at is null;
 if not found then raise exception using errcode='22023',message='Invitation invalid or expired'; end if;
 select id into v_user from auth.users where lower(email)=j.email and deleted_at is null;
 return jsonb_build_object('id',j.id,'email',j.email,'company_id',j.company_id,'department_id',j.department_id,
  'company_name',(select name from public.companies where id=j.company_id),'department_name',(select name from public.departments where id=j.department_id),
  'existing_user_id',v_user);
end $$;

create function public.accept_company_email_invitation(p_actor uuid,p_token_hash text,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j check_app_private.company_invitations%rowtype; v_company uuid; v_email text; v_confirmed timestamptz;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Server access required'; end if;
 select * into j from check_app_private.company_invitations where token_hash=p_token_hash;
 if not found then raise exception using errcode='22023',message='Invitation invalid or expired'; end if;
 perform 1 from public.companies where id=j.company_id and deletion_requested_at is null for share;
 select * into j from check_app_private.company_invitations where token_hash=p_token_hash for update;
 if not found or j.status not in ('sending','pending') or j.expires_at<=now() then
  raise exception using errcode='22023',message='Invitation invalid or expired'; end if;
 perform 1 from public.companies where id=j.company_id and deletion_requested_at is null for share;
 if not found then raise exception using errcode='42501',message='Company unavailable'; end if;
 select lower(email),email_confirmed_at into v_email,v_confirmed from auth.users where id=p_actor and deleted_at is null;
 if v_email is distinct from j.email or v_confirmed is null then raise exception using errcode='42501',message='Invited email required'; end if;
 if nullif(trim(p_name),'') is null or length(trim(p_name))>100 then raise exception using errcode='22023',message='Name is required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invited-user:'||p_actor::text,0));
 select company_id into v_company from public.profiles where id=p_actor for update;
 if found then
  if v_company<>j.company_id then raise exception using errcode='42501',message='Account already belongs to another company'; end if;
 else
  insert into public.profiles(id,company_id,department_id,name,role) values(p_actor,j.company_id,j.department_id,trim(p_name),'employee');
 end if;
 update check_app_private.company_invitations set status='accepted',accepted_at=now(),accepted_by=p_actor where id=j.id;
 return jsonb_build_object('company_id',j.company_id,'role','employee');
end $$;
revoke all on function public.company_invitation_admin(uuid,text,text,uuid,uuid,text,boolean),public.resolve_company_invitation(text),public.accept_company_email_invitation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.company_invitation_admin(uuid,text,text,uuid,uuid,text,boolean),public.resolve_company_invitation(text),public.accept_company_email_invitation(uuid,text,text) to service_role;
-- Shared department codes are superseded by email-bound, expiring invitations.
revoke all on function public.join_company_by_invite(text,text,text) from public,anon,authenticated;

create function public.set_company_member_role(p_user_id uuid,p_role text,p_department_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_company uuid; target public.profiles%rowtype;
begin
 v_company:=check_app_private.require_network_manager(auth.uid());
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('company-roles:'||v_company::text,0));
 perform check_app_private.require_network_manager(auth.uid());
 select * into target from public.profiles where id=p_user_id and company_id=v_company for update;
 if not found then raise exception using errcode='42501',message='Employee not found'; end if;
 if p_role not in ('manager','responsible','employee') or p_role is null then raise exception using errcode='22023',message='Invalid role'; end if;
 if p_role<>'manager' and not exists(select 1 from public.departments where id=p_department_id and company_id=v_company) then
  raise exception using errcode='42501',message='Choose a department in this company'; end if;
 if target.role='manager' and p_role<>'manager' and (select count(*) from public.profiles where company_id=v_company and role='manager')<=1 then
  raise exception using errcode='42501',message='Cannot demote the last network manager'; end if;
 if p_role='responsible' then
  update public.profiles set role='employee' where company_id=v_company and department_id=p_department_id and role='responsible' and id<>p_user_id;
 end if;
 update public.profiles set role=p_role,department_id=case when p_role='manager' then null else p_department_id end where id=p_user_id;
 return jsonb_build_object('id',p_user_id,'role',p_role,'department_id',case when p_role='manager' then null else p_department_id end);
end $$;
revoke all on function public.set_company_member_role(uuid,text,uuid) from public,anon;
grant execute on function public.set_company_member_role(uuid,text,uuid) to authenticated;

-- Billing is private; work capabilities contain no tariff, price or expiry fields.
alter policy subscriptions_read on public.subscriptions using(company_id=public.current_company_id() and public.current_role()='manager');
create function public.get_current_work_limits()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lim record; v_company uuid:=public.current_company_id();
begin
 if v_company is null then raise exception using errcode='42501',message='Company access required'; end if;
 select * into lim from check_app_private.plan_limits();
 return jsonb_build_object('max_departments',lim.max_departments,'max_equipment',lim.max_equipment,'work_active',lim.work_active,
  'active_department_ids',(select coalesce(jsonb_agg(d.id),'[]'::jsonb) from public.departments d where d.company_id=v_company
   and (public.current_role()='manager' or d.id=public.current_department_id()) and check_app_private.department_active(d.id)),
  'active_equipment_ids',(select coalesce(jsonb_agg(e.id),'[]'::jsonb) from public.equipment e where e.company_id=v_company
   and (public.current_role()='manager' or e.department_id=public.current_department_id()) and check_app_private.equipment_active(e.id)));
end $$;
revoke all on function public.get_current_work_limits() from public,anon;
grant execute on function public.get_current_work_limits() to authenticated;

-- Employees create consumable requests but cannot alter existing records/photos.
alter policy consumables_update on public.consumable_requests using
 (company_id=public.current_company_id() and (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id() and created_by=auth.uid() and status='needed')))
 with check(company_id=public.current_company_id() and (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id() and created_by=auth.uid() and status='needed')));
do $$ declare def text; begin
 def:=pg_catalog.pg_get_functiondef('check_app_private.photo_access_active_company(text,text,text,text)'::regprocedure);
 if position('and c.created_by=auth.uid() and c.status=''needed''' in def)=0 then raise exception 'Unexpected photo access definition'; end if;
 execute replace(def,'and c.created_by=auth.uid() and c.status=''needed''','and p.role=''responsible'' and c.created_by=auth.uid() and c.status=''needed''');
end $$;

-- Recurring tasks are generated from saved maintenance rules on the server.
alter policy tasks_create on public.tasks with check(company_id=public.current_company_id() and
 (public.current_role()='manager' or (public.current_role()='responsible' and department_id=public.current_department_id())));
create function public.ensure_due_maintenance_tasks()
returns integer language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function public.ensure_due_maintenance_tasks() from public,anon;
grant execute on function public.ensure_due_maintenance_tasks() to authenticated;
