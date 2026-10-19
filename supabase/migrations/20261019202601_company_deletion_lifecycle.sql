alter table public.companies add column deletion_requested_at timestamptz;
create table check_app_private.company_deletions (
  company_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  user_ids uuid[] not null,
  started_at timestamptz not null default now()
);
alter table check_app_private.company_deletions enable row level security;
revoke all on check_app_private.company_deletions from public,anon,authenticated;

create or replace function public.current_company_id() returns uuid language sql stable security definer set search_path='' as $$
  select p.company_id from public.profiles p join public.companies c on c.id=p.company_id
  where p.id=auth.uid() and c.deletion_requested_at is null;
$$;
create or replace function public.current_department_id() returns uuid language sql stable security definer set search_path='' as $$
  select p.department_id from public.profiles p join public.companies c on c.id=p.company_id
  where p.id=auth.uid() and c.deletion_requested_at is null;
$$;
create or replace function public.current_role() returns text language sql stable security definer set search_path='' as $$
  select p.role from public.profiles p join public.companies c on c.id=p.company_id
  where p.id=auth.uid() and c.deletion_requested_at is null;
$$;

create function check_app_private.company_lifecycle_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v_deleting timestamptz;
begin
  -- A share lock serializes in-flight writes against the deletion freeze.
  select deletion_requested_at into v_deleting from public.companies where id=new.company_id for share;
  if v_deleting is not null and pg_trigger_depth()=1 then
    raise exception using errcode='42501',message='Company deletion is in progress';
  end if;
  return new;
end $$;
revoke all on function check_app_private.company_lifecycle_guard() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['profiles','departments','equipment','maintenance_actions','tasks','completions','one_time_tasks','consumable_requests','subscriptions','owner_companies','payment_orders'] loop
    execute format('create trigger a_company_lifecycle_guard before insert or update on public.%I for each row execute function check_app_private.company_lifecycle_guard()',t);
  end loop;
end $$;

-- Keep the existing photo permissions; add a lifecycle gate and serialize uploads.
alter function check_app_private.photo_access(text,text,text,text) rename to photo_access_active_company;
revoke all on function check_app_private.photo_access_active_company(text,text,text,text) from public,anon,authenticated;
create function check_app_private.photo_access(p_bucket text,p_name text,p_owner text,p_operation text)
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
  return check_app_private.photo_access_active_company(p_bucket,p_name,p_owner,p_operation);
end $$;
revoke all on function check_app_private.photo_access(text,text,text,text) from public,anon;
grant execute on function check_app_private.photo_access(text,text,text,text) to authenticated;
alter policy check_app_photos_read on storage.objects using(check_app_private.photo_access(bucket_id,name,owner_id,'read'));
alter policy check_app_photos_insert on storage.objects with check(check_app_private.photo_access(bucket_id,name,owner_id,'insert'));
alter policy check_app_photos_delete on storage.objects using(check_app_private.photo_access(bucket_id,name,owner_id,'delete'));

