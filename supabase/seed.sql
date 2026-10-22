-- HaloX Seed Data (S2)
insert into public.profiles (id, email, full_name)
values
  ('00000000-0000-4000-8000-000000000001', 'demo@halox.local', 'HaloX 데모 관리자'),
  ('00000000-0000-4000-8000-000000000002', 'other@halox.local', '외부 테넌트 사용자')
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, owner_id, status, strategy_map_status)
values
  ('11111111-1111-4000-8000-111111111111', '브리찌', 'brizzi', '00000000-0000-4000-8000-000000000001', 'active', 'ready'),
  ('22222222-2222-4000-8000-222222222222', '외부격리워크스페이스', 'isolated-ws', '00000000-0000-4000-8000-000000000002', 'active', 'ready')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('11111111-1111-4000-8000-111111111111', '00000000-0000-4000-8000-000000000001', 'owner'),
  ('22222222-2222-4000-8000-222222222222', '00000000-0000-4000-8000-000000000002', 'owner')
on conflict (workspace_id, user_id) do nothing;

insert into public.workspace_plans (workspace_id, plan, billing_cycle, keyword_limit, prompt_limit, content_limit)
values
  ('11111111-1111-4000-8000-111111111111', 'trial', 'monthly', 20, 20, 5),
  ('22222222-2222-4000-8000-222222222222', 'trial', 'monthly', 20, 20, 5)
on conflict (workspace_id) do nothing;
