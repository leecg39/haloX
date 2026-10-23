export const KNOWLEDGE_TYPES = { product: '제품', service: '서비스', brand: '브랜드', research: '리서치', faq: 'FAQ', other: '기타' };
export const LIBRARY_TABLES = ['writing_style_profiles', 'writing_style_samples', 'knowledge_entities', 'knowledge_entity_sources', 'evidence_contexts', 'keyword_knowledge_entities', 'keywords', 'content_jobs', 'content_drafts'] as const;
export type LibraryTable = typeof LIBRARY_TABLES[number];
export type LibraryRow = { id: string; [key: string]: unknown };
export type LibraryData = Record<LibraryTable, LibraryRow[]>;
export const MAX_LIBRARY_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_LIBRARY_WORKSPACE_BYTES = 50 * 1024 * 1024;
