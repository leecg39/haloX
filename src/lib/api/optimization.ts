import type { ContentRow } from './content.ts';
export const OPTIMIZATION_TABLES = ['content_jobs', 'content_drafts', 'content_review_runs', 'content_change_items'] as const;
export type OptimizationData = Record<typeof OPTIMIZATION_TABLES[number], ContentRow[]>;
export const REVIEW_STATUS = { audited: '본문 진단', collected: '검색 참고 수집', proposed: '제안 검토', applied: '적용 완료', reverted: '원본 복원' };
export const CHANGE_FIELDS = { content_md: '본문', title: '제목', meta_title: '검색 제목', meta_description: '검색 설명' };
export const CHANGE_OPERATIONS = { prepend: '앞에 추가', append: '뒤에 추가', replace: '일치 문구 교체' };
