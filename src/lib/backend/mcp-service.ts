import { readCollectionDefaults } from './general-settings-service.ts';
import crypto from 'node:crypto';
import { RlsAccessDeniedError, QuotaExceededError, type HaloXDatabase, type Row } from './database.ts';
import { ApiKeyError, API_DEFAULT_LIMITS } from './api-key-model.ts';
import { apiWhere, workspaceApiLimits } from './api-key-service.ts';
import { API_TOOLS, apiToolInput, executeApiTool } from './api-tools.ts';
import { contentText } from './content-model.ts';
export const MCP_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export type McpOutcome = { status: number; body: Row | null; retryAfter?: number };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
const rpc = (id: unknown, result: unknown): Row => ({ jsonrpc: '2.0', id: id ?? null, result });
const failure = (id: unknown, message: string, status: number, code = 'API_ERROR'): McpOutcome => ({ status, body: { jsonrpc: '2.0', id: id ?? null, error: { code: status === 404 ? -32601 : status === 400 ? -32602 : -32000, message, data: { code, status } } } });
/** Consumes budget and records failures in the same transaction. Failed tool writes roll back independently. */
export async function runMcpRequest(db: HaloXDatabase, secret: string, message: Row, now = Date.now()): Promise<McpOutcome> {
  const key = db.verifyWorkspaceApiKey(secret, now);
  if (!key) return failure(message.id, '유효하지 않거나 만료·폐기된 API 키입니다.', 401, 'API_KEY_UNAUTHORIZED');
  const workspace = String(key.workspace_id), actor = String(key.created_by || db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }).data[0]?.owner_id);
  const scopesFor = (tool: typeof API_TOOLS[number]) => tool.name === 'collect_keywords' && readCollectionDefaults(db, workspace, actor).auto_generate_prompts ? [...tool.scopes, 'prompts:write'] : tool.scopes;
  const stamp = new Date(now).toISOString(), day = stamp.slice(0, 10), minute = Math.floor(now / 60000);
  let ledger = db.getServerRecords('api_key_usage').filter(row => String(row.day) >= new Date(now - 89 * 86400000).toISOString().slice(0, 10));
  let entry = ledger.find(row => row.key_id === key.id && row.day === day);
  if (!entry) { entry = { workspace_id: workspace, key_id: key.id, key_name: key.name, key_prefix: key.key_prefix, day, minute, minute_count: 0, calls: 0, success: 0, failed: 0, denied: 0, tools: {} }; ledger.push(entry); }
  if (entry.minute !== minute) { entry.minute = minute; entry.minute_count = 0; }
  const limits = workspaceApiLimits(db, workspace, actor), workspaceToday = ledger.filter(row => row.workspace_id === workspace && row.day === day);
  const minuteTotal = workspaceToday.reduce((sum, row) => sum + (row.minute === minute ? Number(row.minute_count) : 0), 0), dayTotal = workspaceToday.reduce((sum, row) => sum + Number(row.calls), 0);
  const dailyExceeded = Number(entry.calls) >= Number(key.requests_per_day ?? API_DEFAULT_LIMITS.requests_per_day) || dayTotal >= Number(limits.requests_per_day);
  if (dailyExceeded || Number(entry.minute_count) >= Number(key.requests_per_minute ?? API_DEFAULT_LIMITS.requests_per_minute) || minuteTotal >= Number(limits.requests_per_minute)) {
    entry.rate_limited = Number(entry.rate_limited || 0) + 1; db.setServerRecords('api_key_usage', ledger);
    const retry = dailyExceeded ? Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86400000 - now) / 1000) : 60 - Math.floor(now / 1000) % 60;
    return { ...failure(message.id, dailyExceeded ? '일일 API 요청 한도를 초과했습니다.' : '분당 API 요청 한도를 초과했습니다.', 429, 'API_RATE_LIMITED'), retryAfter: retry };
  }
  entry.calls = Number(entry.calls) + 1; entry.minute_count = Number(entry.minute_count) + 1; entry.last_used_at = stamp;
  const name = message.method === 'tools/call' && message.params && typeof message.params === 'object' ? String((message.params as Row).name) : String(message.method);
  const operation = API_TOOLS.some(tool => tool.name === name) || ['initialize', 'ping', 'tools/list', 'notifications/initialized', 'notifications/cancelled'].includes(name) ? name : 'unknown';
  entry.tools = { ...(entry.tools as Row), [operation]: Number((entry.tools as Row)[operation] || 0) + 1 };
  db.setServerRecords('api_key_usage', ledger); db.updateTable('workspace_api_keys', { last_used_at: stamp }, apiWhere(workspace, key.id), actor);
  const admitted = db.exportState();
  try {
    let result: unknown;
    if (message.jsonrpc !== undefined && message.jsonrpc !== '2.0' || !message.method || typeof message.method !== 'string' || message.id !== undefined && !['string', 'number'].includes(typeof message.id)) throw new ApiKeyError('JSON-RPC 요청 형식을 확인해 주세요.');
    if (message.method.startsWith('notifications/')) {
      if (!['notifications/initialized', 'notifications/cancelled'].includes(message.method) || message.id !== undefined) throw new ApiKeyError('지원하지 않는 알림입니다.');
      result = undefined;
    } else if (message.method === 'initialize') {
      const params = message.params as Row | undefined;
      if (!params || typeof params.protocolVersion !== 'string') throw new ApiKeyError('MCP protocolVersion이 필요합니다.');
      result = { protocolVersion: MCP_PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : MCP_PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'halox', version: '1.0.0' } };
    } else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') {
      result = { tools: API_TOOLS.filter(tool => scopesFor(tool).every(scope => (key.scopes as string[]).includes(scope))).map(({ scopes: _scopes, ...tool }) => tool) };
    } else if (message.method === 'tools/call') {
      const params = message.params as Row | undefined;
      const tool = API_TOOLS.find(item => item.name === params?.name);
      if (!tool) throw new ApiKeyError('지원하지 않는 API 도구입니다.', 404);
      if (!scopesFor(tool).every(scope => (key.scopes as string[]).includes(scope))) throw new ApiKeyError('이 키에 해당 도구의 권한이 없습니다.', 403, 'API_SCOPE_DENIED');
      const args = apiToolInput(tool, params?.arguments ?? {}), writes = !tool.annotations.readOnlyHint;
      const request = writes ? contentText(args.request_id, '작업 요청 키', 100, true) : '';
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical({ tool: tool.name, args }))).digest('hex');
      const receipts = db.getServerRecords('api_tool_requests'), receipt = writes && receipts.find(row => row.key_id === key.id && row.request_id === request);
      let data: unknown;
      if (receipt) { if (Array.isArray(receipt.required_scopes) && !receipt.required_scopes.every(scope => (key.scopes as string[]).includes(String(scope)))) throw new ApiKeyError('저장된 결과의 권한이 없습니다.', 403, 'API_SCOPE_DENIED'); if (receipt.fingerprint !== fingerprint) throw new ApiKeyError('동일한 요청 키에 다른 작업을 보낼 수 없습니다.', 409, 'API_REQUEST_CONFLICT'); data = receipt.result; }
      else {
        data = await executeApiTool(db, tool.name, args, workspace, actor, `api:${key.id}:${request}`);
        if (writes && db.getAllowedWorkspaceIds(actor).has(workspace)) db.setServerRecords('api_tool_requests', [...receipts, { workspace_id: workspace, key_id: key.id, request_id: request, fingerprint, required_scopes: scopesFor(tool), result: data }]);
      }
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { data }, data };
    } else throw new ApiKeyError('지원하지 않는 MCP 메서드입니다.', 404);
    if (db.getAllowedWorkspaceIds(actor).has(workspace)) { ledger = db.getServerRecords('api_key_usage'); const current = ledger.find(row => row.key_id === key.id && row.day === day)!; current.success = Number(current.success) + 1; db.setServerRecords('api_key_usage', ledger); }
    return result === undefined ? { status: 202, body: null } : { status: 200, body: rpc(message.id, result) };
  } catch (error) {
    db.restoreState(admitted);
    ledger = db.getServerRecords('api_key_usage'); const current = ledger.find(row => row.key_id === key.id && row.day === day)!;
    const status = error instanceof ApiKeyError ? error.status : error instanceof RlsAccessDeniedError ? 403 : error instanceof QuotaExceededError ? 429 : typeof (error as Row)?.status === 'number' ? Number((error as Row).status) : 400;
    current[status === 403 ? 'denied' : 'failed'] = Number(current[status === 403 ? 'denied' : 'failed']) + 1; db.setServerRecords('api_key_usage', ledger);
    return failure(message.id, error instanceof Error ? error.message : 'API 도구를 실행하지 못했습니다.', status, error instanceof ApiKeyError ? error.code : 'API_TOOL_FAILED');
  }
}
