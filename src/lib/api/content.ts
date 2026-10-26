export const CONTENT_TABLES = ['content_jobs', 'content_drafts', 'content_compositions', 'writing_style_profiles', 'knowledge_entities', 'keywords', 'geo_prompts'] as const;
export type ContentRow = { id: string; [key: string]: unknown };
export type ContentData = Record<typeof CONTENT_TABLES[number], ContentRow[]>;
export const CONTENT_STATUS = { draft: '초안', in_review: '검토 중', ready: '사용 준비' };
export const CONTENT_ORIGIN = { manual: '직접 작성', generated: 'AI 생성', edited: '본문 편집', restored: '버전 복원', optimized: '최적화 적용' };
export const MAX_CONTENT_LENGTH = 100_000;
