import type { ContentRow } from './content.ts';

export const EXPORT_TABLES = ['content_jobs', 'content_drafts', 'article_translations', 'export_history', 'export_destinations', 'export_publications', 'translation_runs'] as const;
export type ExportData = Record<typeof EXPORT_TABLES[number], ContentRow[]> & { can_manage_connections: boolean; translation_configured: boolean };
export const EXPORT_FORMATS = { md: 'Markdown', html: 'HTML', txt: '텍스트', json: 'JSON' };
export type ExportFormat = keyof typeof EXPORT_FORMATS;
export const TRANSLATION_LOCALES = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어' };
export const TRANSLATION_STATUS = { draft: '검토 중', ready: '사용 준비' };
export const TRANSLATION_RUN_STATUS = { running: '번역 중', succeeded: '번역문 저장됨', failed: '번역 실패', unknown: '결과 확인 필요', abandoned: '수동 확인 후 종료' };
export const TRANSLATION_LIMITS = { title: 1000, content_md: 400000, meta_title: 1000, meta_description: 5000 };
export const MAX_EXPORT_WORKSPACE_BYTES = 50 * 1024 * 1024;

export const PUBLICATION_STATUS = { sending: '전송 중', succeeded: '전송 확인', failed: '실패', unknown: '결과 확인 필요', unconfirmed: '수동 확인 후 정리' };
