import crypto from 'node:crypto';
import { SaxesParser } from 'saxes';
import robotsParser from 'robots-parser';
import { publicDocumentUrl } from './public-document.ts';
import { auditInScope } from './site-audit-model.ts';
import { AUDIT_AGENT, type AuditFetcher } from './site-audit-fetch.ts';
import type { AuditTarget } from '../api/site-audit.ts';
import type { Row } from './database.ts';

export const POLICY_FIELDS = ['robots_txt_url', 'sitemap_url', 'llms_txt_url'] as const;
export type PolicyUrls = Record<typeof POLICY_FIELDS[number], string | null>;
type Pending = { kind: 'robots' | 'sitemap' | 'llms'; url: string; depth: number };
export type PolicyState = { target: AuditTarget; urls: PolicyUrls; mode: 'initial' | 'backfill'; queue: Pending[]; seen: string[]; documents: Row[]; page_urls: string[]; invalid_urls: number; limited: boolean; robots_text: string; crawl_delay: number; fatal: string; checked_at?: string };
export function policyUrls(input: Row): PolicyUrls {
  return Object.fromEntries(POLICY_FIELDS.map(field => {
    const value = input[field];
    if (value == null || value === '') return [field, null];
    if (typeof value !== 'string' || value.includes('#')) throw new Error('정책 파일은 #이 없는 공개 URL로 입력해 주세요.');
    return [field, publicDocumentUrl(value.trim()).href];
  })) as PolicyUrls;
}
export function createPolicyState(target: AuditTarget, input: Row, mode: PolicyState['mode'] = 'initial'): PolicyState {
  const urls = policyUrls(input), origin = new URL(target.target_url).origin;
  return { target, urls, mode, queue: [{ kind: 'robots', url: urls.robots_txt_url || origin + '/robots.txt', depth: 0 }], seen: [], documents: [], page_urls: [], invalid_urls: 0, limited: false, robots_text: '', crawl_delay: 1, fatal: '' };
}
export function parseSitemap(xml: string): { kind: 'urlset' | 'sitemapindex'; urls: string[]; limited: boolean } {
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024) throw new Error('사이트맵은 2MiB 이하여야 합니다.');
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = [], urls: string[] = []; let kind = '', current = '', collecting = false, limited = false, namespace = '', locations = 0;
  parser.on('doctype', () => { throw new Error('DTD/외부 엔티티가 있는 사이트맵은 지원하지 않습니다.'); });
  parser.on('opentag', node => {
    stack.push(node.local);
    if (stack.length > 30) throw new Error('XML 중첩 제한을 초과했습니다.');
    if (stack.length === 1) { kind = node.local; namespace = node.uri; if (!['urlset', 'sitemapindex'].includes(kind) || node.uri && node.uri !== 'http://www.sitemaps.org/schemas/sitemap/0.9') throw new Error('urlset 또는 sitemapindex XML이 필요합니다.'); }
    if (stack.length === 2) locations = 0;
    if (stack.length > 3 && stack[2] === 'loc') throw new Error('loc에는 URL 텍스트만 입력할 수 있습니다.');
    collecting = stack.length === 3 && stack[1] === (kind === 'urlset' ? 'url' : 'sitemap') && node.local === 'loc' && node.uri === namespace;
    if (collecting) current = '';
  });
  const append = (text: string) => { if (collecting) { current += text; if (current.length > 2048) throw new Error('사이트맵 URL 길이를 초과했습니다.'); } };
  parser.on('text', append); parser.on('cdata', append);
  parser.on('closetag', () => {
    if (collecting && stack.length === 3) { if (!current.trim()) throw new Error('빈 loc URL입니다.'); locations++; if (urls.length < 10000) urls.push(current.trim()); else limited = true; collecting = false; }
    if (stack.length === 2 && stack[1] === (kind === 'urlset' ? 'url' : 'sitemap') && locations !== 1) throw new Error('각 사이트맵 항목에는 loc URL 하나가 필요합니다.');
    stack.pop();
  });
  parser.write(xml).close();
  if (!kind) throw new Error('빈 사이트맵입니다.');
  return { kind: kind as 'urlset' | 'sitemapindex', urls, limited };
}
/** Fetches at most one document per durable worker tick. No database lock during HTTP. */
export async function stepPolicy(state: PolicyState, fetcher: AuditFetcher, now = Date.now()): Promise<PolicyState> {
  const next = structuredClone(state), item = next.queue.shift(); if (!item) return next;
  next.seen.push(item.url); const origin = new URL(next.target.target_url).origin;
  const record: Row = { kind: item.kind, url: item.url, checked_at: new Date(now).toISOString(), status: 'failed', error: '' };
  const enqueue = (entry: Pending) => {
    if (next.seen.includes(entry.url) || next.queue.some(row => row.url === entry.url)) return;
    if (next.seen.length + next.queue.length >= 10 || entry.depth > 3) { next.limited = true; return; }
    next.queue.push(entry);
  };
  try {
    const rules = robotsParser(origin + '/robots.txt', next.robots_text);
    const allowed = (value: string) => {
      try { const url = publicDocumentUrl(value); return url.origin === new URL(item.url).origin && (item.kind === 'robots' || url.origin !== origin || rules.isAllowed(value, AUDIT_AGENT) === true); } catch { return false; }
    };
    if (!allowed(item.url)) throw new Error('robots.txt에서 정책 파일 수집을 허용하지 않습니다.');
    const response = await fetcher(item.url, allowed);
    if (!allowed(response.url)) throw new Error('정책 파일의 최종 URL이 허용 범위 밖에 있습니다.');
    Object.assign(record, { final_url: response.url, http_status: response.status, content_type: response.content_type, bytes: Buffer.byteLength(response.body), sha256: crypto.createHash('sha256').update(response.body).digest('hex') });
    if (response.status >= 400 && response.status < 500 && response.status !== 429) record.status = 'missing';
    else if (response.status < 200 || response.status >= 300) throw new Error(`정책 파일이 HTTP ${response.status}을 반환했습니다.`);
    else {
      const type = response.content_type.split(';')[0].trim();
      if (item.kind === 'robots') {
        if (type !== 'text/plain' || Buffer.byteLength(response.body) > 512 * 1024) throw new Error('robots.txt는 512KiB 이하의 UTF-8 텍스트여야 합니다.');
        next.robots_text = response.body;
        const robots = robotsParser(origin + '/robots.txt', response.body), delay = robots.getCrawlDelay(AUDIT_AGENT);
        if (delay !== undefined && (!Number.isFinite(delay) || delay > 86400)) throw new Error('robots.txt 수집 간격이 지원 범위를 초과했습니다.');
        next.crawl_delay = Math.max(1, delay || 1);
        record.root_allowed = robots.isAllowed(next.target.target_url, AUDIT_AGENT) === true;
      } else if (item.kind === 'sitemap') {
        if (!['application/xml', 'text/xml', 'text/plain'].includes(type)) throw new Error('사이트맵은 XML 또는 텍스트 응답이어야 합니다.');
        const parsed = parseSitemap(response.body); next.limited ||= parsed.limited; record.format = parsed.kind; record.entries = parsed.urls.length;
        for (const value of parsed.urls) {
          let url: URL; try { url = publicDocumentUrl(value); } catch { next.invalid_urls++; continue; }
          if (parsed.kind === 'sitemapindex') {
            if (url.origin !== new URL(item.url).origin) { next.invalid_urls++; continue; }
            enqueue({ kind: 'sitemap', url: url.href, depth: item.depth + 1 });
          } else if (!next.page_urls.includes(url.href)) {
            if (next.page_urls.length < 10000) next.page_urls.push(url.href); else next.limited = true;
          }
        }
      } else {
        if (!['text/plain', 'text/markdown'].includes(type) || Buffer.byteLength(response.body) > 512 * 1024) throw new Error('llms.txt는 512KiB 이하의 텍스트/Markdown이어야 합니다.');
        record.title = response.body.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 300) || ''; record.heading_count = (response.body.match(/^#{1,6}\s+/gm) || []).length; record.link_count = (response.body.match(/\[[^\]\n]*\]\(https?:\/\/[^)]+\)/g) || []).length;
      }
      record.status = 'fetched';
    }
  } catch (error) { record.error = error instanceof Error ? error.message.slice(0, 500) : '정책 파일 조회 실패'; if (item.kind === 'robots') next.fatal = String(record.error); }
  next.documents.push(record);
  if (item.kind === 'robots' && !next.fatal) {
    const declared = robotsParser(origin + '/robots.txt', next.robots_text).getSitemaps();
    const sitemapUrls = next.urls.sitemap_url ? [next.urls.sitemap_url] : declared.length ? declared : [origin + '/sitemap.xml'];
    for (const value of sitemapUrls) { try { enqueue({ kind: 'sitemap', url: publicDocumentUrl(value).href, depth: 0 }); } catch { next.invalid_urls++; } }
    if (!next.urls.sitemap_url && !next.queue.some(entry => entry.kind === 'sitemap')) enqueue({ kind: 'sitemap', url: origin + '/sitemap.xml', depth: 0 });
    if (next.mode === 'initial') enqueue({ kind: 'llms', url: next.urls.llms_txt_url || origin + '/llms.txt', depth: 0 });
  }
  if (next.fatal) next.queue = [];
  next.checked_at = new Date(now).toISOString(); return next;
}
export function policyReport(state: PolicyState) {
  const rules = robotsParser(new URL(state.target.target_url).origin + '/robots.txt', state.robots_text);
  const inScope = state.page_urls.filter(url => auditInScope(url, state.target)), allowed = inScope.filter(url => rules.isAllowed(url, AUDIT_AGENT) === true);
  return { source: state.mode, checked_at: state.checked_at, urls: state.urls, documents: state.documents, limited: state.limited, complete: !state.queue.length && !state.fatal && !state.limited && state.documents.every(row => row.status !== 'failed'), fatal: state.fatal, sitemap_urls: state.page_urls.length, in_scope_urls: inScope.length, allowed_urls: allowed.length, invalid_urls: state.invalid_urls, sample_urls: allowed.slice(0, 100), crawl_delay: state.crawl_delay };
}
