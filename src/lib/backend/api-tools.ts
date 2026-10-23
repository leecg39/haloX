import type { HaloXDatabase, Row } from './database.ts';
import { ApiKeyError } from './api-key-model.ts';
import { apiWhere } from './api-key-service.ts';
import { runWorkspaceCommand } from './workspace-management.ts';
import { KEYWORD_EDITABLE_FIELDS } from './keyword-model.ts';
import { GEO_EDITABLE_FIELDS } from './geo-model.ts';
import { LIBRARY_EDITABLE_FIELDS } from './library-model.ts';

const string = { type: 'string' }, number = { type: 'integer' }, strings = { type: 'array', items: string }, object = { type: 'object' };
type Tool = { name: string; description: string; scopes: string[]; inputSchema: { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } };
function tool(name: string, description: string, scopes: string[], fields: Record<string, unknown> = {}, required: string[] = []): Tool {
  const write = scopes.some(scope => !scope.endsWith(':read'));
  return { name, description, scopes, inputSchema: { type: 'object', properties: { ...fields, ...(write ? { request_id: { type: 'string', description: '동일 작업 재시도에 재사용하는 고유 요청 키 (최대 100자)' } } : {}) }, required: [...required, ...(write ? ['request_id'] : [])], additionalProperties: false }, annotations: { readOnlyHint: !write, destructiveHint: scopes.some(scope => scope.endsWith(':delete')), idempotentHint: true, openWorldHint: false } };
}
const paging = { limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 } };
export const API_TOOLS = [
  tool('get_workspace', '현재 키에 연결된 워크스페이스 정보와 사용량을 조회합니다.', ['workspace:read']),
  tool('update_workspace', '워크스페이스 이름·설명·브랜드·도메인·슬러그를 수정합니다.', ['workspace:write'], { expected_revision: number, name: string, description: string, brand_name: string, default_brand_filter: string, slug: string }, ['expected_revision']),
  tool('delete_workspace', '워크스페이스와 소속 자료를 영구 삭제합니다. 정확한 이름 확인이 필요합니다.', ['workspace:delete'], { expected_revision: number, confirm_name: string }, ['expected_revision', 'confirm_name']),
  tool('get_avi_overview', '워크스페이스의 저장된 AVI 지표를 조회합니다.', ['geo:read']),
  tool('get_geo_metrics', 'GEO 실행의 저장된 지표를 조회합니다. 답변 원문은 포함하지 않습니다.', ['geo:read'], paging),
  tool('run_geo_prompt', '등록한 프롬프트를 즉시 실행합니다. 현재 수집기는 데모 Provider입니다.', ['geo:write'], { id: string, engines: strings }, ['id']),
  tool('list_prompts', '프롬프트 목록을 조회합니다.', ['prompts:read'], paging),
  tool('get_prompt_runs', '프롬프트의 실행·응답 원문·인용을 조회합니다.', ['prompts:read'], { id: string, ...paging }, ['id']),
  tool('create_prompt', '새 프롬프트를 등록합니다. 실행은 별도 run_geo_prompt로 요청합니다.', ['prompts:write'], { prompt_text: string, prompt_set_id: string, engines: strings, language_code: string, location_code: string }, ['prompt_text']),
  tool('update_prompt', '프롬프트 본문·분류·세트·활성 상태를 수정합니다.', ['prompts:write'], { id: string, updated_at: string, patch: object }, ['id', 'updated_at', 'patch']),
  tool('delete_prompt', '프롬프트와 과거 실행 기록을 영구 삭제합니다.', ['prompts:delete'], { id: string, updated_at: string, confirm: { type: 'boolean', const: true } }, ['id', 'updated_at', 'confirm']),
  tool('list_keywords', 'SEO 키워드 목록을 조회합니다.', ['seo:read'], paging),
  tool('get_keyword_snapshots', '키워드의 저장 SERP 원본을 조회합니다.', ['seo:read'], { id: string, ...paging }, ['id']),
  tool('get_gsc_ga4_kpis', '저장된 GSC/GA4 집계를 조회합니다. 실제 동기화 여부는 출처를 확인하세요.', ['seo:read']),
  tool('collect_keywords', '키워드를 등록하고 즉시 수집합니다. 자동 질문 생성이 켜져 있으면 prompts:write 권한도 필요합니다. 현재 수집기는 데모 Provider입니다.', ['seo:write'], { keywords: strings, keyword_set_id: string, language: string, country: string }, ['keywords']),
  tool('recollect_keyword', '기존 키워드를 다시 수집합니다. 현재 수집기는 데모 Provider입니다.', ['seo:write'], { id: string, updated_at: string }, ['id', 'updated_at']),
  tool('update_keyword', '키워드 텍스트·세트·분류·활성 상태를 수정합니다.', ['seo:write'], { id: string, updated_at: string, patch: object }, ['id', 'updated_at', 'patch']),
  tool('delete_keyword', '키워드와 과거 수집 기록을 영구 삭제합니다.', ['seo:delete'], { id: string, updated_at: string, confirm: { type: 'boolean', const: true } }, ['id', 'updated_at', 'confirm']),
  tool('list_site_audits', '사이트 진단 실행 목록을 조회합니다.', ['audit:read'], paging),
  tool('get_site_audit', '진단의 저장 페이지와 이슈를 조회합니다.', ['audit:read'], { id: string, ...paging }, ['id']),
  tool('list_content', '콘텐츠 제작 작업 목록을 조회합니다.', ['content:read'], paging),
  tool('get_content', '콘텐츠 작업과 본문 버전을 조회합니다.', ['content:read'], { id: string }, ['id']),
  tool('create_content', '직접 작성한 콘텐츠와 첫 버전을 저장합니다.', ['content:write'], { title: string, target_keyword: string, content_md: string, meta_title: string, meta_description: string }, ['title', 'target_keyword', 'content_md']),
  tool('save_content', '콘텐츠를 새 본문 버전으로 저장합니다.', ['content:write'], { id: string, expected_revision: number, title: string, content_md: string, meta_title: string, meta_description: string }, ['id', 'expected_revision', 'title', 'content_md']),
  tool('list_knowledge', '자료실 항목 목록을 조회합니다.', ['knowledge:read'], paging),
  tool('get_knowledge', '자료실의 본문·출처·근거를 조회합니다.', ['knowledge:read'], { id: string }, ['id']),
  tool('create_knowledge', '자료실에 텍스트 자료를 등록합니다.', ['knowledge:write'], { name: string, description: string, body: string, knowledge_type: string, base_url: string }, ['name']),
  tool('update_knowledge', '자료실 항목의 이름·본문·유형을 수정합니다.', ['knowledge:write'], { id: string, updated_at: string, patch: object }, ['id', 'updated_at', 'patch']),
];
export function apiToolInput(tool: Tool, args: unknown): Row {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiKeyError('도구 arguments는 객체여야 합니다.');
  const values = args as Row;
  if (Object.keys(values).some(field => !Object.hasOwn(tool.inputSchema.properties, field))) throw new ApiKeyError('지원하지 않는 도구 입력 필드입니다.');
  for (const field of tool.inputSchema.required) if (!(field in values)) throw new ApiKeyError(`${field} 항목이 필요합니다.`);
  for (const [field, value] of Object.entries(values)) {
    const schema = tool.inputSchema.properties[field] as Row, type = schema.type;
    if (type === 'integer' ? !Number.isSafeInteger(value) : type === 'array' ? !Array.isArray(value) || value.some(item => typeof item !== 'string') : type === 'object' ? !value || typeof value !== 'object' || Array.isArray(value) : typeof value !== type) throw new ApiKeyError(`${field} 형식을 확인해 주세요.`);
    if ('const' in schema && value !== schema.const || typeof value === 'number' && (schema.minimum !== undefined && value < Number(schema.minimum) || schema.maximum !== undefined && value > Number(schema.maximum))) throw new ApiKeyError(`${field} 값을 확인해 주세요.`);
  }
  return values;
}
export async function executeApiTool(db: HaloXDatabase, name: string, args: Row, workspace: string, actor: string, requestKey: string): Promise<unknown> {
  const list = (table: string, filters: Record<string, string> = {}) => db.queryTable(table, { filters: { ...apiWhere(workspace), ...filters }, order: 'created_at.desc', limit: Number(args.limit ?? 20), offset: Number(args.offset ?? 0) }, actor);
  const find = (table: string) => { const row = db.queryTable(table, { filters: apiWhere(workspace, args.id) }, actor).data[0]; if (!row) throw new ApiKeyError('현재 워크스페이스에서 항목을 찾을 수 없습니다.', 404); return row; };
  const stamp = (row: Row) => { if (args.updated_at !== row.updated_at) throw new ApiKeyError('다른 곳에서 항목이 변경되었습니다. 최신 내용을 다시 조회해 주세요.', 409, 'API_CONFLICT'); };
  const patch = (table: string, fields: readonly string[]) => { const row = find(table); stamp(row); const value = args.patch as Row; if (!value || Object.keys(value).some(key => !fields.includes(key))) throw new ApiKeyError('수정할 수 없는 필드입니다.'); return db.updateTable(table, value, apiWhere(workspace, args.id), actor)[0]; };
  const invoke = (command: string, values: Row) => db.invokeEdgeFunction(command, { ...values, workspace_id: workspace, idempotency_key: requestKey }, actor);
  if (name === 'get_workspace') return { workspace: db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0], quota: db.callRpc('get_workspace_quota_summary', { p_workspace_id: workspace }, actor) };
  if (name === 'update_workspace') return runWorkspaceCommand(db, actor, { ...args, action: 'workspace-update', workspace_id: workspace });
  if (name === 'delete_workspace') { const row = db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0]; if (row.owner_id !== actor) throw new ApiKeyError('워크스페이스 삭제는 소유자가 발급한 키만 가능합니다.', 403); if (args.expected_revision !== Number(row.revision || 0)) throw new ApiKeyError('워크스페이스가 변경되었습니다.', 409); if (args.confirm_name !== row.name) throw new ApiKeyError('현재 워크스페이스 이름을 정확히 입력해 주세요.'); db.deleteTable('workspaces', { id: `eq.${workspace}` }, actor); return { deleted_id: workspace }; }
  if (name === 'get_avi_overview') return db.callRpc('get_avi_overview', { p_workspace_id: workspace }, actor);
  if (name === 'get_gsc_ga4_kpis') return db.callRpc('get_ga4_channel_summary', { p_workspace_id: workspace }, actor);
  if (name === 'get_geo_metrics') return list('geo_run_metrics');
  if (name === 'list_prompts') return list('geo_prompts');
  if (name === 'get_prompt_runs') { find('geo_prompts'); const runs = list('geo_prompt_runs', { prompt_id: `eq.${args.id}` }); const ids = runs.data.map(row => row.id); return { ...runs, citations: db.queryTable('geo_citations', { filters: apiWhere(workspace) }, actor).data.filter(row => ids.includes(row.run_id)) }; }
  if (name === 'create_prompt') {
    const reservation = db.callRpc('reserve_unit_with_bypass', { p_workspace_id: workspace, p_unit_key: 'prompt_create', p_amount: 1, p_idempotency_key: requestKey }, actor) as Row;
    const { request_id: _request, ...fields } = args;
    const row = db.insertTable('geo_prompts', { ...fields, workspace_id: workspace, engines: args.engines ?? ['openai'], prompt_category: 'informational', language_code: args.language_code, location_code: args.location_code, is_active: true, is_paused: false }, actor)[0];
    db.callRpc('commit_reservation', { p_reservation_id: reservation.reservation_id }, actor); return row;
  }
  if (name === 'run_geo_prompt') { find('geo_prompts'); const result = await invoke('geo-run', { prompt_id: args.id, engines: args.engines }); return { ok: result.ok, prompt_id: result.prompt_id, runs: (result.results as Row[]).map(item => ({ id: (item.run as Row)?.id, status: (item.run as Row)?.status, metrics: item.metrics })) }; }
  if (name === 'update_prompt') return patch('geo_prompts', GEO_EDITABLE_FIELDS.geo_prompts);
  if (name === 'update_keyword') return patch('keywords', KEYWORD_EDITABLE_FIELDS.keywords);
  if (name === 'delete_prompt' || name === 'delete_keyword') { const table = name === 'delete_prompt' ? 'geo_prompts' : 'keywords'; stamp(find(table)); db.deleteTable(table, apiWhere(workspace, args.id), actor); return { deleted_id: args.id }; }
  if (name === 'list_keywords') return list('keywords');
  if (name === 'get_keyword_snapshots') { find('keywords'); return list('serp_snapshots', { keyword_id: `eq.${args.id}` }); }
  if (name === 'collect_keywords') return invoke('keywords-collect', args);
  if (name === 'recollect_keyword') { stamp(find('keywords')); return invoke('keywords-refresh', { keyword_id: args.id }); }
  if (name === 'list_site_audits') return list('site_audit_scans');
  if (name === 'get_site_audit') return { scan: find('site_audit_scans'), pages: list('site_audit_pages', { scan_id: `eq.${args.id}` }), issues: list('site_audit_issues', { scan_id: `eq.${args.id}` }) };
  if (name === 'list_content') return list('content_jobs');
  if (name === 'get_content') return { job: find('content_jobs'), drafts: db.queryTable('content_drafts', { filters: { ...apiWhere(workspace), content_job_id: `eq.${args.id}` } }, actor).data };
  if (name === 'create_content') return invoke('content-create', args);
  if (name === 'save_content') return invoke('content-save', { ...args, job_id: args.id });
  if (name === 'list_knowledge') return list('knowledge_entities');
  if (name === 'get_knowledge') return { entity: find('knowledge_entities'), sources: db.queryTable('knowledge_entity_sources', { filters: { ...apiWhere(workspace), knowledge_entity_id: `eq.${args.id}` } }, actor).data, evidence: db.queryTable('evidence_contexts', { filters: { ...apiWhere(workspace), knowledge_entity_id: `eq.${args.id}` } }, actor).data };
  if (name === 'create_knowledge') { const { request_id: _request, ...fields } = args; return db.insertTable('knowledge_entities', { ...fields, workspace_id: workspace }, actor)[0]; }
  if (name === 'update_knowledge') return patch('knowledge_entities', LIBRARY_EDITABLE_FIELDS.knowledge_entities);
  throw new ApiKeyError('지원하지 않는 API 도구입니다.', 404);
}
