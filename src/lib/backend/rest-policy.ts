import { DEFAULT_WORKSPACE_ID, RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';

const READ_ONLY = new Set(['profiles', 'plan_templates', 'plan_unit_limits', 'welcome_guide_config', 'welcome_guide_settings', 'system_settings', 'workspace_plans', 'usage_reservations']);
const ADMIN_TABLES = new Set(['workspace_members', 'workspace_invitations', 'workspace_api_keys']);
const WORKSPACE_FIELDS = new Set(['name', 'description', 'default_brand_filter', 'slug', 'settings', 'auto_generate_prompts']);
const PROFILE_FIELDS = new Set(['full_name']);

/** Public REST writes have narrower privileges than server-side pipelines. */
export function assertRestWrite(db: HaloXDatabase, table: string, method: 'POST' | 'PATCH' | 'DELETE', actor: string, payload?: Row | Row[], filters: Record<string, string> = {}) {
  db.assertKnownTable(table);
  const items = payload === undefined ? [] : Array.isArray(payload) ? payload : [payload];
  if (method !== 'DELETE' && (!items.length || items.some(row => !row || typeof row !== 'object' || Array.isArray(row)))) throw new Error('Object payload required');
  if (method === 'PATCH' && Array.isArray(payload)) throw new Error('Object patch required');
  if (method !== 'POST' && !Object.entries(filters).some(([key, value]) => !['select', 'order', 'limit', 'offset', 'columns'].includes(key) && value)) {
    throw new Error('수정 또는 삭제할 항목을 선택해 주세요.');
  }
  if (table === 'profiles' && method === 'PATCH') {
    if (Object.keys(items[0]).some(key => !PROFILE_FIELDS.has(key)) || typeof items[0].full_name !== 'string' || !items[0].full_name.trim() || items[0].full_name.length > 100) {
      throw new Error('이름은 1~100자로 입력해 주세요. 인증 정보는 이 API로 변경할 수 없습니다.');
    }
    return;
  }
  if (READ_ONLY.has(table)) throw new RlsAccessDeniedError('This table cannot be changed through the public REST API');
  if (table === 'workspaces') {
    if (items.some(row => Object.keys(row).some(key => !WORKSPACE_FIELDS.has(key)))) throw new Error('변경할 수 없는 워크스페이스 필드입니다.');
    if (items.some(row => 'name' in row && (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100))) throw new Error('워크스페이스 이름은 1~100자로 입력해 주세요.');
    if (method === 'POST') return;
  }
  if (!ADMIN_TABLES.has(table) && table !== 'workspaces') return;
  const targetRows = method === 'POST' ? items : db.queryTable(table, { filters }, actor).data;
  for (const row of targetRows) {
    const workspaceId = table === 'workspaces' ? String(row.id) : String(row.workspace_id || DEFAULT_WORKSPACE_ID);
    const members = db.queryTable('workspace_members', { filters: { workspace_id: `eq.${workspaceId}`, user_id: `eq.${actor}` } }, actor).data;
    const role = members[0]?.role;
    if (role !== 'owner' && role !== 'admin') throw new RlsAccessDeniedError('Workspace administrator permission is required');
    if (table === 'workspaces' && method === 'DELETE' && role !== 'owner') throw new RlsAccessDeniedError('Only the workspace owner may delete it');
    if (table === 'workspace_members' && (row.role === 'owner' || items.some(item => item.role === 'owner'))) throw new RlsAccessDeniedError('Owner membership cannot be changed through this API');
  }
  if (table === 'workspace_members' && method === 'PATCH' && items.some(row => Object.keys(row).some(key => !['role', 'allowed_sections'].includes(key)))) throw new Error('멤버 권한만 변경할 수 있습니다.');
  if (table === 'workspace_members' && items.some(row => 'role' in row && !['admin', 'member'].includes(String(row.role)))) throw new Error('유효하지 않은 멤버 권한입니다.');
  if (table === 'workspace_api_keys' && method === 'PATCH' && items.some(row => Object.keys(row).some(key => !['name', 'revoked_at'].includes(key)))) throw new Error('API 키의 이름 또는 폐기 상태만 변경할 수 있습니다.');
  if (table === 'workspace_api_keys' && method === 'POST' && items.some(row => Object.keys(row).some(key => !['workspace_id', 'name', 'scopes', 'expires_at'].includes(key)))) throw new Error('API 키 비밀값은 서버에서 생성합니다.');
}
