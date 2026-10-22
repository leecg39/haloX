-- Tenant security fixes found by running the schema on real Postgres (2026-10-23).
-- 1. profiles had RLS disabled: any authenticated user could read every user's email.
--    Align with the TypeScript backend rule (profiles: self only).
-- 2. Quota RPCs are SECURITY DEFINER (bypass RLS) but never checked membership:
--    any user could reserve/commit/release quota of a foreign workspace.
-- Verified by supabase/tests/security.test.sql.

alter table public.profiles enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert with check (id = auth.uid());

-- True for server-side callers (Edge Functions using the service_role key).
create or replace function public.is_service_role_request()
returns boolean
language sql
stable
as $$
  -- coalesce to '' so the result is never NULL (NULL would silently skip the access check).
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

create or replace function public.assert_workspace_access(p_workspace_id uuid)
returns void
language plpgsql
security definer
stable
as $$
begin
  if p_workspace_id is null
     or not (public.is_service_role_request() or public.user_is_workspace_member(p_workspace_id)) then
    raise exception 'permission denied for workspace %', p_workspace_id
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

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
  v_limit integer;
  v_used integer;
  v_existing public.usage_reservations%rowtype;
  v_res_id uuid;
begin
  perform public.assert_workspace_access(p_workspace_id);

  select * into v_existing
  from public.usage_reservations
  where idempotency_key = p_idempotency_key
    and workspace_id = p_workspace_id;
  if found then
    return jsonb_build_object('reservation_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  select case
    when p_unit_key = 'keywords' then keyword_limit
    when p_unit_key = 'prompts' then prompt_limit
    else content_limit
  end into v_limit
  from public.workspace_plans
  where workspace_id = p_workspace_id;

  v_limit := coalesce(v_limit, 20);

  select coalesce(sum(amount), 0) into v_used
  from public.usage_reservations
  where workspace_id = p_workspace_id
    and unit_key = p_unit_key
    and status in ('reserved', 'committed');

  if (v_used + p_amount) > v_limit then
    raise exception 'QUOTA_EXCEEDED: unit % limit % exceeded (used %, requested %)', p_unit_key, v_limit, v_used, p_amount;
  end if;

  insert into public.usage_reservations (workspace_id, unit_key, amount, idempotency_key, status)
  values (p_workspace_id, p_unit_key, p_amount, p_idempotency_key, 'reserved')
  returning id into v_res_id;

  return jsonb_build_object('reservation_id', v_res_id, 'status', 'reserved', 'remaining', v_limit - (v_used + p_amount));
end;
$$;

create or replace function public.set_reservation_status(p_reservation_id uuid, p_status text)
returns boolean
language plpgsql
security definer
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.usage_reservations
  where id = p_reservation_id;

  perform public.assert_workspace_access(v_workspace_id);

  update public.usage_reservations
  set status = p_status, updated_at = now()
  where id = p_reservation_id;
  return found;
end;
$$;

create or replace function public.commit_reservation(p_reservation_id uuid)
returns boolean
language sql
security definer
as $$
  select public.set_reservation_status(p_reservation_id, 'committed');
$$;

create or replace function public.release_reservation(p_reservation_id uuid)
returns boolean
language sql
security definer
as $$
  select public.set_reservation_status(p_reservation_id, 'released');
$$;

-- Internal helpers are not part of the client API surface.
revoke execute on function public.set_reservation_status(uuid, text) from public, anon, authenticated;
revoke execute on function public.assert_workspace_access(uuid) from public, anon, authenticated;
