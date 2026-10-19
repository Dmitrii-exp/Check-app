-- Apply using the Supabase migration API. No existing orders are modified here.
create schema if not exists check_app_private;
revoke all on schema check_app_private from public, anon, authenticated;

create or replace function public.process_verified_robokassa_payment(p_inv_id bigint, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.payment_orders%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_base timestamptz;
  v_expires timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server access required';
  end if;
  if p_inv_id is null or p_inv_id <= 0 or p_amount is null or p_amount <= 0
     or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception using errcode = '22023', message = 'Invalid payment';
  end if;
  select * into v_order from public.payment_orders where inv_id = p_inv_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Order not found'; end if;
  if v_order.currency <> 'RUB' or v_order.amount <> p_amount then
    raise exception using errcode = '22023', message = 'Payment amount mismatch';
  end if;
  if v_order.status = 'paid' then
    return jsonb_build_object('status', 'already_paid');
  end if;
  -- Serialize different paid orders for the same company, including its first subscription.
  perform 1 from public.companies where id = v_order.company_id for update;
  select * into v_subscription from public.subscriptions where company_id = v_order.company_id for update;
  v_base := case when v_subscription.plan_id = v_order.plan_id
    then greatest(v_now, coalesce(v_subscription.expires_at, v_now)) else v_now end;
  v_expires := ((v_base at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  insert into public.subscriptions(company_id, plan_id, started_at, expires_at)
    values (v_order.company_id, v_order.plan_id, v_now, v_expires)
    on conflict (company_id) do update set plan_id = excluded.plan_id,
      started_at = excluded.started_at, expires_at = excluded.expires_at;
  update public.payment_orders set status = 'paid', paid_at = v_now,
    subscription_started_at = v_now, subscription_expires_at = v_expires where id = v_order.id;
  return jsonb_build_object('status', 'paid');
end;
$$;
revoke all on function public.process_verified_robokassa_payment(bigint,numeric) from public,anon,authenticated;
grant execute on function public.process_verified_robokassa_payment(bigint,numeric) to service_role;

-- Only the verified server callback may write orders or paid entitlements.
revoke all on public.payment_orders from anon, authenticated;
grant select on public.payment_orders to authenticated;
revoke all on public.subscriptions, public.super_admins, public.owner_companies from anon, authenticated;
grant select on public.subscriptions, public.super_admins, public.owner_companies to authenticated;
revoke execute on function public.admin_unlimited_expiry(uuid) from public,anon;
grant execute on function public.admin_unlimited_expiry(uuid) to authenticated;
revoke execute on function public.validate_consumable_request() from public,anon,authenticated;
