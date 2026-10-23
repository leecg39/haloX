import { ANALYSIS_LANGUAGES, ANALYSIS_COUNTRIES, INTERFACE_LANGUAGES, type CollectionDefaults, type InterfaceLanguage } from '../api/general-settings.ts';
import type { Row } from './database.ts';
export const DEFAULT_COLLECTION: CollectionDefaults = { language: 'ko', country: 'KR', auto_generate_prompts: true };
export function interfaceLanguage(profile?: Row): InterfaceLanguage { return Object.hasOwn(INTERFACE_LANGUAGES, String(profile?.interface_language)) ? String(profile!.interface_language) as InterfaceLanguage : 'ko'; }
export function collectionDefaults(workspace?: Row): CollectionDefaults {
  return { language: Object.hasOwn(ANALYSIS_LANGUAGES, String(workspace?.default_analysis_language)) ? String(workspace!.default_analysis_language) : 'ko', country: Object.hasOwn(ANALYSIS_COUNTRIES, String(workspace?.default_analysis_country)) ? String(workspace!.default_analysis_country) : 'KR', auto_generate_prompts: workspace?.auto_generate_prompts !== false };
}
export function collectionPatch(input: Row): Row {
  if (!Object.hasOwn(ANALYSIS_LANGUAGES, String(input.language)) || !Object.hasOwn(ANALYSIS_COUNTRIES, String(input.country))) throw new Error('지원하는 기본 언어와 국가를 선택해 주세요.');
  if (typeof input.auto_generate_prompts !== 'boolean') throw new Error('프롬프트 자동 생성 여부를 확인해 주세요.');
  return { default_analysis_language: input.language, default_analysis_country: input.country, auto_generate_prompts: input.auto_generate_prompts };
}
export function autoPromptText(keyword: string, language: string) {
  switch (language.split('-')[0]) {
    case 'ko': return `${keyword}에 대해 알려주세요.`;
    case 'en': return `What should I know about ${keyword}?`;
    case 'ja': return `${keyword}について教えてください。`;
    case 'zh': return `请介绍${keyword}。`;
    default: return keyword; // Preserve unsupported-language source text instead of claiming translation.
  }
}
