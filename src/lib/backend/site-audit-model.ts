import { contentText } from './content-model.ts';
import { publicDocumentUrl } from './public-document.ts';
import type { Row } from './database.ts';
import type { AuditScope, AuditTarget } from '../api/site-audit.ts';

function paths(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 30 || value.some(path => typeof path !== 'string')) throw new Error(`${label}: 경로를 최대 30개까지 입력해 주세요.`);
  return [...new Set(value.map((input: string) => {
    const path = input.trim();
    if (!path.startsWith('/') || path.startsWith('//') || /[?#*\\\p{Cc}]/u.test(path) || path.length > 500) throw new Error(`${label}: /로 시작하는 경로 접두어를 입력해 주세요. 와일드카드와 쿼리는 지원하지 않습니다.`);
    try {
      const decoded = decodeURIComponent(new URL(path, 'https://scope.invalid').pathname).normalize('NFC');
      if (decoded.startsWith('//') || /[?#*\\\p{Cc}]/u.test(decoded)) throw new Error('Invalid decoded path');
      return decoded.replace(/\/$/, '') || '/';
    } catch { throw new Error(`${label}: 경로 인코딩을 확인해 주세요.`); }
  }))];
}
export function auditUrl(value: unknown) {
  const input = contentText(value, '진단 URL', 2000, true), url = publicDocumentUrl(input);
  if (url.search || input.includes('#')) throw new Error('진단 URL에 쿼리나 #을 포함할 수 없습니다. 공개 페이지의 경로를 입력해 주세요.');
  return url.href;
}
export function auditInScope(value: string, target: Pick<AuditTarget, 'target_url' | 'scope_rules'>) {
  try {
    const url = publicDocumentUrl(value);
    if (url.origin !== new URL(target.target_url).origin || url.search) return false;
    const path = decodeURIComponent(url.pathname).normalize('NFC'), matches = (prefix: string) => prefix === '/' || path === prefix || path.startsWith(prefix + '/');
    return (!target.scope_rules.include_paths.length || target.scope_rules.include_paths.some(matches)) && !target.scope_rules.exclude_paths.some(matches);
  } catch { return false; }
}
export function validateAuditTarget(input: Row): AuditTarget {
  const scope = input.scope_rules as Row | null;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('수집 범위를 설정해 주세요.');
  const scope_rules: AuditScope = { include_paths: paths(scope.include_paths, '포함 경로'), exclude_paths: paths(scope.exclude_paths, '제외 경로') };
  if (!Number.isSafeInteger(input.max_pages) || Number(input.max_pages) < 1 || Number(input.max_pages) > 100) throw new Error('최대 페이지는 1~100개로 입력해 주세요.');
  if (!Number.isSafeInteger(input.max_depth) || Number(input.max_depth) < 0 || Number(input.max_depth) > 5) throw new Error('탐색 깊이는 0~5로 입력해 주세요.');
  const result = { name: contentText(input.name, '대상 이름', 100, true), target_url: auditUrl(input.target_url), max_pages: Number(input.max_pages), max_depth: Number(input.max_depth), scope_rules };
  if (!auditInScope(result.target_url, result)) throw new Error('시작 URL이 포함 경로에 속하고 제외 경로에 해당하지 않아야 합니다.');
  return result;
}
