-- Run with payment-hardening.sql inserted immediately after BEGIN, or after deployment.
begin;
create temporary table check_payment_fixture as select gen_random_uuid() as company_id, gen_random_uuid() as user_id,
  (900000000000000 + floor(random() * 10000000000000))::bigint as invoice_id;
insert into auth.users(id,aud,role,email) select user_id,'authenticated','authenticated',user_id::text || '@check-test.invalid' from check_payment_fixture;
insert into public.companies(id,name) select company_id,'TRANSACTION-ONLY SECURITY TEST' from check_payment_fixture;
insert into public.payment_orders(company_id,user_id,plan_id,amount,inv_id)
  select company_id,user_id,'lite',490,invoice_id from check_payment_fixture;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare f record; first_expiry timestamptz; second_expiry timestamptz; result jsonb;
begin
  select * into f from check_payment_fixture;
  result := public.process_verified_robokassa_payment(f.invoice_id,490);
  if result->>'status' <> 'paid' then raise exception 'First payment not applied'; end if;
  select expires_at into first_expiry from public.subscriptions where company_id=f.company_id;
  result := public.process_verified_robokassa_payment(f.invoice_id,490);
  select expires_at into second_expiry from public.subscriptions where company_id=f.company_id;
  if result->>'status' <> 'already_paid' or first_expiry is distinct from second_expiry then raise exception 'Duplicate payment extended subscription'; end if;
  begin
    perform public.process_verified_robokassa_payment(f.invoice_id,1);
    raise exception 'Wrong amount was accepted';
  exception when invalid_parameter_value then null; end;
  if has_function_privilege('authenticated','public.process_verified_robokassa_payment(bigint,numeric)','execute') or
     has_function_privilege('anon','public.process_verified_robokassa_payment(bigint,numeric)','execute') then raise exception 'Payment RPC exposed to clients'; end if;
  if has_table_privilege('authenticated','public.subscriptions','UPDATE') or
     has_table_privilege('authenticated','public.super_admins','INSERT') then raise exception 'Entitlements writable by client'; end if;
  if ((timestamp '2026-01-31 12:00:00' + interval '1 month')::date <> date '2026-02-28') then raise exception 'Calendar month arithmetic'; end if;
end $$;
select 'PASS: atomic payment, replay protection, amount check, calendar month and private RPC' as result;
rollback;
