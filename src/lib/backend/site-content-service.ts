import crypto from 'node:crypto';
import catalogJson from '../../data/site-content-catalog.json' with { type: 'json' };
import { ADMIN_USER_ID, RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { contentText } from './content-model.ts';
import type { PublicSiteContent, SiteCollection, SiteContentData } from '../api/site-content.ts';
import type { ContentRow } from '../api/content.ts';

const CONTENT_COLLECTIONS = ['site_pages', 'site_posts'] as const;
type ContentCollection = (typeof CONTENT_COLLECTIONS)[number];
type CatalogEntry = { id: string; route: string; locale: 'ko' | 'en'; kind: 'page' | 'post'; subtype: string; title: string; seo_title: string };
const catalog = catalogJson as CatalogEntry[];
const nowIso = (now: number) => new Date(now).toISOString();
const rows = (db: HaloXDatabase, table: SiteCollection): Row[] => db.getServerRecords(table);
const put = (db: HaloXDatabase, table: SiteCollection, values: Row[]) => db.setServerRecords(table, values);

function requireOperator(db: HaloXDatabase, actor: string) {
  if (actor !== ADMIN_USER_ID || !db.queryTable('profiles', { filters: { id: `eq.${actor}` } }, actor).count) throw new RlsAccessDeniedError('서비스 운영자만 공개 콘텐츠를 관리할 수 있습니다.');
}

function routeValue(value: unknown) {
  const input = contentText(value, '공개 경로', 240, true);
  const route = input === '/' ? '/ko' : input.replace(/\/$/, '') || '/ko';
  if (!/^\/(ko|en)(?:\/[-a-z0-9]+)*$/.test(route) || route.startsWith('/app') || route.startsWith('/api')) throw new Error('한국어 또는 영어 공개 경로를 입력해 주세요.');
  return route;
}
function localeValue(value: unknown): 'ko' | 'en' { if (value !== 'ko' && value !== 'en') throw new Error('한국어 또는 영어를 선택해 주세요.'); return value; }
function catalogRow(entry: CatalogEntry): Row { return { ...entry, revision: 0, status: 'published', excerpt: '', body_md: '', taxonomy_ids: [], captured_fallback: true, published_snapshot: { title: entry.title, excerpt: '', body_md: '', seo_title: entry.seo_title, locale: entry.locale, route: entry.route, captured_fallback: true } }; }
function allContent(db: HaloXDatabase): Row[] {
  const saved: Row[] = CONTENT_COLLECTIONS.flatMap(collection => rows(db, collection).map(row => ({ ...row, collection })));
  const savedById = new Map(saved.map(row => [String(row.id), row]));
  const catalogIds = new Set(catalog.map(entry => entry.id));
  const captured: Row[] = catalog.map(entry => savedById.get(entry.id) || { ...catalogRow(entry), collection: entry.kind === 'post' ? 'site_posts' : 'site_pages' });
  return [...captured, ...saved.filter(row => !catalogIds.has(String(row.id)))];
}
function findContent(db: HaloXDatabase, id: unknown) { const row = allContent(db).find(item => item.id === id); if (!row) throw new Error('콘텐츠를 찾을 수 없습니다.'); return row; }
function contentFields(db: HaloXDatabase, input: Row) {
  const route = routeValue(input.route), locale = localeValue(input.locale);
  if (!route.startsWith(`/${locale}`)) throw new Error('공개 경로와 언어가 일치하지 않습니다.');
  const taxonomyIds = Array.isArray(input.taxonomy_ids) ? [...new Set(input.taxonomy_ids.map(String))].slice(0, 20) : [];
  const valid = new Set(rows(db, 'site_taxonomies').filter(row => row.status !== 'deleted' && row.locale === locale).map(row => String(row.id)));
  if (taxonomyIds.some(id => !valid.has(id))) throw new Error('사용할 수 없는 분류가 포함되어 있습니다.');
  return { route, locale, title: contentText(input.title, '제목', 200, true), excerpt: contentText(input.excerpt, '요약', 1000, false, true), body_md: contentText(input.body_md, '본문', 100_000, false, true), seo_title: contentText(input.seo_title || input.title, 'SEO 제목', 200, true), taxonomy_ids: taxonomyIds };
}
function usesRoute(row: Row, route: string) { return row.route === route || (row.published_snapshot as Row | undefined)?.route === route; }
function uniqueRoute(db: HaloXDatabase, route: string, except?: string) { if (allContent(db).some(row => row.status !== 'deleted' && usesRoute(row, route) && row.id !== except) || rows(db, 'site_translations').some(row => row.status !== 'deleted' && usesRoute(row, route) && row.id !== except)) throw new Error('이미 사용 중인 공개 경로입니다.'); }
function persist(db: HaloXDatabase, table: SiteCollection, current: Row | undefined, values: Row, now: number) { const row: Row = { ...current, ...values, id: String(current?.id || crypto.randomUUID()), revision: Number(current?.revision || 0) + 1, created_at: current?.created_at || nowIso(now), updated_at: nowIso(now) }; put(db, table, [...rows(db, table).filter(item => item.id !== row.id), row]); return row; }
function checkRevision(row: Row, expected: unknown) { if (!Number.isSafeInteger(expected) || Number(row.revision || 0) !== expected) throw new Error('다른 작업에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.'); }

export function readSiteContentAdmin(db: HaloXDatabase, actor: string): SiteContentData {
  requireOperator(db, actor);
  return { can_manage: true, contents: allContent(db).filter(row => row.status !== 'deleted') as ContentRow[], taxonomies: rows(db, 'site_taxonomies').filter(row => row.status !== 'deleted') as ContentRow[], translations: rows(db, 'site_translations').filter(row => row.status !== 'deleted') as ContentRow[], contacts: rows(db, 'contact_requests').filter(row => row.status !== 'deleted').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) as ContentRow[], catalog_count: catalog.length };
}
export function readPublicSiteContent(db: HaloXDatabase, route: string): PublicSiteContent {
  let normalized: string;
  try { normalized = routeValue(route); } catch { return { found: false }; }
  const direct = allContent(db).find(row => (row.published_snapshot as Row | undefined)?.route === normalized), translation = rows(db, 'site_translations').find(row => (row.published_snapshot as Row | undefined)?.route === normalized), row = translation || direct;
  if (!row) return { found: false }; if (row.status === 'deleted') return { found: false, deleted: true };
  const snapshot = row.published_snapshot as Row | null | undefined; if (!snapshot) return { found: false };
  return { found: true, captured_fallback: Boolean(snapshot.captured_fallback), content: { ...snapshot, id: String(row.id), revision: row.revision, kind: row.kind || 'translation', subtype: row.subtype } as ContentRow };
}

