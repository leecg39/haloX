import crypto from 'node:crypto';
import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import type { PersistentHaloXStore } from './store.ts';
import { contentText, validateContentBody } from './content-model.ts';
import { checkContentRevision, contentJob, selectedContentDraft } from './content-service.ts';
import { createDeepLClient, translationBatches, type DeepLClient, type TranslatedPiece } from './deepl.ts';
import { translationLocale, validateTranslationBody } from './translation-model.ts';
import { ExternalServiceError } from './public-json.ts';

export const TRANSLATION_COMMANDS = ['translate-content-v2', 'translation-run-update', 'translation-run-delete', 'translation-run-resolve'];
const where = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id ? { id: `eq.${String(id)}` } : {}) });
const active = (row: Row) => ['running', 'unknown'].includes(String(row.status));
const emptyBody = () => ({ title: '', content_md: '', meta_title: '', meta_description: '' });
function admin(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceMember(workspace, actor);
  const member = db.queryTable('workspace_members', { filters: { ...where(workspace), user_id: `eq.${actor}` } }, actor).data[0];
  if (!['owner', 'admin'].includes(String(member?.role))) throw new RlsAccessDeniedError('자동 번역 실행과 이력 관리에는 워크스페이스 관리자 권한이 필요합니다.');
}
function get(db: HaloXDatabase, workspace: string, id: unknown, actor: string) {
  if (typeof id !== 'string' || !id) throw new Error('번역 실행을 선택해 주세요.');
  const row = db.queryTable('translation_runs', { filters: where(workspace, id) }, actor).data[0];
  if (!row) throw new Error('현재 워크스페이스에서 번역 실행을 찾을 수 없습니다.');
  return row;
}
const update = (db: HaloXDatabase, workspace: string, row: Row, values: Row, actor: string) => db.updateTable('translation_runs', { ...values, revision: Number(row.revision) + 1 }, where(workspace, row.id), actor)[0];
const outcome = (run: Row, reused = false): Row => ({ ok: ['running', 'succeeded'].includes(String(run.status)), run, reused, ...(['running', 'succeeded'].includes(String(run.status)) ? {} : { error: run.error || '이 요청은 종료되었습니다. 실행 이력을 확인해 주세요.' }) });

