import type { HaloXDatabase, Row } from './database.ts';
import { contentText } from './content-model.ts';
import { analysisWhere } from './analysis-model.ts';
import { auditInScope } from './site-audit-model.ts';
import { GEO_ENGINES } from '../api/prompts.ts';
import type { AuditTarget } from '../api/site-audit.ts';
import type { RawKind } from '../api/raw-data.ts';
export const RAW_FILE_LIMIT = 2 * 1024 * 1024;
export type PreparedImport = { kind: Exclude<RawKind, 'monitoring'>; source: { provider: string; url: string }; records: Row[] };
function object(value: unknown, keys: string[], label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label}: 객체 형식 또는 지원 필드를 확인해 주세요.`); return value as Row;
}
function list(value: unknown, label: string, max = 100, min = 0): unknown[] { if (!Array.isArray(value) || value.length > max || value.length < min) throw new Error(`${label}: ${min}~${max}개 배열이어야 합니다.`); return value; }
function number(value: unknown, label: string, max = 100, integer = false): number | null {
  if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || integer && !Number.isSafeInteger(value)) throw new Error(`${label}: 0~${max} ${integer ? '정수' : '숫자'} 또는 null을 입력해 주세요.`); return value;
}
function bool(value: unknown, label: string): boolean | null { if (value === undefined || value === null) return null; if (typeof value !== 'boolean') throw new Error(`${label}: boolean 또는 null이어야 합니다.`); return value; }
export function rawUrl(value: unknown, required = false): string {
  const text = contentText(value, '출처 URL', 2000, required); if (!text) return '';
  try { const url = new URL(text); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); return url.href; } catch { throw new Error('출처는 인증정보 없는 HTTP(S) URL이어야 합니다.'); }
}
function domain(value: unknown, required = false) {
  const result = contentText(value, '도메인', 253, required).toLowerCase(); if (result && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(result)) throw new Error('도메인은 example.com 형식이어야 합니다.'); return result;
}
function at(value: unknown, now: number) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error('측정 시각은 UTC ISO 형식이어야 합니다.');
  const millis = Date.parse(value); if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value.replace(/(?<!\.\d{3})Z$/, '.000Z') || millis > now) throw new Error('실제 날짜의 과거/현재 측정 시각을 입력해 주세요.'); return new Date(millis).toISOString();
}
function locale(row: Row, language: string, country: string) {
  if (typeof row[language] !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(String(row[language])) || typeof row[country] !== 'string' || !/^[A-Z]{2}$/.test(String(row[country]))) throw new Error('측정 당시 언어와 국가 코드를 입력해 주세요.');
  return { [language]: row[language], [country]: row[country] };
}
function reference(db: HaloXDatabase, workspace: string, actor: string, table: string, id: unknown) {
  if (typeof id !== 'string') throw new Error('연결할 항목 ID를 입력해 주세요.'); const row = db.queryTable(table, { filters: analysisWhere(workspace, id) }, actor).data[0]; if (!row || row.deleted_at) throw new Error('연결할 항목이 현재 워크스페이스에 없습니다.'); return row;
}
const strings = (value: unknown, label: string, maxLength: number) => list(value ?? [], label).map(item => contentText(item, label, maxLength, true));
export function parseRawImport(db: HaloXDatabase, workspace: string, actor: string, contents: unknown, now = Date.now()): PreparedImport {
  if (typeof contents !== 'string' || Buffer.byteLength(contents) > RAW_FILE_LIMIT || !contents.trim()) throw new Error('UTF-8 JSON 파일은 2 MiB 이하여야 합니다.');
  let parsed: unknown; try { parsed = JSON.parse(contents.replace(/^\uFEFF/, '')); } catch { throw new Error('JSON 파일 구문을 확인해 주세요.'); }
  const root = object(parsed, ['schema_version', 'kind', 'source', 'records'], '가져오기 파일');
  if (root.schema_version !== 1 || !['seo', 'geo', 'audit'].includes(String(root.kind))) throw new Error('schema_version 1과 seo/geo/audit 종류를 사용해 주세요.');
  const kind = root.kind as PreparedImport['kind'], source = object(root.source, ['provider', 'url'], '출처'), provider = contentText(source.provider, '출처 이름', 80, true).normalize('NFKC').toLowerCase();
  if (provider.startsWith('replace-with-') || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(provider)) throw new Error('출처 이름은 영문 소문자·숫자·점·밑줄·하이픈으로 입력해 주세요.');
  const seen = new Set<string>();
  const records = list(root.records, '측정 기록', 500, 1).map((value, index) => {
    try {
      const row = object(value, kind === 'seo' ? ['source_id', 'keyword_id', 'keyword_text', 'language', 'country', 'engine', 'captured_at', 'search_volume', 'keyword_difficulty', 'top_results', 'ai_overview_detected', 'ai_overview', 'paa_questions', 'related_searches'] : kind === 'geo' ? ['source_id', 'prompt_id', 'prompt_text', 'language_code', 'location_code', 'engine', 'finished_at', 'brand_domain', 'answer_text', 'metrics', 'citations'] : ['source_id', 'target_id', 'completed_at', 'pages'], `기록 ${index + 1}`), source_id = contentText(row.source_id, '원본 식별자', 200, true);
      if (source_id.startsWith('replace-with-')) throw new Error('원본 식별자를 실제 출처의 고유 값으로 교체해 주세요.');
      if (seen.has(source_id)) throw new Error('파일 안에 같은 원본 식별자가 있습니다.'); seen.add(source_id);
      if (kind === 'seo') {
        reference(db, workspace, actor, 'keywords', row.keyword_id); if (!['google', 'naver'].includes(String(row.engine))) throw new Error('검색 엔진은 google 또는 naver입니다.');
        const results = row.top_results === null || row.top_results === undefined ? null : list(row.top_results, '검색 결과', 1000).map(value => { const item = object(value, ['url', 'rank', 'title', 'description'], '검색 결과'), rank = number(item.rank, '순위', 10000, true); if (rank === null || rank === 0) throw new Error('검색 순위는 1 이상의 정수입니다.'); const url = rawUrl(item.url, true); return { url, rank, domain: new URL(url).hostname.toLowerCase(), title: contentText(item.title, '결과 제목', 1000), description: contentText(item.description, '결과 설명', 5000) }; });
        if (results && new Set(results.map(item => `${item.rank}:${item.url}`)).size !== results.length) throw new Error('같은 순위·URL의 검색 결과가 중복되었습니다.');
        const overview = row.ai_overview == null ? null : object(row.ai_overview, ['text', 'cited_domains'], 'AI 요약');
        return { source_id, keyword_id: row.keyword_id, keyword_text: contentText(row.keyword_text, '측정 키워드', 200, true), ...locale(row, 'language', 'country'), engine: row.engine, captured_at: at(row.captured_at, now), search_volume: number(row.search_volume, '검색량', 1e12, true), keyword_difficulty: number(row.keyword_difficulty, '난이도'), top_results_json: results, ai_overview_detected: bool(row.ai_overview_detected, 'AI 요약 감지'), ai_overview_json: overview ? { text: contentText(overview.text, 'AI 요약', 50000), cited_domains: list(overview.cited_domains ?? [], '인용 도메인').map(item => domain(item, true)) } : null, paa_questions_json: strings(row.paa_questions, 'PAA 질문', 2000), related_searches_json: strings(row.related_searches, '연관 검색어', 200) };
      }
      if (kind === 'geo') {
        reference(db, workspace, actor, 'geo_prompts', row.prompt_id); if (!Object.hasOwn(GEO_ENGINES, String(row.engine))) throw new Error('지원하는 GEO 엔진을 선택해 주세요.');
        const m = object(row.metrics ?? {}, ['brand_mentioned', 'is_cited', 'citation_rank_score', 'mention_rank_score'], 'GEO 지표');
        const metrics = { brand_mentioned: bool(m.brand_mentioned, '브랜드 멘션'), is_cited: bool(m.is_cited, '브랜드 인용'), citation_rank_score: number(m.citation_rank_score, '인용 순위 점수'), mention_rank_score: number(m.mention_rank_score, '멘션 순위 점수') };
        const citations = list(row.citations ?? [], '인용 출처', 500).map(value => { const item = object(value, ['url', 'position', 'is_ours', 'is_competitor'], '인용 출처'), position = number(item.position, '출처 위치', 10000, true); if (position === 0) throw new Error('출처 위치는 1 이상의 정수 또는 null입니다.'); return { cited_url: rawUrl(item.url, true), position_index: position, is_ours: bool(item.is_ours, '자사 분류'), is_competitor: bool(item.is_competitor, '경쟁사 분류') }; });
        if (new Set(citations.map(item => item.cited_url)).size !== citations.length) throw new Error('같은 인용 URL이 중복되었습니다.');
        return { source_id, prompt_id: row.prompt_id, prompt_text: contentText(row.prompt_text, '측정 질문', 2000, true), ...locale(row, 'language_code', 'location_code'), engine: row.engine, finished_at: at(row.finished_at, now), brand_domain: domain(row.brand_domain), answer_text: contentText(row.answer_text, '응답 원문', 100000, true, true), metrics, citations };
      }
      const target = reference(db, workspace, actor, 'site_audit_targets', row.target_id), urls = new Set<string>();
      const pages = list(row.pages, '진단 페이지', 100, 1).map(value => {
        const item = object(value, ['url', 'status_code', 'title', 'meta_description', 'language', 'html_score', 'issues'], '진단 페이지'), url = rawUrl(item.url, true);
        if (!auditInScope(url, target as unknown as AuditTarget)) throw new Error('페이지 URL이 현재 진단 대상 범위에 속하지 않습니다.'); if (urls.has(url)) throw new Error('같은 페이지 URL이 중복되었습니다.'); urls.add(url);
        const status = number(item.status_code, 'HTTP 상태', 599, true); if (status === null || status < 200) throw new Error('HTTP 상태는 200~599 정수입니다.');
        const score = number(item.html_score, 'HTML 건강도'); if (status >= 400 && score !== null) throw new Error('수집 실패 페이지의 점수는 null이어야 합니다.');
        const issues = list(item.issues ?? [], '진단 이슈', 100).map(value => { const issue = object(value, ['code', 'severity', 'title', 'description', 'fix_recommendation'], '진단 이슈'); if (!['critical', 'warning', 'notice'].includes(String(issue.severity))) throw new Error('이슈 심각도를 확인해 주세요.'); return { issue_code: contentText(issue.code, '이슈 코드', 100, true), severity: issue.severity, title: contentText(issue.title, '이슈 제목', 200, true), description: contentText(issue.description, '이슈 근거', 5000, true), fix_recommendation: contentText(issue.fix_recommendation, '조치 제안', 5000) }; });
        return { url, final_url: url, status_code: status, fetch_status: status >= 400 ? 'failed' : 'fetched', title: contentText(item.title, '페이지 제목', 1000), meta_description: contentText(item.meta_description, '검색 설명', 5000), language: contentText(item.language, '페이지 언어', 100), html_score: score, issues };
      });
      return { source_id, target_id: target.id, completed_at: at(row.completed_at, now), name: `${target.name} (가져오기)`, target_url: target.target_url, target_snapshot: { name: target.name, target_url: target.target_url, max_pages: target.max_pages, max_depth: target.max_depth, scope_rules: target.scope_rules }, pages };
    } catch (error) { throw new Error(`기록 ${index + 1}: ${error instanceof Error ? error.message : '입력 오류'}`); }
  });
  return { kind, source: { provider, url: rawUrl(source.url) }, records };
}
export function rawImportTemplate(db: HaloXDatabase, workspace: string, actor: string, kind: RawKind, id: string) {
  db.assertWorkspaceMember(workspace, actor); if (kind === 'monitoring') throw new Error('모니터링 가져오기는 지원하지 않습니다.');
  const entity = reference(db, workspace, actor, kind === 'seo' ? 'keywords' : kind === 'geo' ? 'geo_prompts' : 'site_audit_targets', id), timestamp = new Date().toISOString();
  const common = { source_id: 'replace-with-source-record-id' };
  const record = kind === 'seo' ? { ...common, keyword_id: id, keyword_text: entity.keyword, language: entity.language, country: entity.country, engine: 'google', captured_at: timestamp, search_volume: null, keyword_difficulty: null, top_results: null, ai_overview_detected: null, ai_overview: null, paa_questions: [], related_searches: [] } : kind === 'geo' ? { ...common, prompt_id: id, prompt_text: entity.prompt_text, language_code: entity.language_code, location_code: entity.location_code, engine: 'openai', finished_at: timestamp, brand_domain: '', answer_text: '실제 응답 원문으로 교체하세요.', metrics: { brand_mentioned: null, is_cited: null, citation_rank_score: null, mention_rank_score: null }, citations: [] } : { ...common, target_id: id, completed_at: timestamp, pages: [{ url: entity.target_url, status_code: 200, title: '', meta_description: '', language: '', html_score: null, issues: [] }] };
  return JSON.stringify({ schema_version: 1, kind, source: { provider: 'replace-with-source-name', url: '' }, records: [record] }, null, 2);
}
