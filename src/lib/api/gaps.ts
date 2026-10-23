import type { ContentRow } from './content';
import type { AnalysisData } from './analyses';

export const GAP_STATES = { both: '검색·AI 모두 노출', search_only: '검색만 노출', ai_only: 'AI만 노출', neither: '양쪽 미노출', unmeasured: '측정 자료 부족' } as const;
export const CANDIDATE_STATUS = { pending: '검토 대기', dismissed: '보류', accepted: '채택 완료' } as const;
export type GapMatrixRow = { id: string; text: string; language: string; country: string; rank: number | null; search_measured: boolean; prompt_count: number; measured: number; cited: number; state: keyof typeof GAP_STATES; content_ids: string[] };
export type GapData = { seo: AnalysisData; geo: AnalysisData; matrix: GapMatrixRow[]; candidates: ContentRow[]; decisions: ContentRow[]; keywords: ContentRow[]; prompts: ContentRow[]; prompt_sets: ContentRow[]; content_jobs: ContentRow[] };