/** Persist each confirmed batch; no retry/resume path may repeat paid network I/O. */
export async function runTranslationCommand(store: PersistentHaloXStore, command: string, payload: Row, actor: string, suppliedClient?: DeepLClient, now = Date.now): Promise<Row> {
  if (!TRANSLATION_COMMANDS.includes(command)) throw new Error('지원하지 않는 번역 작업입니다.');
  const workspace = contentText(payload.workspace_id, '워크스페이스', 100, true);
  await store.read(db => admin(db, workspace, actor));
  if (command !== 'translate-content-v2') return store.write(db => {
    admin(db, workspace, actor);
    const row = get(db, workspace, payload.run_id, actor); checkContentRevision(row, payload.expected_revision);
    if (command === 'translation-run-resolve') {
      if (!active(row) || payload.confirm !== true) throw new Error('결과를 확인하지 못한 실행을 선택하고 과금 가능성을 확인해 주세요.');
      if (now() - Date.parse(String(row.last_checkpoint_at)) < 5 * 60 * 1000) throw new Error('마지막 진행 기록으로부터 5분 후 종료할 수 있습니다. 잠시 후 새로고침해 주세요.');
      db.callRpc('commit_reservation', { p_reservation_id: row.reservation_id }, actor);
      return { ok: true, run: update(db, workspace, row, { status: 'abandoned', finished_at: new Date(now()).toISOString(), error: '사용자가 실행을 종료했습니다. DeepL 과금 여부는 별도로 확인해야 합니다.', quota_status: 'committed' }, actor) };
    }
    if (active(row)) throw new Error('진행 중이거나 결과가 불확실한 실행은 먼저 종료해야 합니다.');
    if (command === 'translation-run-delete') { db.deleteTable('translation_runs', where(workspace, row.id), actor); return { ok: true }; }
    return { ok: true, run: update(db, workspace, row, { notes: contentText(payload.notes, '실행 메모', 5000) }, actor) };
  });
  if (payload.confirm !== true) throw new Error('DeepL로 원문을 전송하고 번역 비용이 발생할 수 있음을 확인해 주세요.');
  const key = contentText(payload.idempotency_key, '요청 키', 100, true);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(['job_id', 'expected_content_revision', 'source_locale', 'locale'].map(field => payload[field] ?? null))).digest('hex');
  const prepared = await store.write(db => {
    admin(db, workspace, actor);
    const previous = db.getServerRecords('translation_requests').find(row => row.workspace_id === workspace && row.actor_id === actor && row.key === key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('같은 요청 키를 다른 번역에 사용할 수 없습니다.');
      const run = db.queryTable('translation_runs', { filters: where(workspace, previous.run_id) }, actor).data[0];
      return { reused: true as const, result: run ? outcome(run, true) : { ok: false, reused: true, error: '삭제한 번역 실행입니다. 이 요청은 다시 전송되지 않습니다.' } };
    }
    const sourceLocale = translationLocale(payload.source_locale), targetLocale = translationLocale(payload.locale);
    const job = contentJob(db, workspace, payload.job_id, actor); checkContentRevision(job, payload.expected_content_revision);
    const draft = selectedContentDraft(db, job, actor); if (!draft) throw new Error('저장된 원문이 없습니다.');
    const batches = translationBatches(draft, sourceLocale, targetLocale);
    if (db.queryTable('article_translations', { filters: where(workspace) }, actor).data.some(row => row.source_identity === draft.id && row.locale === targetLocale)) throw new Error('이 원문 버전의 번역문이 이미 있습니다. 기존 번역문을 확인해 주세요.');
    if (db.queryTable('translation_runs', { filters: where(workspace) }, actor).data.some(row => row.source_identity === draft.id && row.locale === targetLocale && active(row))) throw new Error('같은 원문의 번역이 진행 중이거나 결과가 불확실합니다. 실행 이력을 확인해 주세요.');
    const client = suppliedClient || createDeepLClient(); // Validate configuration before reserving usage.
    const id = crypto.randomUUID();
    const reservation = db.callRpc('reserve_unit_with_bypass', { p_workspace_id: workspace, p_unit_key: 'content_gen', p_amount: 1, p_idempotency_key: `translation:${id}` }, actor) as Row;
    const [run] = db.insertTable('translation_runs', {
      id, workspace_id: workspace, content_job_id: job.id, source_draft_id: draft.id, source_identity: draft.id,
      source_snapshot: { ...validateContentBody(draft), version: draft.version }, source_locale: sourceLocale, locale: targetLocale,
      title: draft.title, provider: 'deepl', status: 'running', revision: 1, notes: '', error: '', created_by: actor,
      translation_id: null, reservation_id: reservation.reservation_id, quota_status: 'reserved', partial_body: emptyBody(),
      total_batches: batches.length, completed_batches: 0, billed_characters: 0, billing_complete: true,
      input_characters: batches.flat().reduce((sum, piece) => sum + [...piece.text].length, 0), last_checkpoint_at: new Date(now()).toISOString(),
    }, actor);
    db.setServerRecords('translation_requests', [...db.getServerRecords('translation_requests'), { workspace_id: workspace, actor_id: actor, key, fingerprint, run_id: id }]);
    return { reused: false as const, run, batches, client, sourceLocale, targetLocale };
  });
  if (prepared.reused) return prepared.result;
  for (const batch of prepared.batches) {
    let results: TranslatedPiece[] | undefined, failure: ExternalServiceError | undefined;
    try { results = await prepared.client.translate(batch, prepared.sourceLocale, prepared.targetLocale); }
    catch (cause) { failure = cause instanceof ExternalServiceError ? cause : new ExternalServiceError('번역 요청 결과를 확인할 수 없습니다.'); }
    // No SQLite lock is held during the external request.
    const checkpoint = await store.write(db => {
      const row = get(db, workspace, prepared.run.id, actor);
      if (row.status !== 'running') return row;
      const stamp = new Date(now()).toISOString();
      if (failure) {
        const release = !failure.uncertain && Number(row.completed_batches) === 0;
        db.callRpc(release ? 'release_reservation' : 'commit_reservation', { p_reservation_id: row.reservation_id }, actor);
        return update(db, workspace, row, { status: failure.uncertain ? 'unknown' : 'failed', error: failure.message, finished_at: stamp, last_checkpoint_at: stamp, quota_status: release ? 'released' : 'committed', billing_complete: row.billing_complete && !failure.uncertain }, actor);
      }
      const partial = { ...(row.partial_body as ReturnType<typeof emptyBody>) };
      batch.forEach((piece, index) => { partial[piece.field] += results![index].text; });
      const values: Row = { partial_body: partial, completed_batches: Number(row.completed_batches) + 1, billed_characters: Number(row.billed_characters) + results!.reduce((sum, item) => sum + (item.billed_characters ?? 0), 0), billing_complete: row.billing_complete && results!.every(item => item.billed_characters !== null), last_checkpoint_at: stamp };
      // Preserve confirmed partial results even when the output exceeds editor limits.
      if (Object.values(partial).some(value => value.length > 400000)) {
        db.callRpc('commit_reservation', { p_reservation_id: row.reservation_id }, actor);
        return update(db, workspace, row, { ...values, status: 'failed', error: '번역 결과가 저장 한도를 초과했습니다. 확인된 부분 결과를 실행 이력에서 확인해 주세요.', finished_at: stamp, quota_status: 'committed' }, actor);
      }
      return update(db, workspace, row, values, actor);
    });
    if (checkpoint.status !== 'running') return outcome(checkpoint);
  }
  const run = await store.write(db => {
    const row = get(db, workspace, prepared.run.id, actor); if (row.status !== 'running') return row;
    db.callRpc('commit_reservation', { p_reservation_id: row.reservation_id }, actor);
    let body;
    try { body = validateTranslationBody(row.partial_body as Row); }
    catch { return update(db, workspace, row, { status: 'failed', quota_status: 'committed', error: '번역 결과의 길이나 필수 내용을 확인해 주세요. 확인된 결과는 실행 이력에 보관했습니다.', finished_at: new Date(now()).toISOString() }, actor); }
    const [translation] = db.insertTable('article_translations', {
      ...body, workspace_id: workspace, content_job_id: row.content_job_id, source_draft_id: row.source_draft_id,
      source_identity: row.source_identity, source_snapshot: row.source_snapshot, source_locale: row.source_locale, locale: row.locale,
      origin: 'deepl', status: 'draft', revision: 1, notes: '', translation_run_id: row.id,
    }, actor);
    return update(db, workspace, row, { status: 'succeeded', translation_id: translation.id, quota_status: 'committed', partial_body: emptyBody(), finished_at: new Date(now()).toISOString() }, actor);
  });
  return outcome(run);
}
