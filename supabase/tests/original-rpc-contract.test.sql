-- Original client contract for the quota RPCs (REA E1-4, KeywordAddDialog and 7 other chunks):
--   rpc("reserve_unit_with_bypass", {_workspace_id, _unit_key, _amount, _idempotency_key})
--     -> rows; client reads data[0].success / .reservation_id / .error_code ('QUOTA_EXCEEDED')
--   rpc("commit_reservation",  {_reservation_id})
--   rpc("release_reservation", {_reservation_id})
-- PostgREST passes JSON keys as named arguments, so the calls below use `name => value`.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/original-rpc-contract.test.sql

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

-- 1. named original arguments are accepted and a success row is returned
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass(
    _workspace_id => '11111111-1111-4000-8000-111111111111', _unit_key => 'keyword_create',
    _amount => 1, _idempotency_key => 'orc-1');
  if r.success is distinct from true or r.reservation_id is null or r.error_code is not null then
    raise exception 'FAIL reserve: expected success row, got %', row_to_json(r);
  end if;
  perform set_config('orc.res_id', r.reservation_id::text, true);
end $$;

-- 2. quota exhaustion is reported as a row (success=false, error_code=QUOTA_EXCEEDED), not raised
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass(
    _workspace_id => '11111111-1111-4000-8000-111111111111', _unit_key => 'keyword_create',
    _amount => 1000, _idempotency_key => 'orc-over');
  if r.success is distinct from false or r.error_code is distinct from 'QUOTA_EXCEEDED' or r.message is null then
    raise exception 'FAIL quota row: expected QUOTA_EXCEEDED row, got %', row_to_json(r);
  end if;
  if exists (select 1 from public.usage_reservations where idempotency_key = 'orc-over') then
    raise exception 'FAIL quota row: rejected reservation was stored';
  end if;
end $$;

-- 3. retrying with the same idempotency key returns the same reservation
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass(
    _workspace_id => '11111111-1111-4000-8000-111111111111', _unit_key => 'keyword_create',
    _amount => 1, _idempotency_key => 'orc-1');
  if r.success is distinct from true or r.reservation_id::text <> current_setting('orc.res_id') then
    raise exception 'FAIL idempotency: got %', row_to_json(r);
  end if;
end $$;

-- 4. commit / release accept _reservation_id
do $$
begin
  if not public.commit_reservation(_reservation_id => current_setting('orc.res_id')::uuid) then
    raise exception 'FAIL commit: _reservation_id not committed';
  end if;
  if (select status from public.usage_reservations where id = current_setting('orc.res_id')::uuid) <> 'committed' then
    raise exception 'FAIL commit: status not committed';
  end if;
end $$;
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass(
    _workspace_id => '11111111-1111-4000-8000-111111111111', _unit_key => 'prompt_create',
    _amount => 1, _idempotency_key => 'orc-rel');
  if not public.release_reservation(_reservation_id => r.reservation_id) then
    raise exception 'FAIL release: _reservation_id not released';
  end if;
end $$;

-- 5. unknown units are reported as a failure row (client shows a generic failure)
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass(
    _workspace_id => '11111111-1111-4000-8000-111111111111', _unit_key => 'credits',
    _amount => 1, _idempotency_key => 'orc-unknown');
  if r.success is distinct from false or r.error_code is distinct from 'UNKNOWN_QUOTA_UNIT' then
    raise exception 'FAIL unknown unit row: got %', row_to_json(r);
  end if;
end $$;

-- 6. the old p_* argument names are gone (single canonical signature)
do $$
begin
  if exists (select 1 from pg_proc p where p.proname = 'reserve_unit_with_bypass'
             and 'p_workspace_id' = any(p.proargnames)) then
    raise exception 'FAIL signature: legacy p_* signature still present';
  end if;
end $$;

select 'original rpc contract tests passed' as result;
rollback;
