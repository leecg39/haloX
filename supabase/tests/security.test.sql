-- Security regression tests for tenant isolation (run against a migrated + seeded DB).
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/security.test.sql
-- Any failed assertion raises an exception, so psql exits non-zero.
-- Seed users: A = ...0001 (member of ws 1111...), B = ...0002 (member of ws 2222...).
-- All changes are rolled back.

begin;

-- 1. profiles must have RLS enabled
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    raise exception 'FAIL profiles: row level security is disabled';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

-- 2. user A sees only their own profile
do $$
declare n integer;
begin
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL profiles: user A sees % profiles, expected 1', n; end if;
end $$;

-- 3. user A cannot update user B's profile
do $$
declare n integer;
begin
  with u as (
    update public.profiles set full_name = 'x'
    where id = '00000000-0000-4000-8000-000000000002' returning 1
  ) select count(*) into n from u;
  if n <> 0 then raise exception 'FAIL profiles: user A updated % foreign profile rows', n; end if;
end $$;

-- 4. user A cannot reserve quota in workspace B
do $$
begin
  perform public.reserve_unit_with_bypass('22222222-2222-4000-8000-222222222222', 'keywords', 1, 'sec-test-foreign');
  raise exception 'FAIL reserve: user A reserved quota in a foreign workspace';
exception when insufficient_privilege then null;
end $$;

-- 5. user A can reserve quota in their own workspace (keep id for later steps)
select (public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'keywords', 1, 'sec-test-own')
        ->> 'reservation_id') as own_reservation_id \gset

-- 6. user B cannot commit or release user A's reservation
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select set_config('sec.res_id', :'own_reservation_id', true);
do $$
begin
  perform public.commit_reservation(current_setting('sec.res_id')::uuid);
  raise exception 'FAIL commit: user B committed a foreign reservation';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.release_reservation(current_setting('sec.res_id')::uuid);
  raise exception 'FAIL release: user B released a foreign reservation';
exception when insufficient_privilege then null;
end $$;

-- 7. user A can commit their own reservation
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
begin
  if not coalesce(public.commit_reservation(current_setting('sec.res_id')::uuid), false) then
    raise exception 'FAIL commit: owner could not commit own reservation';
  end if;
end $$;

-- 8. a request without a user (anonymous) cannot reserve quota
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  perform public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'keywords', 1, 'sec-test-anon');
  raise exception 'FAIL reserve: anonymous request reserved quota';
exception when insufficient_privilege then null;
end $$;

-- 9. server-side calls (service_role claim, no user) are still allowed
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  perform public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'keywords', 1, 'sec-test-service');
end $$;

select 'security tests passed' as result;
rollback;
