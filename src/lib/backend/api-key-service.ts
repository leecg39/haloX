import crypto from 'node:crypto';
import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { contentText } from './content-model.ts';
import { API_DEFAULT_LIMITS, API_WORKSPACE_LIMITS, API_READ_SCOPES, ApiKeyError, apiKeyFields, apiKeyRevision, apiLimits, compatibleApiKey, keyState } from './api-key-model.ts';
export type ApiPrivateCollection = 'api_key_issue_requests' | 'api_key_usage' | 'api_tool_requests';
export const apiWhere = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id === undefined ? {} : { id: `eq.${id}` }) });
export function apiManager(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'other', 'write');
  const permission = db.workspacePermissions(workspace, actor);
  if (!['owner', 'admin'].includes(permission.role) || permission.role !== 'owner' && !permission.allowed_sections.includes('all')) throw new RlsAccessDeniedError('API 키 관리는 전체 메뉴 권한이 있는 소유자 또는 관리자만 할 수 있습니다.');
}
export function workspaceApiLimits(db: HaloXDatabase, workspace: string, actor: string) {
  return db.queryTable('workspace_api_limits', { filters: apiWhere(workspace) }, actor).data[0] || { ...API_WORKSPACE_LIMITS, workspace_id: workspace, revision: 0 };
}
export function readApiSettings(db: HaloXDatabase, workspace: string, actor: string, now = Date.now()) {
  db.assertWorkspaceAccess(workspace, actor, 'other'); const permission = db.workspacePermissions(workspace, actor);
  const keys = db.queryTable('workspace_api_keys', { filters: apiWhere(workspace) }, actor).data.map((row): Row => ({ ...compatibleApiKey(row), state: keyState(row, now), issuer_active: db.apiKeyIssuerActive(row) })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const usage = db.getServerRecords('api_key_usage').filter(row => row.workspace_id === workspace && String(row.day) >= new Date(now - 89 * 86400000).toISOString().slice(0, 10)).map(({ minute_count: _count, minute: _minute, ...row }) => row).sort((a, b) => String(b.day).localeCompare(String(a.day)));
  return { keys, usage, limits: workspaceApiLimits(db, workspace, actor), editable: permission.role === 'owner' || permission.role === 'admin' && permission.allowed_sections.includes('all'), today: new Date(now).toISOString().slice(0, 10) };
}
export function runApiKeyCommand(db: HaloXDatabase, actor: string, payload: Row, now = Date.now()): Row {
  const workspace = contentText(payload.workspace_id, '워크스페이스', 100, true); apiManager(db, workspace, actor);
  const action = payload.action;
  if (action === 'limits-update' || action === 'limits-reset') {
    const old = workspaceApiLimits(db, workspace, actor); apiKeyRevision(old, payload.expected_revision);
    const values = { ...(action === 'limits-reset' ? API_WORKSPACE_LIMITS : apiLimits(payload)), revision: Number(old.revision || 0) + 1 };
    const limits = old.id ? db.updateTable('workspace_api_limits', values, apiWhere(workspace, old.id), actor)[0] : db.insertTable('workspace_api_limits', { ...values, workspace_id: workspace }, actor)[0];
    return { ok: true, limits };
  }
  const keys = db.queryTable('workspace_api_keys', { filters: apiWhere(workspace) }, actor).data;
  if (action === 'key-create') {
    const request = contentText(payload.request_id, '발급 요청 키', 100, true);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(['name', 'scopes', 'expires_at', 'requests_per_minute', 'requests_per_day'].map(field => [field, payload[field] ?? null])))).digest('hex');
    const receipts = db.getServerRecords('api_key_issue_requests'), receipt = receipts.find(row => row.workspace_id === workspace && row.request_id === request);
    if (receipt) { if (receipt.fingerprint !== fingerprint) throw new ApiKeyError('동일 발급 요청 키의 입력이 변경되었습니다. 창을 닫고 새 요청으로 발급해 주세요.', 409); if (receipt.actor !== actor) throw new ApiKeyError('다른 사용자의 발급 요청입니다.', 409); return { ok: true, key: keys.find(row => row.id === receipt.key_id) || null, replayed: true, secret: null }; }
    if (keys.filter(row => keyState(row, now) === 'active').length >= 50 || keys.length >= 500) throw new ApiKeyError('활성 키 50개·보관 키 500개 한도입니다. 사용하지 않는 키를 폐기·삭제해 주세요.');
    const values = apiKeyFields({ ...API_DEFAULT_LIMITS, scopes: API_READ_SCOPES, expires_at: new Date(now + 90 * 86400000).toISOString(), ...payload }, now);
    if (keys.some(row => keyState(row, now) === 'active' && String(row.name).normalize('NFKC').toLowerCase() === values.name.normalize('NFKC').toLowerCase())) throw new ApiKeyError('같은 이름의 활성 API 키가 있습니다.');
    const { raw_key: secret, ...key } = db.insertTable('workspace_api_keys', { ...values, workspace_id: workspace, revision: 1 }, actor)[0];
    db.setServerRecords('api_key_issue_requests', [...receipts, { workspace_id: workspace, request_id: request, fingerprint, actor, key_id: key.id }]);
    return { ok: true, key, secret };
  }
  const row = keys.find(key => key.id === payload.id); if (!row) throw new ApiKeyError('현재 워크스페이스에서 API 키를 찾을 수 없습니다.', 404);
  apiKeyRevision(row, payload.expected_revision);
  if (action === 'key-delete') {
    if (keyState(row, now) === 'active') throw new ApiKeyError('활성 키는 먼저 폐기해 주세요.');
    db.deleteTable('workspace_api_keys', apiWhere(workspace, row.id), actor);
    db.setServerRecords('api_tool_requests', db.getServerRecords('api_tool_requests').filter(item => item.key_id !== row.id));
    return { ok: true };
  }
  if (action === 'key-revoke') {
    if (!row.revoked_at) db.updateTable('workspace_api_keys', { revoked_at: new Date(now).toISOString(), revision: Number(row.revision || 0) + 1 }, apiWhere(workspace, row.id), actor);
    return { ok: true };
  }
  if (action !== 'key-update') throw new ApiKeyError('지원하지 않는 API 키 작업입니다.');
  if (keyState(row, now) !== 'active') throw new ApiKeyError('폐기되거나 만료된 키는 다시 활성화할 수 없습니다. 새 키를 발급해 주세요.');
  const fields = Object.fromEntries(['name', 'scopes', 'expires_at', 'requests_per_minute', 'requests_per_day'].filter(key => key in payload).map(key => [key, payload[key]]));
  const values = apiKeyFields({ ...compatibleApiKey(row), ...fields }, now);
  if (keys.some(key => key.id !== row.id && keyState(key, now) === 'active' && String(key.name).normalize('NFKC').toLowerCase() === values.name.normalize('NFKC').toLowerCase())) throw new ApiKeyError('같은 이름의 활성 API 키가 있습니다.');
  return { ok: true, key: db.updateTable('workspace_api_keys', { ...values, revision: Number(row.revision || 0) + 1 }, apiWhere(workspace, row.id), actor)[0] };
}
