import { canAccess, canWrite } from '../permissions/workspace.ts';
import type { HaloXDatabase, Row } from './database.ts';
import { contentText, ContentConflictError } from './content-model.ts';
import { analysisFilters, readAnalysisData } from './analysis-model.ts';
import { earnedHash, earnedStamp, earnedUrl, earnedValues, parseEarnedCsv } from './earned-model.ts';
import type { EarnedData, EarnedEvidence, EarnedPreview, EarnedRow } from '../api/earned.ts';
export class EarnedConflictError extends ContentConflictError { constructor() { super(); this.message = '등록 URL이 변경되었습니다. 입력을 유지했으니 최신 목록이나 CSV 미리보기를 다시 확인해 주세요.'; } }
const where = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id === undefined ? {} : { id: `eq.${id}` }) });
const publications = (db: HaloXDatabase, workspace: string, actor: string) => db.queryTable('earned_publications', { filters: where(workspace), order: 'created_at.desc' }, actor).data;
export function previewEarned(db: HaloXDatabase, workspace: string, actor: string, csv: unknown): EarnedPreview {
  db.assertWorkspaceAccess(workspace, actor, 'other', 'write');
  const rows = parseEarnedCsv(csv), existing = publications(db, workspace, actor);
  if (existing.length + rows.length > 2000) throw new Error('등록 URL은 워크스페이스당 최대 2,000개입니다.');
  const duplicate = rows.find(row => existing.some(item => item.url === row.url));
  if (duplicate) throw new Error(`이미 등록한 URL입니다: ${duplicate.url}`);
  return { rows, stamp: earnedStamp(existing), fingerprint: earnedHash(rows) };
}
export function runEarnedCommand(db: HaloXDatabase, actor: string, input: Row): Row {
  const workspace = contentText(input.workspace_id, '워크스페이스', 100, true); db.assertWorkspaceAccess(workspace, actor, 'other', 'write');
  const action = String(input.action), rows = publications(db, workspace, actor);
  if (action === 'preview') return previewEarned(db, workspace, actor, input.csv);
  if (action === 'create' || action === 'import') {
    const values = action === 'create' ? [earnedValues(input)] : parseEarnedCsv(input.csv), request = contentText(input.request_id, '요청 키', 100, true), fingerprint = earnedHash({ action, values });
    const receipts = db.getServerRecords('earned_requests'), previous = receipts.find(row => row.workspace_id === workspace && row.actor === actor && row.request_id === request);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new EarnedConflictError(); return { ok: true, reused: true, count: previous.count, rows: rows.filter(row => (previous.ids as string[]).includes(String(row.id))) }; }
    if (action === 'import') { const preview = previewEarned(db, workspace, actor, input.csv); if (preview.stamp !== input.stamp || preview.fingerprint !== input.fingerprint) throw new EarnedConflictError(); }
    if (rows.length + values.length > 2000) throw new Error('등록 URL은 워크스페이스당 최대 2,000개입니다.');
    if (values.some(value => rows.some(row => row.url === value.url))) throw new Error('이미 등록한 URL입니다.');
    const added = db.insertTable('earned_publications', values.map(value => ({ ...value, workspace_id: workspace, revision: 1, created_by: actor })), actor);
    db.setServerRecords('earned_requests', [...receipts, { workspace_id: workspace, actor, request_id: request, fingerprint, count: added.length, ids: added.map(row => row.id) }]);
    return { ok: true, rows: added, count: added.length };
  }
  if (!['update', 'delete'].includes(action)) throw new Error('지원하지 않는 등록 URL 작업입니다.');
  const row = rows.find(item => item.id === input.id); if (!row) throw new Error('현재 워크스페이스에서 등록 URL을 찾을 수 없습니다.');
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision !== Number(row.revision || 0)) throw new EarnedConflictError();
  if (action === 'delete') { db.deleteTable('earned_publications', where(workspace, row.id), actor); return { ok: true }; }
  const values = earnedValues(input);
  if (rows.some(item => item.id !== row.id && item.url === values.url)) throw new Error('이미 등록한 URL입니다.');
  return { ok: true, row: db.updateTable('earned_publications', { ...values, revision: Number(row.revision || 0) + 1 }, where(workspace, row.id), actor)[0] };
}
export function readEarned(db: HaloXDatabase, workspace: string, actor: string, period: { start?: string; end?: string } = {}): EarnedData {
  db.assertWorkspaceAccess(workspace, actor, 'other');
  const filters = analysisFilters(period, 'seo'), permission = db.workspacePermissions(workspace, actor), canRead = canAccess(permission, 'analysis');
  const rows = publications(db, workspace, actor), coverage = { serp: 0, aio: 0, geo: 0 }, evidence = new Map<string, EarnedEvidence[]>();
  for (const row of rows) evidence.set(String(row.url), []);
  const append = (url: unknown, item: Omit<EarnedEvidence, 'source_url'>) => {
    let canonical: string; try { canonical = earnedUrl(url); } catch { return; }
    const found = evidence.get(canonical); if (!found) return;
    const previous = found.find(row => row.kind === item.kind && row.sample_id === item.sample_id);
    if (previous) { if (item.rank !== null && (previous.rank === null || item.rank < previous.rank)) previous.rank = item.rank; return; }
    found.push({ ...item, source_url: String(url) });
  };
  let excluded = 0;
  if (canRead) {
    const seo = readAnalysisData(db, workspace, actor, 'seo', filters), geo = readAnalysisData(db, workspace, actor, 'geo', filters);
    excluded = seo.excluded_records + geo.excluded_records;
    const snapshots = new Map(db.queryTable('serp_snapshots', { filters: where(workspace) }, actor).data.map(row => [row.id, row]));
    for (const [kind, samples] of [['seo', seo.samples], ['geo', geo.samples]] as const) for (const sample of samples) {
      const item = { sample_id: sample.id, entity_id: sample.entity_id, text: sample.text, engine: sample.engine, at: sample.at, provider: sample.provider, rank: null };
      if (kind === 'seo') {
        const snapshot = snapshots.get(sample.id)!;
        if (Array.isArray(snapshot.top_results_json)) { coverage.serp++; for (const source of sample.sources) append(source.url, { ...item, kind: 'serp', rank: source.rank }); }
        const cited = (snapshot.ai_overview_json as Row | null)?.cited_urls;
        if (snapshot.ai_overview_detected === true && Array.isArray(cited)) { coverage.aio++; for (const url of cited) append(url, { ...item, kind: 'aio' }); }
      } else { coverage.geo++; for (const source of sample.sources) append(source.url, { ...item, kind: 'geo' }); }
    }
  }
  return { editable: canWrite(permission), can_read_analysis: canRead, start: filters.start, end: filters.end, coverage, excluded_records: excluded, generated_at: new Date().toISOString(), rows: rows.map(row => {
    const all = (evidence.get(String(row.url)) || []).sort((a, b) => b.at.localeCompare(a.at) || a.kind.localeCompare(b.kind)), ranks = all.filter(item => item.kind === 'serp' && item.rank !== null).map(item => item.rank!);
    return { ...row, evidence: all.slice(0, 100), evidence_total: all.length, serp_hits: canRead && coverage.serp ? all.filter(item => item.kind === 'serp').length : null, aio_hits: canRead && coverage.aio ? all.filter(item => item.kind === 'aio').length : null, geo_hits: canRead && coverage.geo ? all.filter(item => item.kind === 'geo').length : null, best_rank: ranks.length ? Math.min(...ranks) : null, last_seen: all[0]?.at || null } as EarnedRow;
  }) };
}
