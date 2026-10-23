import type { ContentRow } from './content.ts';
export type SiteCollection = 'site_pages' | 'site_posts' | 'site_taxonomies' | 'site_translations' | 'contact_requests';
export type SiteContentData = { can_manage: boolean; contents: ContentRow[]; taxonomies: ContentRow[]; translations: ContentRow[]; contacts: ContentRow[]; catalog_count: number };
export type PublicSiteContent = { found: boolean; deleted?: boolean; captured_fallback?: boolean; content?: ContentRow };
