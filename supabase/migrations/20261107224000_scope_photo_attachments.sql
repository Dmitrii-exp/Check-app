begin;

-- Keep the existing upload and deletion rules. Once an object is attached,
-- read authorization follows the attached record, including after a transfer.
create or replace function check_app_private.photo_access(
  p_bucket text, p_name text, p_owner text, p_operation text
) returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  deleting_at timestamptz;
  linked boolean;
  can_read boolean;
begin
  select * into actor from public.profiles where id = auth.uid();
  if not found or actor.company_id is null then return false; end if;
  if p_operation = 'insert' then
    select deletion_requested_at into deleting_at from public.companies where id = actor.company_id for share;
  else
    select deletion_requested_at into deleting_at from public.companies where id = actor.company_id;
  end if;
  if not found or deleting_at is not null then return false; end if;

  if p_operation = 'read' and p_bucket in ('equipment-photos', 'consumable-photos') then
    if split_part(p_name, '/', 1) is distinct from actor.company_id::text then return false; end if;
    if actor.role = 'manager' then return true; end if;

    select count(*) > 0, coalesce(bool_or(allowed), false) into linked, can_read
    from (
      select e.company_id = actor.company_id and e.department_id = actor.department_id as allowed
      from public.equipment e where p_bucket = 'equipment-photos' and e.photo_path = p_name
      union all
      select c.company_id = actor.company_id and c.department_id = actor.department_id
      from public.completions c where p_bucket = 'equipment-photos' and c.photo_path = p_name
      union all
      select t.company_id = actor.company_id and t.department_id = actor.department_id
        and (actor.role = 'responsible' or t.assigned_user_id = actor.id)
      from public.one_time_tasks t where p_bucket = 'equipment-photos' and t.photo_path = p_name
      union all
      select c.company_id = actor.company_id and c.department_id = actor.department_id
      from public.consumable_requests c where p_bucket = 'consumable-photos' and c.photo_path = p_name
    ) links;

    -- An uploader needs access to a new object until the application attaches it.
    if linked then return can_read; end if;
    return coalesce(p_owner = actor.id::text, false);
  end if;

  return check_app_private.photo_access_active_company(
    p_bucket, p_name, case when p_operation = 'insert' then auth.uid()::text else p_owner end, p_operation
  );
end $$;
revoke all on function check_app_private.photo_access(text,text,text,text) from public, anon;
grant execute on function check_app_private.photo_access(text,text,text,text) to authenticated;

-- A user cannot make an unrelated object visible by attaching its path to a
-- row they control. Existing links remain readable under the new access rule.
create function check_app_private.guard_photo_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  bucket text := 'equipment-photos';
  prefix text := new.company_id::text || '/';
  file_name text;
begin
  if new.photo_path is null or auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and new.photo_path is not distinct from old.photo_path then return new; end if;

  case tg_table_name
    when 'equipment' then prefix := prefix || new.id::text || '/';
    when 'consumable_requests' then
      bucket := 'consumable-photos';
      prefix := prefix || new.id::text || '/';
    when 'completions' then prefix := prefix || new.department_id::text || '/' || new.task_id::text || '/';
    when 'one_time_tasks' then prefix := prefix || new.department_id::text || '/one-time/' || new.id::text || '/';
  end case;
  file_name := substr(new.photo_path, length(prefix) + 1);
  if prefix is null or left(new.photo_path, length(prefix)) <> prefix
     or file_name !~ '^[a-zA-Z0-9_-]+[.](jpg|jpeg|png|webp)$'
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = bucket and o.name = new.photo_path and o.owner_id = auth.uid()::text
     ) then
    raise exception 'Photo must be uploaded for this record by the current user' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function check_app_private.guard_photo_attachment() from public, anon, authenticated;

create trigger check_photo_attachment before insert or update of photo_path
  on public.equipment for each row execute function check_app_private.guard_photo_attachment();
create trigger check_photo_attachment before insert or update of photo_path
  on public.completions for each row execute function check_app_private.guard_photo_attachment();
create trigger check_photo_attachment before insert or update of photo_path
  on public.one_time_tasks for each row execute function check_app_private.guard_photo_attachment();
create trigger check_photo_attachment before insert or update of photo_path
  on public.consumable_requests for each row execute function check_app_private.guard_photo_attachment();

commit;
