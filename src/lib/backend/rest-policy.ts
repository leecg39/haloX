import { DEFAULT_WORKSPACE_ID, RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { KEYWORD_EDITABLE_FIELDS } from './keyword-model.ts';
import { GEO_EDITABLE_FIELDS, GEO_RESULT_TABLES } from './geo-model.ts';
import { LIBRARY_EDITABLE_FIELDS } from './library-model.ts';

const READ_ONLY = new Set(['profiles', 'plan_templates', 'plan_unit_limits', 'welcome_guide_config', 'welcome_guide_settings', 'system_settings', 'workspace_plans', 'usage_reservations', 'serp_snapshots']);
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
  if (['export_history', 'export_destinations', 'article_translations', 'export_publications', 'translation_runs'].includes(table)) throw new RlsAccessDeniedError('내보내기와 번역문은 전용 서버 작업으로만 변경합니다.');
  if (['site_audit_targets', 'site_audit_scans', 'site_audit_pages', 'site_audit_issues'].includes(table)) throw new RlsAccessDeniedError('사이트 진단은 전용 서버 작업으로만 변경합니다.');
  if (['keyword_clusters', 'keyword_cluster_members', 'keyword_cluster_links', 'cluster_stats_history', 'cluster_batch_runs'].includes(table)) throw new RlsAccessDeniedError('전략맵은 전용 서버 작업으로만 변경합니다.');
  if (['raw_import_batches', 'dashboard_preferences', 'monitor_rules', 'geo_alerts', 'workspace_events', 'report_snapshots', 'report_summaries', 'report_action_items', 'report_preferences', 'saved_analyses'].includes(table)) throw new RlsAccessDeniedError('저장 분석은 전용 서버 작업으로만 변경합니다.');
  if (['geo_prompt_candidates', 'opportunity_decisions'].includes(table)) throw new RlsAccessDeniedError('기회 후보와 판단 기록은 전용 서버 작업으로만 변경합니다.');
  if (READ_ONLY.has(table)) throw new RlsAccessDeniedError('This table cannot be changed through the public REST API');
  if (table === 'content_jobs' && items.some(row => 'generation_context' in row)) throw new RlsAccessDeniedError('생성 당시 참조 자료는 서버 작업으로만 저장합니다.');
  if (['content_jobs', 'content_drafts', 'content_compositions'].includes(table)) throw new RlsAccessDeniedError('콘텐츠는 버전 관리 서버 작업으로만 변경합니다.');
  if (['content_review_runs', 'content_change_items'].includes(table)) throw new RlsAccessDeniedError('최적화는 검토 서버 작업으로만 변경합니다.');
  if (LIBRARY_EDITABLE_FIELDS[table]) {
    const allowed = [...LIBRARY_EDITABLE_FIELDS[table], ...(method === 'POST' ? ['workspace_id'] : [])];
    if (items.some(row => Object.keys(row).some(key => !allowed.includes(key)))) throw new Error('변경할 수 없는 자료 필드입니다.');
    if (table === 'knowledge_entity_sources' && method === 'POST' && items.some(row => row.source_type === 'file')) throw new Error('파일 업로드 기능으로 등록해 주세요.');
  }
  if (GEO_RESULT_TABLES.includes(table) && !(table === 'geo_prompt_runs' && method === 'DELETE')) throw new RlsAccessDeniedError('실행 결과는 서버에서만 생성하거나 변경할 수 있습니다.');
  if (GEO_EDITABLE_FIELDS[table]) {
    const allowed = [...GEO_EDITABLE_FIELDS[table], ...(method === 'POST' ? ['workspace_id'] : [])];
    if (items.some(row => Object.keys(row).some(key => !allowed.includes(key)))) throw new Error('변경할 수 없는 프롬프트 필드입니다.');
    if (table === 'geo_prompts' && method === 'POST') throw new Error('프롬프트 추가 기능으로 등록해 주세요.');
  }
  if (KEYWORD_EDITABLE_FIELDS[table]) {
    const allowed = [...KEYWORD_EDITABLE_FIELDS[table], ...(method === 'POST' ? ['workspace_id'] : [])];
    if (items.some(row => Object.keys(row).some(key => !allowed.includes(key)))) throw new Error('변경할 수 없는 필드입니다. 측정 지표는 수집을 통해 갱신됩니다.');
    if (table === 'keywords' && method === 'POST') throw new Error('키워드 추가 기능으로 등록해 주세요.');
  }
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
