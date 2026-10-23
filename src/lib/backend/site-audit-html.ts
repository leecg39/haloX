import { load } from 'cheerio';
import type { Row } from './database.ts';
import type { AuditResponse } from './site-audit-fetch.ts';
import { publicDocumentUrl } from './public-document.ts';

export type AuditLink = { url: string; text: string; nofollow: boolean; internal: boolean };
export function inspectAuditHtml(response: AuditResponse): { page: Row; issues: Row[] } {
  const issues: Row[] = [], links: AuditLink[] = [];
  const issue = (type: string, severity: string, title: string, evidence: string, fix: string) => issues.push({ issue_type: type, severity, title, description: evidence, fix_recommendation: fix, category: 'html', is_resolved: false, notes: '', revision: 1 });
  if (response.status < 200 || response.status >= 300) {
    issue('http_error', 'critical', `HTTP ${response.status} 응답`, `실제 응답 상태: ${response.status}`, '서버 응답과 접근 경로를 확인하세요.');
    return { page: { status_code: response.status, fetch_status: 'failed', title: '', links, content_type: response.content_type, redirects: response.redirects }, issues };
  }
  if (!response.content_type.startsWith('text/html')) {
    issue('not_html', 'notice', 'HTML 진단 대상이 아님', response.content_type || 'Content-Type 없음', '공개 HTML 페이지를 진단 대상으로 지정하세요.');
    return { page: { status_code: response.status, fetch_status: 'skipped', title: '', links, content_type: response.content_type, redirects: response.redirects }, issues };
  }
  const $ = load(response.body), title = $('title').first().text().trim(), description = $('meta[name="description" i]').first().attr('content')?.trim() || '', headings = $('h1').map((_index, element) => $(element).text().trim()).get();
  if (!title) issue('title_missing', 'warning', '페이지 제목 없음', '<title>이 비어 있거나 없습니다.', '페이지를 설명하는 고유한 title을 작성하세요.');
  if (!description) issue('description_missing', 'warning', '검색 설명 없음', 'description 메타 태그가 비어 있거나 없습니다.', '페이지 내용을 요약하는 검색 설명을 작성하세요.');
  if (!headings.some(Boolean)) issue('h1_missing', 'warning', '주요 제목 없음', '텍스트가 있는 h1을 찾지 못했습니다.', '페이지의 주요 주제를 h1으로 표현하세요.');
  if (headings.length > 1) issue('multiple_h1', 'notice', '여러 주요 제목 확인', `h1 ${headings.length}개`, '문서 구조에 맞는 제목 계층인지 검토하세요.');
  const lang = $('html').attr('lang')?.trim() || ''; if (!lang) issue('language_missing', 'notice', '문서 언어 없음', 'html lang 속성이 비어 있습니다.', '문서의 기본 언어를 지정하세요.');
  const canonical = $('link[rel~="canonical" i]').first().attr('href') || '';
  if (!canonical) issue('canonical_missing', 'notice', '대표 URL 미지정', 'canonical 링크를 찾지 못했습니다.', '중복 URL이 있다면 대표 URL을 지정하세요.');
  const robots = [$('meta[name="robots" i]').attr('content') || '', response.robots_header].join(', ');
  if (/\b(noindex|none)\b/i.test(robots)) issue('noindex', 'warning', '검색 색인 제한', robots.slice(0, 1000), '공개 검색에 노출할 페이지인지 확인한 뒤 색인 정책을 조정하세요.');
  const missingAlt = $('img').toArray().filter(image => $(image).attr('alt') === undefined).length;
  if (missingAlt) issue('image_alt_missing', 'warning', '이미지 대체 텍스트 누락', `alt 속성이 없는 이미지 ${missingAlt}개`, '이미지의 의미를 설명하고 장식 이미지는 빈 alt를 지정하세요.');
  let invalidJson = 0; $('script[type="application/ld+json"]').each((_index, element) => { try { JSON.parse($(element).text()); } catch { invalidJson++; } });
  if (invalidJson) issue('jsonld_invalid', 'warning', '구조화 데이터 JSON 오류', `파싱하지 못한 JSON-LD ${invalidJson}개`, 'JSON 구문을 수정하고 별도 구조화 데이터 검사기로 확인하세요.');
  let base = response.url; try { const value = $('base[href]').first().attr('href'); if (value) base = new URL(value, response.url).href; } catch { /* invalid base: use document URL */ }
  const anchors = $('a[href]'); anchors.slice(0, 500).each((_index, element) => {
    try {
      const url = publicDocumentUrl(new URL($(element).attr('href')!, base).href); if (url.search) return;
      links.push({ url: url.href, text: $(element).text().trim().slice(0, 200), nofollow: /\bnofollow\b/i.test($(element).attr('rel') || '') || /\b(nofollow|none)\b/i.test(robots), internal: url.origin === new URL(response.url).origin });
    } catch { /* Unsupported, private, credential-bearing, or malformed links are not crawlable. */ }
  });
  const penalty = issues.reduce((sum, item) => sum + (item.severity === 'critical' ? 30 : item.severity === 'warning' ? 10 : 2), 0);
  return { page: { title: title.slice(0, 1000), meta_description: description.slice(0, 5000), h1: headings.slice(0, 20).map(text => text.slice(0, 1000)), language: lang.slice(0, 100), canonical: canonical.slice(0, 2000), robots: robots.slice(0, 1000), image_count: $('img').length, missing_alt_count: missingAlt, jsonld_count: $('script[type="application/ld+json"]').length, invalid_jsonld_count: invalidJson, links, links_truncated: anchors.length > 500, link_count: anchors.length, status_code: response.status, fetch_status: 'fetched', content_type: response.content_type, redirects: response.redirects, html_score: Math.max(0, 100 - penalty), byte_size: Buffer.byteLength(response.body) }, issues };
}

export function auditLinkSummary(pages: Row[]) {
  const links = pages.flatMap(page => (page.links as AuditLink[] | undefined) || []), counts = new Map<string, number>();
  for (const link of links) if (link.internal) counts.set(link.url, (counts.get(link.url) || 0) + 1);
  const broken = pages.filter(page => Number(page.status_code) >= 400), redirected = pages.filter(page => Array.isArray(page.redirects) && page.redirects.length);
  return { total: links.length, orphans: [], orphan_count: 0, orphan_detection: 'not_measured', to_broken: links.filter(link => broken.some(page => page.url === link.url)), to_redirect: links.filter(link => redirected.some(page => page.url === link.url)), broken_pages: broken.map(page => page.url), top_linked: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([url, count]) => ({ url, count })), nofollow_count: links.filter(link => link.nofollow).length, pages_3xx_count: redirected.length, pages_4xx_count: pages.filter(page => Number(page.status_code) >= 400 && Number(page.status_code) < 500).length, descriptive_count: links.filter(link => link.text).length, descriptive_ratio: links.length ? links.filter(link => link.text).length / links.length : 0, computed_at: new Date().toISOString(), scope: '수집한 페이지의 저장된 링크만 집계' };
}
