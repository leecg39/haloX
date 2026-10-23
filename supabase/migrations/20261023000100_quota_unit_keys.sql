-- Align quota unit keys with the original HaloX contract (REA E1-4):
--   keyword_create · prompt_create · content_gen · site_audit_scan
-- Legacy clone keys (keywords · prompts · contents) remain accepted and are normalized.
-- Fixes: original keys fell into the `else content_limit` branch, so keyword_create
-- was charged against the content limit (5). Unknown keys are now rejected.
-- Verified by supabase/tests/quota-units.test.sql.

create or replace function public.normalize_quota_unit(p_unit_key text)
returns text
language plpgsql
immutable
as $$
declare
  v_key text := lower(trim(coalesce(p_unit_key, '')));
begin
  if v_key in ('keyword_create', 'prompt_create', 'content_gen', 'site_audit_scan') then
    return v_key;
  end if;
  return case v_key
    when 'keywords' then 'keyword_create'
    when 'prompts' then 'prompt_create'
    when 'contents' then 'content_gen'
    when 'content' then 'content_gen'
    else null
  end;
end;
$$;

-- Normalize stored rows, then constrain them to the original names.
update public.usage_reservations
set unit_key = public.normalize_quota_unit(unit_key)
where public.normalize_quota_unit(unit_key) is not null
  and unit_key <> public.normalize_quota_unit(unit_key);

alter table public.usage_reservations
  drop constraint if exists usage_reservations_unit_key_check;
alter table public.usage_reservations
  add constraint usage_reservations_unit_key_check
  check (unit_key in ('keyword_create', 'prompt_create', 'content_gen', 'site_audit_scan'));

create or replace function public.reserve_unit_with_bypass(
  p_workspace_id uuid,
  p_unit_key text,
  p_amount integer,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_unit text;
  v_limit integer;
  v_used integer;
  v_existing public.usage_reservations%rowtype;
  v_res_id uuid;
begin
  perform public.assert_workspace_access(p_workspace_id);

  v_unit := public.normalize_quota_unit(p_unit_key);
  if v_unit is null then
    raise exception 'UNKNOWN_QUOTA_UNIT: %', p_unit_key using errcode = 'invalid_parameter_value';
  end if;

  select * into v_existing
  from public.usage_reservations
  where idempotency_key = p_idempotency_key
    and workspace_id = p_workspace_id;
  if found then
    return jsonb_build_object('reservation_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  select case v_unit
    when 'keyword_create' then keyword_limit
    when 'prompt_create' then prompt_limit
    when 'content_gen' then content_limit
    else null -- site_audit_scan has no plan column; default below (inferred)
  end into v_limit
  from public.workspace_plans
  where workspace_id = p_workspace_id;

  v_limit := coalesce(v_limit, case v_unit when 'content_gen' then 5 else 20 end);

  select coalesce(sum(amount), 0) into v_used
  from public.usage_reservations
  where workspace_id = p_workspace_id
    and unit_key = v_unit
    and status in ('reserved', 'committed');

  if (v_used + p_amount) > v_limit then
    raise exception 'QUOTA_EXCEEDED: unit % limit % exceeded (used %, requested %)', v_unit, v_limit, v_used, p_amount;
  end if;

  insert into public.usage_reservations (workspace_id, unit_key, amount, idempotency_key, status)
  values (p_workspace_id, v_unit, p_amount, p_idempotency_key, 'reserved')
  returning id into v_res_id;

  return jsonb_build_object('reservation_id', v_res_id, 'status', 'reserved', 'remaining', v_limit - (v_used + p_amount));
end;
$$;
