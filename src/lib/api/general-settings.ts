export const ANALYSIS_LANGUAGES = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어' } as const;
export const ANALYSIS_COUNTRIES = { KR: '대한민국', US: '미국', JP: '일본', CN: '중국' } as const;
export type CollectionDefaults = { language: string; country: string; auto_generate_prompts: boolean };
export type GeneralSettingsData = { workspace_id: string; workspace_name: string; revision: number; editable: boolean; defaults: CollectionDefaults };
