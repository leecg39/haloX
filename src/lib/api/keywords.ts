export const KEYWORD_PAGE_TABLES = ['keywords', 'keyword_sets', 'workspace_tags', 'workspace_tag_groups', 'keyword_tag_assignments', 'serp_snapshots', 'keyword_prompt_links', 'geo_prompts', 'keyword_ideas'] as const;
export type KeywordPageTable = typeof KEYWORD_PAGE_TABLES[number];
export type KeywordPageRow = { id: string; updated_at?: string; [key: string]: unknown };
export type KeywordPageData = Record<KeywordPageTable, KeywordPageRow[]>;
