import type { HaloXDatabase, Row } from './database.ts';
import type { GapData, GapMatrixRow } from '../api/gaps.ts';
import { readAnalysisData, analysisWhere } from './analysis-model.ts';

export const normalizeCandidate = (value: unknown) => String(value).trim().normalize('NFKC').toLowerCase();
export function readGapData(db: HaloXDatabase, workspace: string, actor: string, filters: unknown): GapData {
  db.assertWorkspaceMember(workspace, actor);
  const seo = readAnalysisData(db, workspace, actor, 'seo', filters);
  // Set, tag and text filters select keywords. Linked question evidence is not text-filtered by a keyword phrase.
  const geo = readAnalysisData(db, workspace, actor, 'geo', { ...seo.filters, query: '', engine: '', domain: '', set_id: '', tag_id: '', status: 'all' });
  const rows = (table: string) => db.queryTable(table, { filters: analysisWhere(workspace), order: 'created_at.desc' }, actor).data;
  const links = rows('keyword_prompt_links'), jobs = rows('content_jobs');
  const matrix = seo.entities.map(entity => {
    const search = seo.latest.filter(row => row.entity_id === entity.id && row.rank_measured), ranks = search.flatMap(row => row.rank === null ? [] : [row.rank]);
    const rank = ranks.length ? Math.min(...ranks) : null, promptIds = new Set(links.filter(row => row.keyword_id === entity.id).map(row => row.prompt_id));
    const measurements = geo.latest.filter(row => promptIds.has(row.entity_id) && row.cited !== null), cited = measurements.filter(row => row.cited).length, found = rank !== null && rank <= 10;
    const state: GapMatrixRow['state'] = !search.length || !measurements.length ? 'unmeasured' : found && cited ? 'both' : found ? 'search_only' : cited ? 'ai_only' : 'neither';
    return { id: entity.id, text: entity.text, language: entity.language, country: entity.country, rank, search_measured: search.length > 0, prompt_count: promptIds.size, measured: measurements.length, cited, state, content_ids: jobs.filter(row => normalizeCandidate(row.target_keyword) === normalizeCandidate(entity.text)).map(row => String(row.id)) };
  });
  return { seo, geo, matrix, candidates: rows('geo_prompt_candidates'), decisions: rows('opportunity_decisions'), keywords: rows('keywords').filter(row => !row.deleted_at), prompts: rows('geo_prompts').filter(row => !row.deleted_at), prompt_sets: rows('geo_prompt_sets'), content_jobs: jobs } as GapData;
}
