-- Match the original client contract for the quota RPCs (REA E1-4):
--   reserve_unit_with_bypass(_workspace_id, _unit_key, _amount, _idempotency_key)
--     returns rows (success, reservation_id, error_code, message, remaining); the client reads
--     data[0].success and data[0].error_code === 'QUOTA_EXCEEDED' instead of catching an error.
--   commit_reservation(_reservation_id), release_reservation(_reservation_id)
-- PostgREST maps JSON keys to argument names, so the p_* signatures could not serve
-- the original client. Access violations still raise (insufficient_privilege) so that
-- foreign workspaces cannot be probed through result rows.
-- Verified by supabase/tests/original-rpc-contract.test.sql.

drop function if exists public.reserve_unit_with_bypass(uuid, text, integer, text);
drop function if exists public.commit_reservation(uuid);
drop function if exists public.release_reservation(uuid);

create function public.reserve_unit_with_bypass(
  _workspace_id uuid,
  _unit_key text,
  _amount integer,
  _idempotency_key text
) returns table (
  success boolean,
  reservation_id uuid,
  error_code text,
  message text,
  remaining integer
)
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
  perform public.assert_workspace_access(_workspace_id);

  if _amount is null or _amount <= 0 then
    return query select false, null::uuid, 'INVALID_AMOUNT'::text,
      format('amount must be a positive integer (got %s)', _amount), null::integer;
    return;
  end if;

  v_unit := public.normalize_quota_unit(_unit_key);
  if v_unit is null then
    return query select false, null::uuid, 'UNKNOWN_QUOTA_UNIT'::text,
      format('unknown quota unit "%s"', _unit_key), null::integer;
    return;
  end if;

  select * into v_existing
  from public.usage_reservations ur
  where ur.idempotency_key = _idempotency_key
    and ur.workspace_id = _workspace_id;
  if found then
    return query select true, v_existing.id, null::text, 'idempotent replay'::text, null::integer;
    return;
  end if;

  select case v_unit
    when 'keyword_create' then wp.keyword_limit
    when 'prompt_create' then wp.prompt_limit
    when 'content_gen' then wp.content_limit
    else null -- site_audit_scan has no plan column; default below (inferred)
  end into v_limit
  from public.workspace_plans wp
  where wp.workspace_id = _workspace_id;

  v_limit := coalesce(v_limit, case v_unit when 'content_gen' then 5 else 20 end);

  select coalesce(sum(ur.amount), 0) into v_used
  from public.usage_reservations ur
  where ur.workspace_id = _workspace_id
    and ur.unit_key = v_unit
    and ur.status in ('reserved', 'committed');

  if (v_used + _amount) > v_limit then
    return query select false, null::uuid, 'QUOTA_EXCEEDED'::text,
      format('unit %s limit %s exceeded (used %s, requested %s)', v_unit, v_limit, v_used, _amount),
      greatest(v_limit - v_used, 0);
    return;
  end if;

  insert into public.usage_reservations (workspace_id, unit_key, amount, idempotency_key, status)
  values (_workspace_id, v_unit, _amount, _idempotency_key, 'reserved')
  returning id into v_res_id;

  return query select true, v_res_id, null::text, null::text, v_limit - (v_used + _amount);
end;
$$;

create function public.commit_reservation(_reservation_id uuid)
returns boolean
language sql
security definer
as $$
  select public.set_reservation_status(_reservation_id, 'committed');
$$;

create function public.release_reservation(_reservation_id uuid)
returns boolean
language sql
security definer
as $$
  select public.set_reservation_status(_reservation_id, 'released');
$$;
