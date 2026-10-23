import type { ContentRow } from './content.ts';
export const RAW_KINDS = { seo: '키워드 Raw', geo: '프롬프트 Raw', audit: '사이트 진단 Raw', monitoring: '모니터링 Raw' };
export type RawKind = keyof typeof RAW_KINDS;
export type RawFilters = { start: string; end: string; query: string; engine: string; language: string; country: string; latest: boolean; origin: 'all' | 'collected' | 'imported'; batch_id: string };
export type RawRecord = { id: string; title: string; at: string; engine: string; language: string; country: string; provider: string; import_batch_id: string | null; entity_id: string; status: string; table: string };
export type RawData = { kind: RawKind; filters: RawFilters; records: RawRecord[]; count: number; table_counts: Record<string, number>; total_rows: number; download_allowed: boolean; excluded_undated: number; batches: ContentRow[]; targets: { id: string; title: string; language: string; country: string }[]; can_manage: boolean };
export type RawDetail = { record: RawRecord; tables: Record<string, ContentRow[]> };
export function defaultRawFilters(now = new Date()): RawFilters { const end = now.toISOString().slice(0, 10); return { start: new Date(Date.parse(end) - 6 * 86400000).toISOString().slice(0, 10), end, query: '', engine: '', language: '', country: '', latest: false, origin: 'all', batch_id: '' }; }
