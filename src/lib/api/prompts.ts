import type { CollectionDefaults } from './general-settings';
export const GEO_ENGINES = { openai: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' } as const;
export const GEO_CATEGORIES = { recommendation: '추천', comparison: '비교', informational: '정보', transactional: '구매' } as const;
export const PROMPT_PAGE_TABLES = ['geo_prompts', 'geo_prompt_sets', 'geo_prompt_runs', 'geo_answers_raw', 'geo_citations', 'geo_run_metrics', 'workspace_tags', 'workspace_tag_groups', 'geo_prompt_tag_assignments', 'keyword_prompt_links', 'keywords'] as const;
export type PromptTable = typeof PROMPT_PAGE_TABLES[number];
export type PromptRow = { id: string; updated_at?: string; [key: string]: unknown };
export type PromptData = Record<PromptTable, PromptRow[]> & { defaults?: CollectionDefaults };