export function runSiteContentCommand(db: HaloXDatabase, actor: string, action: string, input: Row, now = Date.now()) {
  requireOperator(db, actor);
  if (action === 'page-create' || action === 'post-create') { const values = contentFields(db, input); uniqueRoute(db, values.route); return persist(db, action === 'post-create' ? 'site_posts' : 'site_pages', undefined, { ...values, kind: action === 'post-create' ? 'post' : 'page', subtype: action === 'post-create' ? contentText(input.subtype || 'blog', '종류', 30, true) : 'page', status: 'draft', captured_fallback: false, published_snapshot: null }, now); }
  if (action.startsWith('content-')) {
    const current = findContent(db, input.content_id), table = current.collection as ContentCollection; checkRevision(current, input.expected_revision);
    if (action === 'content-delete') {
      put(db, 'site_translations', rows(db, 'site_translations').map(row => row.parent_id === current.id && row.status !== 'deleted' ? { ...row, status: 'deleted', deleted_at: nowIso(now), updated_at: nowIso(now), revision: Number(row.revision || 0) + 1 } : row));
      return persist(db, table, current, { status: 'deleted', deleted_at: nowIso(now) }, now);
    }
    if (action === 'content-publish') { if (!current.body_md && !current.captured_fallback) throw new Error('게시할 본문을 입력해 주세요.'); return persist(db, table, current, { status: 'published', published_snapshot: { title: current.title, excerpt: current.excerpt, body_md: current.body_md, seo_title: current.seo_title, locale: current.locale, route: current.route, captured_fallback: Boolean(current.captured_fallback) && !current.body_md }, published_at: nowIso(now), captured_fallback: Boolean(current.captured_fallback) && !current.body_md }, now); }
    if (action !== 'content-update') throw new Error('지원하지 않는 콘텐츠 작업입니다.'); const values = contentFields(db, input); uniqueRoute(db, values.route, String(current.id)); return persist(db, table, current, { ...values, status: current.status === 'published' ? 'draft' : current.status, captured_fallback: false }, now);
  }
  if (action === 'taxonomy-create') { const name = contentText(input.name, '분류 이름', 80, true), slug = contentText(input.slug, '분류 슬러그', 80, true).toLowerCase(), locale = localeValue(input.locale); if (!/^[a-z0-9-]+$/.test(slug) || rows(db, 'site_taxonomies').some(row => row.status !== 'deleted' && row.locale === locale && row.slug === slug)) throw new Error('분류 슬러그를 확인해 주세요.'); return persist(db, 'site_taxonomies', undefined, { name, slug, locale, type: input.type === 'tag' ? 'tag' : 'category', status: 'active' }, now); }
  if (action.startsWith('taxonomy-')) { const current = rows(db, 'site_taxonomies').find(row => row.id === input.taxonomy_id); if (!current) throw new Error('분류를 찾을 수 없습니다.'); checkRevision(current, input.expected_revision); if (action === 'taxonomy-delete') { for (const table of CONTENT_COLLECTIONS) put(db, table, rows(db, table).map(row => ({ ...row, taxonomy_ids: Array.isArray(row.taxonomy_ids) ? row.taxonomy_ids.filter(id => id !== current.id) : [] }))); return persist(db, 'site_taxonomies', current, { status: 'deleted' }, now); } if (action !== 'taxonomy-update') throw new Error('지원하지 않는 분류 작업입니다.'); const name = contentText(input.name, '분류 이름', 80, true), slug = contentText(input.slug, '분류 슬러그', 80, true).toLowerCase(), locale = localeValue(input.locale), type = input.type === 'tag' ? 'tag' : 'category'; if (!/^[a-z0-9-]+$/.test(slug) || rows(db, 'site_taxonomies').some(row => row.id !== current.id && row.status !== 'deleted' && row.locale === locale && row.slug === slug)) throw new Error('분류 슬러그를 확인해 주세요.'); if (locale !== current.locale) for (const table of CONTENT_COLLECTIONS) put(db, table, rows(db, table).map(row => ({ ...row, taxonomy_ids: Array.isArray(row.taxonomy_ids) ? row.taxonomy_ids.filter(id => id !== current.id) : [] }))); return persist(db, 'site_taxonomies', current, { name, slug, locale, type }, now); }
  if (action === 'translation-create') { const parent = findContent(db, input.parent_id), values = contentFields(db, input); if (values.locale === parent.locale) throw new Error('번역 언어는 원본 언어와 달라야 합니다.'); uniqueRoute(db, values.route); return persist(db, 'site_translations', undefined, { ...values, parent_id: parent.id, kind: 'translation', status: 'draft', published_snapshot: null }, now); }
  if (action.startsWith('translation-')) { const current = rows(db, 'site_translations').find(row => row.id === input.translation_id); if (!current) throw new Error('번역을 찾을 수 없습니다.'); checkRevision(current, input.expected_revision); if (action === 'translation-delete') return persist(db, 'site_translations', current, { status: 'deleted' }, now); if (action === 'translation-publish') { if (!current.body_md) throw new Error('게시할 번역 본문을 입력해 주세요.'); return persist(db, 'site_translations', current, { status: 'published', published_snapshot: { title: current.title, excerpt: current.excerpt, body_md: current.body_md, seo_title: current.seo_title, locale: current.locale, route: current.route }, published_at: nowIso(now) }, now); } if (action !== 'translation-update') throw new Error('지원하지 않는 번역 작업입니다.'); const values = contentFields(db, input); uniqueRoute(db, values.route, String(current.id)); return persist(db, 'site_translations', current, { ...values, status: 'draft' }, now); }
  if (action.startsWith('contact-')) { const current = rows(db, 'contact_requests').find(row => row.id === input.contact_id); if (!current) throw new Error('문의를 찾을 수 없습니다.'); checkRevision(current, input.expected_revision); if (action === 'contact-delete') return persist(db, 'contact_requests', current, { status: 'deleted' }, now); if (action !== 'contact-update') throw new Error('지원하지 않는 문의 작업입니다.'); const status = String(input.status); if (!['new', 'contacted', 'closed'].includes(status)) throw new Error('문의 상태를 확인해 주세요.'); return persist(db, 'contact_requests', current, { status, note: contentText(input.note, '운영 메모', 5000, false, true) }, now); }
  throw new Error('지원하지 않는 공개 콘텐츠 작업입니다.');
}

