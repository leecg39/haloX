import type { Row } from './database.ts';
import { contentText } from './content-model.ts';
import { TRANSLATION_LIMITS, TRANSLATION_LOCALES } from '../api/exports.ts';

export function translationLocale(value: unknown): string {
  if (typeof value !== 'string' || !Object.hasOwn(TRANSLATION_LOCALES, value)) throw new Error('지원하는 언어를 선택해 주세요.');
  return value;
}

// Translations can expand beyond the limits of the original content editor.
export function validateTranslationBody(input: Row) {
  return {
    title: contentText(input.title, '번역 제목', TRANSLATION_LIMITS.title, true),
    content_md: contentText(input.content_md, '번역 본문', TRANSLATION_LIMITS.content_md, true, true),
    meta_title: contentText(input.meta_title, '번역 검색 제목', TRANSLATION_LIMITS.meta_title),
    meta_description: contentText(input.meta_description, '번역 검색 설명', TRANSLATION_LIMITS.meta_description),
  };
}
