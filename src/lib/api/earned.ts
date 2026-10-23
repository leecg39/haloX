import type { ContentRow } from './content';
export type EarnedValues = { url: string; title: string; channel: string; published_at: string; notes: string };
export type EarnedEvidence = { kind: 'serp' | 'aio' | 'geo'; sample_id: string; entity_id: string; text: string; engine: string; at: string; provider: string; source_url: string; rank: number | null };
export type EarnedRow = ContentRow & EarnedValues & { evidence: EarnedEvidence[]; evidence_total: number; serp_hits: number | null; aio_hits: number | null; geo_hits: number | null; best_rank: number | null; last_seen: string | null };
export type EarnedData = { editable: boolean; can_read_analysis: boolean; start: string; end: string; rows: EarnedRow[]; coverage: { serp: number; aio: number; geo: number }; excluded_records: number; generated_at: string };
export type EarnedPreview = { rows: EarnedValues[]; stamp: string; fingerprint: string };
