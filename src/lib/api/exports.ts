import type { ContentRow } from './content.ts';

export const EXPORT_TABLES = ['content_jobs', 'content_drafts', 'article_translations', 'export_history', 'export_destinations'] as const;
export type ExportData = Record<typeof EXPORT_TABLES[number], ContentRow[]>;
export const EXPORT_FORMATS = { md: 'Markdown', html: 'HTML', txt: '텍스트', json: 'JSON' };
export type ExportFormat = keyof typeof EXPORT_FORMATS;
export const TRANSLATION_LOCALES = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어' };
export const TRANSLATION_STATUS = { draft: '검토 중', ready: '사용 준비' };
export const MAX_EXPORT_WORKSPACE_BYTES = 50 * 1024 * 1024;
