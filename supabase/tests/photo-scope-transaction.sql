-- Run after the migration on a disposable database. All fixtures roll back.
begin;
do $$
begin
  if current_setting('techcontrol.allow_fixture', true) is distinct from 'on' then
    raise exception 'Enable techcontrol.allow_fixture only on a disposable test database';
  end if;
end $$;
create temporary table photo_fixture(k text primary key, id uuid not null default gen_random_uuid());
insert into photo_fixture(k) select unnest(array['company','other_company','dep_a','dep_b','other_dep',
  'lead_a','lead_b','other_lead','equipment_a','equipment_b']);
create function pg_temp.id(key text) returns uuid language sql security definer set search_path = ''
as $$ select id from pg_temp.photo_fixture where k = key $$;
create function pg_temp.photo(equipment text, file_name text) returns text language sql
as $$ select pg_temp.id('company')::text || '/' || pg_temp.id(equipment)::text || '/' || file_name || '.jpg' $$;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception '%', label; end if;
end $$;

insert into auth.users(id,aud,role,email)
select id,'authenticated','authenticated',id::text||'@example.invalid' from photo_fixture where k in ('lead_a','lead_b','other_lead');
insert into public.companies(id,name) values (pg_temp.id('company'),'Photo fixture'),(pg_temp.id('other_company'),'Other fixture');
insert into public.departments(id,company_id,name,invite_code,created_at) values
  (pg_temp.id('dep_a'),pg_temp.id('company'),'A',pg_temp.id('dep_a')::text,now()-interval '1 day'),
  (pg_temp.id('dep_b'),pg_temp.id('company'),'B',pg_temp.id('dep_b')::text,now()),
  (pg_temp.id('other_dep'),pg_temp.id('other_company'),'Other',pg_temp.id('other_dep')::text,now());
insert into public.profiles(id,company_id,department_id,name,role) values
  (pg_temp.id('lead_a'),pg_temp.id('company'),pg_temp.id('dep_a'),'Lead A','responsible'),
  (pg_temp.id('lead_b'),pg_temp.id('company'),pg_temp.id('dep_b'),'Lead B','responsible'),
  (pg_temp.id('other_lead'),pg_temp.id('other_company'),pg_temp.id('other_dep'),'Other Lead','responsible');
insert into public.subscriptions(company_id,plan_id) values
  (pg_temp.id('company'),'free'),(pg_temp.id('other_company'),'free');
insert into public.equipment(id,company_id,department_id,name,photo_path) values
  (pg_temp.id('equipment_a'),pg_temp.id('company'),pg_temp.id('dep_a'),'Equipment A',pg_temp.photo('equipment_a','a')),
  (pg_temp.id('equipment_b'),pg_temp.id('company'),pg_temp.id('dep_b'),'Equipment B',pg_temp.photo('equipment_b','b'));
insert into storage.objects(bucket_id,name,owner_id) values
  ('equipment-photos',pg_temp.photo('equipment_a','a'),pg_temp.id('lead_b')::text),
  ('equipment-photos',pg_temp.photo('equipment_b','b'),pg_temp.id('lead_b')::text),
  ('equipment-photos',pg_temp.photo('equipment_a','replacement'),pg_temp.id('lead_a')::text);

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('lead_b')::text,true);
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.id('lead_b'),'role','authenticated')::text,true);
select pg_temp.assert_true(
  exists(select 1 from storage.objects where bucket_id='equipment-photos' and name=pg_temp.photo('equipment_b','b'))
  and not exists(select 1 from storage.objects where bucket_id='equipment-photos' and name=pg_temp.photo('equipment_a','a')),
  'photo visibility follows current department even for the original uploader'
);

select set_config('request.jwt.claim.sub',pg_temp.id('lead_a')::text,true);
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.id('lead_a'),'role','authenticated')::text,true);
select pg_temp.assert_true(
  exists(select 1 from storage.objects where bucket_id='equipment-photos' and name=pg_temp.photo('equipment_a','a'))
  and not exists(select 1 from storage.objects where bucket_id='equipment-photos' and name=pg_temp.photo('equipment_b','b')),
  'known photo path from another department stays hidden'
);
do $$
begin
  update public.equipment set photo_path=pg_temp.photo('equipment_b','b') where id=pg_temp.id('equipment_a');
  raise exception 'foreign path attachment was accepted';
exception when insufficient_privilege then
  if sqlerrm <> 'Photo must be uploaded for this record by the current user' then raise; end if;
end $$;
update public.equipment set photo_path=pg_temp.photo('equipment_a','replacement') where id=pg_temp.id('equipment_a');
select pg_temp.assert_true(
  exists(select 1 from public.equipment where id=pg_temp.id('equipment_a') and photo_path=pg_temp.photo('equipment_a','replacement'))
  and exists(select 1 from storage.objects where bucket_id='equipment-photos' and name=pg_temp.photo('equipment_a','replacement')),
  'legitimate replacement can be attached and read'
);

select set_config('request.jwt.claim.sub',pg_temp.id('other_lead')::text,true);
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.id('other_lead'),'role','authenticated')::text,true);
select pg_temp.assert_true(
  not exists(select 1 from storage.objects where bucket_id='equipment-photos' and name=pg_temp.photo('equipment_a','replacement')),
  'photo is invisible to an actor from another company'
);
rollback;
