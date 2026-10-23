import { getDomain, parse } from 'tldts';
import type { Row } from './database.ts';
import { contentText } from './content-model.ts';

export type Brand = Row & { id: string; brand_name: string; role: 'self' | 'competitor'; mentions: string[]; domains: string[]; keyword_set_ids: string[] };
export type Product = Row & { id: string; brand_id: string; name: string; mentions: string[]; category: string; url: string; description: string };
export type Alias = Row & { id: string; source: string; target: string };
export type BrandConfig = { revision: number; enabled: boolean; mode: 'root' | 'full'; brands: Brand[]; products: Product[]; aliases: Alias[] };
export class BrandConflictError extends Error {
  constructor() { super('다른 곳에서 브랜드 설정이 변경되었습니다. 입력은 유지했습니다. 창을 닫고 새로고침한 뒤 다시 확인해 주세요.'); }
}
export const brandTextKey = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
export function brandDomain(value: unknown): string {
  const raw = contentText(value, '도메인', 1000, true);
  const authority = raw.match(/^(?:https?:\/\/)?([^/?#\\\s]+)\/?$/i)?.[1];
  if (!authority || /[:@%]/.test(authority)) throw new Error('경로·포트·인증 정보 없는 도메인을 입력해 주세요.');
  let url: URL;
  try { url = new URL(raw.includes('://') ? raw : `https://${raw}`); } catch { throw new Error('도메인은 example.com 형식으로 입력해 주세요.'); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, ''), info = parse(hostname, { allowPrivateDomains: true });
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !info.domain || info.isIp || /\.(localhost|local|internal)$/.test(hostname) || hostname.length > 253 || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new Error('경로·포트·인증 정보 없는 도메인을 입력해 주세요. IP 주소와 공용 접미사만은 사용할 수 없습니다.');
  return hostname;
}
export const domainKey = (domain: string, mode: BrandConfig['mode']) => mode === 'root' ? getDomain(domain, { allowPrivateDomains: true }) || domain : domain;
export function brandList(value: unknown, label: string, max = 50, length = 100): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}은 최대 ${max}개까지 입력해 주세요.`);
  const items = value.map(item => contentText(item, label, length, true));
  if (new Set(items.map(brandTextKey)).size !== items.length) throw new Error(`${label}에 중복 값이 있습니다.`);
  return items;
}
export function normalizeBrand(input: Row): Brand {
  if (!['self', 'competitor'].includes(String(input.role))) throw new Error('자사 또는 경쟁사를 선택해 주세요.');
  const domains = brandList(input.domains ?? [], '도메인', 50, 1000).map(brandDomain);
  if (new Set(domains).size !== domains.length) throw new Error('같은 도메인을 중복 등록할 수 없습니다.');
  return { ...input, id: String(input.id), brand_name: contentText(input.brand_name, '대표 이름', 100, true), role: input.role as Brand['role'], mentions: brandList(input.mentions ?? [], '멘션'), domains, keyword_set_ids: brandList(input.keyword_set_ids ?? [], '연결 세트', 100) };
}
export function normalizeProduct(input: Row): Product {
  const url = contentText(input.url, '제품 URL', 2000);
  if (url) { let parsed: URL; try { parsed = new URL(url); } catch { throw new Error('제품 URL을 확인해 주세요.'); } if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('제품 URL은 인증 정보 없는 HTTP(S) 주소여야 합니다.'); }
  return { ...input, id: String(input.id), brand_id: contentText(input.brand_id, '브랜드', 100, true), name: contentText(input.name, '제품 이름', 100, true), mentions: brandList(input.mentions ?? [], '제품 멘션'), category: contentText(input.category, '카테고리', 100), description: contentText(input.description, '제품 소개', 2000), url };
}
export function canonicalDomain(config: BrandConfig, host: string): string {
  let key = domainKey(host, config.mode); const visited = new Set<string>();
  const mapping = new Map(config.aliases.map(alias => [domainKey(alias.source, config.mode), domainKey(alias.target, config.mode)]));
  while (mapping.has(key)) { if (visited.has(key)) throw new Error('도메인 별칭이 순환합니다.'); visited.add(key); key = mapping.get(key)!; }
  return key;
}
export function validateBrandConfig(config: BrandConfig, keywordSets: Row[]): BrandConfig {
  if (!['root', 'full'].includes(config.mode)) throw new Error('도메인 매칭 정책을 확인해 주세요.');
  if (config.brands.length > 100 || config.products.length > 500 || config.aliases.length > 200) throw new Error('브랜드 100개·제품 500개·별칭 200개 한도를 확인해 주세요.');
  const next: BrandConfig = { ...config, brands: config.brands.map(normalizeBrand), products: config.products.map(normalizeProduct), aliases: config.aliases.map(alias => ({ ...alias, source: brandDomain(alias.source), target: brandDomain(alias.target) })) };
  const sources = new Set<string>();
  for (const alias of next.aliases) { const key = domainKey(alias.source, next.mode); if (sources.has(key) || key === domainKey(alias.target, next.mode)) throw new Error('같은 출발 도메인의 중복 별칭과 자기 자신으로의 별칭은 사용할 수 없습니다.'); sources.add(key); canonicalDomain(next, alias.source); }
  const names = new Set<string>(), mentions = new Map<string, string>(), domains = new Map<string, string>(), sets = new Set<string>();
  for (const brand of next.brands) {
    const name = brandTextKey(brand.brand_name); if (names.has(name)) throw new Error('같은 대표 이름의 브랜드가 있습니다.'); names.add(name);
    for (const mention of [brand.brand_name, ...brand.mentions]) { const key = brandTextKey(mention); if (mentions.has(key) && mentions.get(key) !== brand.id) throw new Error(`멘션 '${mention}'이 다른 브랜드와 중복됩니다.`); mentions.set(key, brand.id); }
    for (const domain of brand.domains) { const key = canonicalDomain(next, domain); if (domains.has(key) && domains.get(key) !== brand.id) throw new Error('현재 매칭 정책·별칭에서 같은 도메인이 다른 브랜드에 속합니다.'); domains.set(key, brand.id); }
    if (brand.role !== 'self' && brand.keyword_set_ids.length) throw new Error('키워드 세트는 자사 브랜드에만 연결합니다.');
    for (const id of brand.keyword_set_ids) { if (sets.has(id) || !keywordSets.some(set => set.id === id)) throw new Error('키워드 세트는 같은 워크스페이스의 자사 브랜드 하나에만 연결할 수 있습니다.'); sets.add(id); }
  }
  const products = new Set<string>();
  for (const product of next.products) { if (!next.brands.some(brand => brand.id === product.brand_id)) throw new Error('제품은 같은 워크스페이스의 브랜드에 연결해 주세요.'); const key = `${product.brand_id}:${brandTextKey(product.name)}`; if (products.has(key)) throw new Error('같은 브랜드에 같은 제품 이름이 있습니다.'); products.add(key); }
  return next;
}
/** Old brands were one profile with arrays of competitor domains. Upgrade once, without changing measurements. */
export function migrateBrandRows(rows: Row[]): void {
  for (const row of [...rows]) {
    if (row.role !== undefined) continue;
    Object.assign(row, { role: 'self', mentions: [String(row.brand_name || row.target_domain || '브랜드')], domains: Array.isArray(row.self_roots) ? row.self_roots : row.target_domain ? [row.target_domain] : [], keyword_set_ids: [], revision: 0 });
    for (const [index, domain] of (Array.isArray(row.competitor_domains) ? row.competitor_domains : []).entries()) {
      if (rows.some(other => other.workspace_id === row.workspace_id && Array.isArray(other.domains) && other.domains.includes(domain))) continue;
      rows.push({ id: `${row.id}:competitor:${index}`, workspace_id: row.workspace_id, brand_name: String(domain), role: 'competitor', mentions: [], domains: [domain], keyword_set_ids: [], revision: 0, created_at: row.created_at, updated_at: row.updated_at });
    }
  }
}
function mentionPresent(text: string, mention: string) {
  const needle = brandTextKey(mention), haystack = brandTextKey(text);
  if (!/^[\x00-\x7F]+$/.test(needle)) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(haystack);
}
export const urlHost = (value: unknown) => { try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase().replace(/\.$/, '') : ''; } catch { return ''; } };
export function classifyBrandEvidence(config: BrandConfig, text: string | null, sources: Row[], keywordSetId?: unknown) {
  const linked = config.brands.find(brand => brand.role === 'self' && brand.keyword_set_ids.includes(String(keywordSetId)));
  const relevant = config.brands.filter(brand => brand.role === 'competitor' || !linked || brand.id === linked.id);
  const own = relevant.filter(brand => brand.role === 'self'), hasDomains = own.some(brand => brand.domains.length > 0);
  const brandIds = text === null ? [] : relevant.filter(brand => [brand.brand_name, ...brand.mentions].some(mention => mentionPresent(text, mention))).map(brand => brand.id);
  const productIds = text === null ? [] : config.products.filter(product => relevant.some(brand => brand.id === product.brand_id) && [product.name, ...product.mentions].some(mention => mentionPresent(text, mention))).map(product => product.id);
  const classified: (Row & { brand_id: string | null; is_ours: boolean; is_competitor: boolean })[] = sources.map(source => {
    const host = urlHost(source.url || source.cited_url), key = host ? canonicalDomain(config, host) : '';
    const brand = key ? relevant.find(brand => brand.domains.some(domain => canonicalDomain(config, domain) === key)) : undefined;
    return { ...source, brand_id: brand?.id || null, is_ours: brand?.role === 'self', is_competitor: brand?.role === 'competitor' };
  });
  return { config_revision: config.revision, mode: config.mode, domains: own.flatMap(brand => brand.domains), brand_ids: brandIds, product_ids: productIds, mentioned: text === null || !own.length ? null : own.some(brand => brandIds.includes(brand.id)), cited: hasDomains ? classified.some(row => row.is_ours) : null, sources: classified };
}
