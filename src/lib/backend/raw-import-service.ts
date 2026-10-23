import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { contentText } from './content-model.ts';
import { analysisWhere } from './analysis-model.ts';
import { observationAdmin, observationRows } from './observation-model.ts';
import { observationItem, observationRevision, ObservationConflictError } from './monitor-service.ts';
import { parseRawImport, RAW_FILE_LIMIT } from './raw-import-format.ts';
import { RAW_PARENTS } from './raw-data-model.ts';
export const RAW_COMMANDS = ['raw-import-create', 'raw-import-update', 'raw-import-delete'];
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export function runRawImportCommand(db: HaloXDatabase, command: string, payload: Row, workspace: string, actor: string, now = Date.now()): Row {
  db.assertWorkspaceMember(workspace, actor); observationAdmin(db, workspace, actor, true);
  if (command !== 'raw-import-create') {
    const batch = observationItem(db, workspace, actor, 'raw_import_batches', payload.batch_id); observationRevision(batch, payload.expected_revision);
    if (command === 'raw-import-delete') { db.deleteTable('raw_import_batches', analysisWhere(workspace, batch.id), actor); return { ok: true }; }
    return { ok: true, batch: db.updateTable('raw_import_batches', { title: contentText(payload.title, '가져오기 이름', 100, true), notes: contentText(payload.notes, '가져오기 메모', 5000), revision: Number(batch.revision) + 1 }, analysisWhere(workspace, batch.id), actor)[0] };
  }
  const key = contentText(payload.idempotency_key, '요청 키', 200, true), title = contentText(payload.title, '가져오기 이름', 100, true), notes = contentText(payload.notes, '가져오기 메모', 5000), filename = contentText(payload.filename, '파일 이름', 200, true);
  if (!/\.json$/i.test(filename) || /[\\/\p{Cc}]/u.test(filename)) throw new Error('JSON 파일 이름을 확인해 주세요.');
  if (typeof payload.contents !== 'string' || Buffer.byteLength(payload.contents) > RAW_FILE_LIMIT || !payload.contents.trim()) throw new Error('UTF-8 JSON 파일은 2 MiB 이하여야 합니다.');
  const contents = payload.contents, sha256 = hash(contents), signature = hash(JSON.stringify({ sha256, title, notes, filename }));
  const receipts = db.getServerRecords('raw_import_requests'), receipt = receipts.find(row => row.workspace_id === workspace && row.key === key);
  if (receipt) {
    if (receipt.signature !== signature) throw new ObservationConflictError();
    const batch = observationRows(db, workspace, actor, 'raw_import_batches').find(row => row.id === receipt.batch_id); if (!batch) throw new Error('이미 가져온 뒤 삭제한 요청입니다. 새 요청으로 다시 가져와 주세요.'); return { ok: true, batch, replayed: true };
  }
  // Validate every record before writing; exact retries survive later source deletion.
  const prepared = parseRawImport(db, workspace, actor, contents, now);
  const batches = observationRows(db, workspace, actor, 'raw_import_batches'); if (batches.length >= 50) throw new Error('워크스페이스당 가져오기 묶음은 최대 50개입니다.'); if (batches.some(row => row.sha256 === sha256)) throw new Error('같은 파일이 이미 등록되어 있습니다. 기존 가져오기 내역을 확인해 주세요.');
  if (batches.reduce((sum, row) => sum + Number(row.byte_size || 0), Buffer.byteLength(contents)) > 20 * 1024 * 1024) throw new Error('가져오기 원본 보관 한도는 워크스페이스당 20 MiB입니다.');
  const originalKeys = new Set(RAW_PARENTS[prepared.kind].flatMap(table => observationRows(db, workspace, actor, table).filter(row => row.import_batch_id).map(row => row.import_key)));
  const records: Row[] = prepared.records.map(row => ({ ...row, import_key: hash(JSON.stringify([prepared.kind, prepared.source.provider, row.source_id])) })); if (records.some(row => originalKeys.has(row.import_key))) throw new Error('같은 출처·원본 식별자의 측정값이 이미 있습니다. 기존 가져오기 묶음을 확인해 주세요.');
  const measuredTimes = prepared.records.map(row => String(row.captured_at || row.finished_at || row.completed_at)).sort();
  const [batch] = db.insertTable('raw_import_batches', { workspace_id: workspace, kind: prepared.kind, title, notes, filename, byte_size: Buffer.byteLength(contents), sha256, source_provider: prepared.source.provider, source_url: prepared.source.url, record_count: records.length, first_measured_at: measuredTimes[0], last_measured_at: measuredTimes.at(-1), created_by: actor, created_at: new Date(now).toISOString(), revision: 1 }, actor);
  const provenance = { workspace_id: workspace, import_batch_id: batch.id, provider: `import:${prepared.source.provider}`, source_provider: prepared.source.provider, source_url: prepared.source.url };
  for (const record of records) {
    if (prepared.kind === 'seo') { db.insertTable('serp_snapshots', { ...record, ...provenance }, actor); continue; }
    if (prepared.kind === 'geo') {
      const { metrics, citations, ...values } = record;
      const [run] = db.insertTable('geo_prompt_runs', { ...values, ...provenance, status: 'completed', created_at: values.finished_at, started_at: values.finished_at }, actor);
      db.insertTable('geo_answers_raw', { ...provenance, prompt_id: run.prompt_id, run_id: run.id, prompt_text: run.prompt_text, engine: run.engine, answer_text: run.answer_text }, actor);
      db.insertTable('geo_run_metrics', { ...metrics as Row, ...provenance, run_id: run.id }, actor);
      if ((citations as Row[]).length) db.insertTable('geo_citations', (citations as Row[]).map(citation => ({ ...citation, ...provenance, run_id: run.id })), actor); continue;
    }
    const { pages, ...values } = record, pageRows = pages as Row[], fetched = pageRows.filter(row => row.fetch_status === 'fetched'), measured = fetched.filter(row => typeof row.html_score === 'number'), issues = pageRows.flatMap(row => row.issues as Row[]);
    const [scan] = db.insertTable('site_audit_scans', { ...values, ...provenance, status: fetched.length ? 'completed' : 'failed', revision: 1, notes: '', created_by: actor, created_at: values.completed_at, crawled_urls: fetched.length, processed_urls: pageRows.length, failed_urls: pageRows.length - fetched.length, skipped_urls: 0, critical_count: issues.filter(row => row.severity === 'critical').length, warning_count: issues.filter(row => row.severity === 'warning').length, notice_count: issues.filter(row => row.severity === 'notice').length, site_health_score: measured.length ? Math.round(measured.reduce((sum, row) => sum + Number(row.html_score), 0) / measured.length) : null, ai_readiness_score: null, quota_status: 'not_charged', stop_reason: 'imported', error: fetched.length ? '' : '가져온 자료에 정상 수집 페이지가 없습니다.' }, actor);
    for (const page of pageRows) {
      const { issues, ...fields } = page; const [stored] = db.insertTable('site_audit_pages', { ...fields, ...provenance, scan_id: scan.id, fetched_at: values.completed_at, depth: null }, actor);
      if ((issues as Row[]).length) db.insertTable('site_audit_issues', (issues as Row[]).map(issue => ({ ...issue, ...provenance, scan_id: scan.id, page_id: stored.id, page_url: stored.url, is_resolved: false, notes: '', revision: 1 })), actor);
    }
  }
  db.setServerRecords('raw_import_files', [...db.getServerRecords('raw_import_files'), { workspace_id: workspace, batch_id: batch.id, contents }]);
  db.setServerRecords('raw_import_requests', [...receipts, { workspace_id: workspace, key, signature, batch_id: batch.id }]);
  return { ok: true, batch, replayed: false };
}
export function readRawImportFile(db: HaloXDatabase, workspace: string, actor: string, id: string) {
  db.assertWorkspaceMember(workspace, actor); const batch = observationItem(db, workspace, actor, 'raw_import_batches', id), file = db.getServerRecords('raw_import_files').find(row => row.workspace_id === workspace && row.batch_id === id); if (!file) throw new Error('가져오기 원본 파일을 찾을 수 없습니다.');
  return { filename: String(batch.filename), bytes: Buffer.from(String(file.contents), 'utf8') };
}