create function public.begin_company_deletion(p_actor uuid,p_company uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j check_app_private.company_deletions%rowtype; c public.companies%rowtype; ids uuid[]; fk record; inconsistent boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Server access required'; end if;
  if p_confirmation is distinct from 'УДАЛИТЬ' then raise exception using errcode='22023',message='Type УДАЛИТЬ to confirm'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('delete-company:'||p_company::text,0));
  select * into j from check_app_private.company_deletions where company_id=p_company;
  if found then
    if j.actor_id<>p_actor then raise exception using errcode='42501',message='Company owner required'; end if;
    return jsonb_build_object('company_id',j.company_id,'name',j.company_name,'pending',true);
  end if;
  select * into c from public.companies where id=p_company for update;
  if not found or not exists(select 1 from public.profiles where id=p_actor and company_id=p_company and role='manager') then
    raise exception using errcode='42501',message='Company owner required';
  end if;
  select array_agg(id) into ids from public.profiles where company_id=p_company;
  -- Refuse legacy cross-company references before a cascade can affect another tenant.
  for fk in select s.relname src,d.relname dst,sa.attname src_col,da.attname dst_col
    from pg_catalog.pg_constraint f join pg_catalog.pg_class s on s.oid=f.conrelid join pg_catalog.pg_class d on d.oid=f.confrelid
    join pg_catalog.pg_namespace sn on sn.oid=s.relnamespace join pg_catalog.pg_namespace dn on dn.oid=d.relnamespace
    join pg_catalog.pg_attribute sa on sa.attrelid=s.oid and sa.attnum=f.conkey[1]
    join pg_catalog.pg_attribute da on da.attrelid=d.oid and da.attnum=f.confkey[1]
    where f.contype='f' and sn.nspname='public' and dn.nspname='public' and cardinality(f.conkey)=1
      and exists(select 1 from pg_catalog.pg_attribute where attrelid=s.oid and attname='company_id' and not attisdropped)
      and exists(select 1 from pg_catalog.pg_attribute where attrelid=d.oid and attname='company_id' and not attisdropped)
  loop
    execute format('select exists(select 1 from public.%I s join public.%I d on s.%I=d.%I where s.company_id<>d.company_id and (s.company_id=$1 or d.company_id=$1))',fk.src,fk.dst,fk.src_col,fk.dst_col) into inconsistent using p_company;
    if inconsistent then raise exception using errcode='23514',message='Cross-company references require review before deletion'; end if;
  end loop;
  if exists(select 1 from storage.objects where owner_id=any(ids::text[]) and split_part(name,'/',1)<>p_company::text) then
    raise exception using errcode='23514',message='Account owns files outside this company';
  end if;
  insert into check_app_private.company_deletions(company_id,actor_id,company_name,user_ids) values(p_company,p_actor,c.name,ids);
  update public.companies set deletion_requested_at=now() where id=p_company;
  -- Refresh credentials are revoked; existing JWTs immediately lose data access through the lifecycle gates.
  delete from auth.sessions where user_id=any(ids);
  return jsonb_build_object('company_id',p_company,'name',c.name,'pending',true);
end $$;

create function public.company_deletion_status(p_actor uuid)
returns jsonb language sql security definer set search_path='' as $$
  select case when coalesce(auth.role(),'')='service_role' then
    coalesce((select jsonb_build_object('company_id',company_id,'name',company_name,'pending',true)
      from check_app_private.company_deletions where actor_id=p_actor limit 1),'null'::jsonb) else 'null'::jsonb end;
$$;

create function public.company_deletion_batch(p_actor uuid,p_company uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j check_app_private.company_deletions%rowtype; photos jsonb; users jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Server access required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('delete-company:'||p_company::text,0));
  select * into j from check_app_private.company_deletions where company_id=p_company for update;
  if not found or j.actor_id<>p_actor then raise exception using errcode='42501',message='Deletion request not found'; end if;
  select jsonb_agg(x) into photos from (select bucket_id,name from storage.objects
    where starts_with(name,p_company::text||'/') order by bucket_id,name limit 200) x;
  if photos is not null then return jsonb_build_object('phase','photos','photos',photos); end if;
  -- Files must be removed through Storage API before database rows or Auth users.
  perform 1 from public.companies where id=p_company for update;
  delete from public.one_time_tasks where company_id=p_company;
  delete from public.companies where id=p_company;
  select jsonb_agg(id) into users from (select u.id from auth.users u where u.id=any(j.user_ids) and u.id<>p_actor order by u.id limit 10) x;
  if users is not null then return jsonb_build_object('phase','accounts','users',users,'final',false); end if;
  -- The owner is last; deleting that Auth user also removes the transient job and its ID snapshot.
  return jsonb_build_object('phase','accounts','users',jsonb_build_array(p_actor),'final',true);
end $$;
revoke all on function public.begin_company_deletion(uuid,uuid,text),public.company_deletion_status(uuid),public.company_deletion_batch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_company_deletion(uuid,uuid,text),public.company_deletion_status(uuid),public.company_deletion_batch(uuid,uuid) to service_role;
