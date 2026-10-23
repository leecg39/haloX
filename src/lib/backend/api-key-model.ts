import type { Row } from './database.ts';
import { contentText } from './content-model.ts';

export const API_SCOPE_GROUPS = [
  { id: 'workspace', label: '워크스페이스 정보', actions: ['read', 'write', 'delete'] },
  { id: 'geo', label: 'GEO 지표·실행', actions: ['read', 'write'] },
  { id: 'prompts', label: '프롬프트·런 원본', actions: ['read', 'write', 'delete'] },
  { id: 'seo', label: 'SEO 키워드', actions: ['read', 'write', 'delete'] },
  { id: 'audit', label: '사이트 진단', actions: ['read'] },
  { id: 'content', label: '콘텐츠 제작소', actions: ['read', 'write'] },
  { id: 'knowledge', label: '자료실', actions: ['read', 'write'] },
] as const;
export const API_SCOPES = API_SCOPE_GROUPS.flatMap(group => group.actions.map(action => `${group.id}:${action}`));
export const API_READ_SCOPES = API_SCOPES.filter(scope => scope.endsWith(':read'));
export const API_DEFAULT_LIMITS = { requests_per_minute: 60, requests_per_day: 1000 };
export const API_WORKSPACE_LIMITS = { requests_per_minute: 300, requests_per_day: 10000 };
export class ApiKeyError extends Error {
  status: number; code: string; retryAfter: number;
  constructor(message: string, status = 400, code = 'API_KEY_INVALID', retryAfter = 0) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}
export function apiScopes(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > API_SCOPES.length || value.some(scope => typeof scope !== 'string' || !API_SCOPES.includes(scope)) || new Set(value).size !== value.length) throw new ApiKeyError('유효한 API 권한을 하나 이상 선택해 주세요.');
  return API_SCOPES.filter(scope => value.includes(scope));
}
export function apiLimits(value: Row) {
  const limits = { requests_per_minute: value.requests_per_minute, requests_per_day: value.requests_per_day };
  for (const [field, max] of [['requests_per_minute', 600], ['requests_per_day', 100000]] as const) if (!Number.isSafeInteger(limits[field]) || Number(limits[field]) < 1 || Number(limits[field]) > max) throw new ApiKeyError(`${field === 'requests_per_minute' ? '분당' : '일일'} 한도는 1~${max}의 정수여야 합니다.`);
  return limits as { requests_per_minute: number; requests_per_day: number };
}
export function apiKeyFields(input: Row, now = Date.now()) {
  const name = contentText(input.name, '키 이름', 100, true), scopes = apiScopes(input.scopes);
  let expires_at: string | null = null;
  if (input.expires_at !== null) {
    if (typeof input.expires_at !== 'string' || !Number.isFinite(Date.parse(input.expires_at)) || Date.parse(input.expires_at) <= now || Date.parse(input.expires_at) > now + 366 * 86400000) throw new ApiKeyError('만료 시각은 현재 이후부터 1년 이내로 지정해 주세요.');
    expires_at = new Date(input.expires_at).toISOString();
  }
  return { name, scopes, expires_at, ...apiLimits(input) };
}
export function keyState(row: Row, now = Date.now()): 'active' | 'expired' | 'revoked' {
  return row.revoked_at ? 'revoked' : row.expires_at && !(Date.parse(String(row.expires_at)) > now) ? 'expired' : 'active';
}
export function compatibleApiKey(row: Row): Row {
  return { ...API_DEFAULT_LIMITS, revision: 0, scopes: API_READ_SCOPES, expires_at: null, revoked_at: null, ...row };
}
export function apiKeyRevision(row: Row, expected: unknown) {
  if (!Number.isSafeInteger(expected) || expected !== Number(row.revision || 0)) throw new ApiKeyError('다른 곳에서 API 설정이 변경되었습니다. 입력은 유지했습니다. 새로고침 후 확인해 주세요.', 409, 'API_KEY_CONFLICT');
}