export function createContactRequest(db: HaloXDatabase, input: Row, meta: { ip: string }, now = Date.now()) {
  if (String(input.website_url_confirm || '').trim()) return { accepted: true };
  if (input.consent !== true) throw new Error('개인정보 수집 및 이용에 동의해 주세요.');
  const email = contentText(input.email, '이메일', 254, true).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('이메일 주소를 확인해 주세요.');
  if (rows(db, 'contact_requests').filter(row => row.email === email && Date.parse(String(row.created_at)) > now - 3_600_000).length >= 3) throw new Error('잠시 후 다시 문의해 주세요.');
  const values: Row = { name: contentText(input.name, '이름', 100, true), email, company: contentText(input.company, '회사명', 160, true), phone: contentText(input.phone, '전화번호', 40, false), inquiry_type: contentText(input.inquiry_type, '문의 종류', 100, true), industry: contentText(input.industry, '업종', 100, false), team_size: contentText(input.team_size, '인원 규모', 100, false), message: contentText(input.message, '문의 내용', 10_000, true, true), locale: localeValue(input.locale), source_route: routeValue(input.source_route), status: 'new', note: '', ip_hash: crypto.createHash('sha256').update(meta.ip).digest('hex') };
  const fingerprint = crypto.createHash('sha256').update(`${email}:${values.message}:${Math.floor(now / 300_000)}`).digest('hex'), existing = rows(db, 'contact_requests').find(row => row.fingerprint === fingerprint);
  if (existing) return { accepted: true, duplicate: true, id: existing.id };
  const created = persist(db, 'contact_requests', undefined, { ...values, fingerprint }, now); return { accepted: true, id: created.id };
}
