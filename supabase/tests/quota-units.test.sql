-- Quota unit compatibility with the original contract (keyword_create · prompt_create ·
-- content_gen · site_audit_scan; legacy keywords · prompts · contents accepted as aliases).
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/quota-units.test.sql
-- Seed: workspace 1111... (user ...0001) has keyword_limit 20, content_limit 5. Rolled back.

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

-- Result rows: (success, reservation_id, error_code, message, remaining)
-- 1. keyword_create is charged against keyword_limit (20), not content_limit (5)
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'keyword_create', 6, 'qu-kw-6');
  if r.success is distinct from true then
    raise exception 'FAIL keyword_create: 6 units rejected (charged to the wrong limit?): %', row_to_json(r);
  end if;
end $$;

-- 2. the original key is stored as-is
do $$
begin
  if (select unit_key from public.usage_reservations where idempotency_key = 'qu-kw-6') <> 'keyword_create' then
    raise exception 'FAIL keyword_create: stored unit key is not keyword_create';
  end if;
end $$;

-- 3. a legacy alias is normalized to the original key
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'keywords', 1, 'qu-legacy');
  if r.success is distinct from true
     or (select unit_key from public.usage_reservations where idempotency_key = 'qu-legacy') <> 'keyword_create' then
    raise exception 'FAIL alias: keywords was not stored as keyword_create';
  end if;
end $$;

-- 4. legacy and original keys share one bucket: 6 + 1 used, 13 left of 20
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'keyword_create', 14, 'qu-over');
  if r.success is distinct from false or r.error_code is distinct from 'QUOTA_EXCEEDED' then
    raise exception 'FAIL shared bucket: expected QUOTA_EXCEEDED, got %', row_to_json(r);
  end if;
  select * into r from public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'keyword_create', 13, 'qu-exact');
  if r.success is distinct from true or r.remaining <> 0 then
    raise exception 'FAIL shared bucket: exact fill rejected, got %', row_to_json(r);
  end if;
end $$;

-- 5. content_gen uses content_limit (5)
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'content_gen', 6, 'qu-content-over');
  if r.success is distinct from false or r.error_code is distinct from 'QUOTA_EXCEEDED' then
    raise exception 'FAIL content_gen: expected QUOTA_EXCEEDED, got %', row_to_json(r);
  end if;
end $$;

-- 6. unknown unit keys are rejected instead of charging a default bucket
do $$
declare r record;
begin
  select * into r from public.reserve_unit_with_bypass('11111111-1111-4000-8000-111111111111', 'credits', 1, 'qu-unknown');
  if r.success is distinct from false or r.error_code is distinct from 'UNKNOWN_QUOTA_UNIT' then
    raise exception 'FAIL unknown unit: got %', row_to_json(r);
  end if;
end $$;

-- 7. stored unit keys are constrained to the original names
do $$
begin
  reset role;
  insert into public.usage_reservations (workspace_id, unit_key, amount, idempotency_key)
  values ('11111111-1111-4000-8000-111111111111', 'keywords', 1, 'qu-direct-legacy');
  raise exception 'FAIL constraint: legacy unit key stored directly';
exception when check_violation then null;
end $$;

select 'quota unit tests passed' as result;
rollback;
