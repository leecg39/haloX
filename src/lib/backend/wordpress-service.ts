import crypto from 'node:crypto';
import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import type { PersistentHaloXStore } from './store.ts';
import { contentText } from './content-model.ts';
import { validateTranslationBody } from './translation-model.ts';
import { checkContentRevision, contentJob, selectedContentDraft } from './content-service.ts';
import { sealIntegrationSecret, openIntegrationSecret } from './integration-secret.ts';
import { createWordPressClient, wordpressSiteUrl, type WordPressCredentials, type WordPressPost } from './wordpress.ts';
import { ExternalServiceError } from './public-json.ts';

export const WORDPRESS_COMMANDS = ['wordpress-create', 'wordpress-update', 'wordpress-delete', 'wordpress-verify', 'wordpress-publish', 'wordpress-reconcile', 'wordpress-resolve', 'wordpress-history-update', 'wordpress-history-delete'];
const where = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id ? { id: `eq.${String(id)}` } : {}) });
const active = (row: Row) => ['sending', 'unknown'].includes(String(row.status));
function get(db: HaloXDatabase, table: string, workspace: string, id: unknown, actor: string) {
  if (typeof id !== 'string' || !id) throw new Error('항목을 선택해 주세요.');
  const row = db.queryTable(table, { filters: where(workspace, id) }, actor).data[0];
  if (!row) throw new Error('현재 워크스페이스에서 항목을 찾을 수 없습니다.');
  return row;
}
function admin(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'execution', 'write');
  const member = db.queryTable('workspace_members', { filters: { ...where(workspace), user_id: `eq.${actor}` } }, actor).data[0];
  if (!['owner', 'admin'].includes(String(member?.role))) throw new RlsAccessDeniedError('외부 연결과 게시 작업에는 워크스페이스 관리자 권한이 필요합니다.');
}
function destination(db: HaloXDatabase, workspace: string, id: unknown, actor: string) {
  const row = get(db, 'export_destinations', workspace, id, actor);
  if (row.kind !== 'wordpress') throw new Error('WordPress 연결을 선택해 주세요.');
  return row;
}
function credentials(db: HaloXDatabase, row: Row): WordPressCredentials {
  const saved = db.getServerRecords('export_credentials').find(secret => secret.destination_id === row.id && secret.workspace_id === row.workspace_id);
  if (!saved) throw new Error('연결 비밀번호를 다시 저장해 주세요.');
  return { site_url: String(row.site_url), username: String(row.username), password: openIntegrationSecret(String(saved.ciphertext), `${row.workspace_id}:${row.id}`) };
}
function requireSettled(db: HaloXDatabase, workspace: string, id: unknown, actor: string) {
  if (db.queryTable('export_publications', { filters: where(workspace) }, actor).data.some(row => row.destination_id === id && active(row))) throw new Error('진행 중이거나 결과를 확인하지 못한 게시가 있습니다. 게시 이력에서 먼저 확인해 주세요.');
}
function requestIdentity(payload: Row) {
  const values = ['destination_id', 'expected_destination_revision', 'job_id', 'expected_content_revision', 'translation_id', 'expected_translation_revision', 'status'];
  return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(values.map(field => [field, payload[field] ?? null])))).digest('hex');
}
const updatePublication = (db: HaloXDatabase, workspace: string, row: Row, values: Row, actor: string) => db.updateTable('export_publications', { ...values, revision: Number(row.revision || 0) + 1 }, where(workspace, row.id), actor)[0];

/** Reserve and commit around remote I/O, never while holding the SQLite writer lock. */
export async function runWordPressCommand(store: PersistentHaloXStore, command: string, payload: Row, actor: string, client = createWordPressClient()): Promise<Row> {
  const workspace = contentText(payload.workspace_id, '워크스페이스', 100, true);
  if (!WORDPRESS_COMMANDS.includes(command)) throw new Error('지원하지 않는 WordPress 작업입니다.');
  await store.read(db => admin(db, workspace, actor));
  if (['wordpress-create', 'wordpress-update', 'wordpress-delete'].includes(command)) return store.write(db => {
    admin(db, workspace, actor);
    const old = command === 'wordpress-create' ? undefined : destination(db, workspace, payload.destination_id, actor);
    if (old) { checkContentRevision(old, payload.expected_revision); requireSettled(db, workspace, old.id, actor); }
    if (command === 'wordpress-delete') { db.deleteTable('export_destinations', where(workspace, old!.id), actor); return { ok: true }; }
    const name = contentText(payload.name, '연결 이름', 100, true), site_url = wordpressSiteUrl(contentText(payload.site_url, '사이트 주소', 2000, true)), username = contentText(payload.username, '사용자 이름', 100, true);
    if (/[:\p{Cc}]/u.test(username)) throw new Error('WordPress 사용자 이름을 확인해 주세요.');
    if (db.queryTable('export_destinations', { filters: where(workspace) }, actor).data.some(row => row.id !== old?.id && String(row.name).toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('같은 이름의 내보내기 설정이 있습니다.');
    const password = contentText(payload.password, '애플리케이션 비밀번호', 200).replace(/\s/g, '');
    if (!password && (!old || old.site_url !== site_url || old.username !== username)) throw new Error('연결 대상이 바뀌면 애플리케이션 비밀번호를 다시 입력해 주세요.');
    if (password && !/^[a-zA-Z0-9]{24}$/.test(password)) throw new Error('WordPress에서 생성한 24자리 애플리케이션 비밀번호를 입력해 주세요.');
    const id = old?.id || crypto.randomUUID();
    const cipher = password ? sealIntegrationSecret(password, `${workspace}:${id}`) : undefined;
    const values = { name, site_url, username, kind: 'wordpress', has_credentials: true, verification_status: 'unverified', verified_revision: null, can_publish: false, verification_error: '', revision: Number(old?.revision || 0) + 1 };
    const [row] = old ? db.updateTable('export_destinations', values, where(workspace, id), actor) : db.insertTable('export_destinations', { ...values, id, workspace_id: workspace }, actor);
    if (cipher) db.setServerRecords('export_credentials', [...db.getServerRecords('export_credentials').filter(secret => secret.destination_id !== id), { workspace_id: workspace, destination_id: id, ciphertext: cipher }]);
    return { ok: true, destination: row };
  });
  if (command === 'wordpress-verify') {
    const saved = await store.read(db => { const row = destination(db, workspace, payload.destination_id, actor); checkContentRevision(row, payload.expected_revision); return { row, credentials: credentials(db, row) }; });
    let checked: Row | undefined, error: ExternalServiceError | undefined;
    try { checked = await client.verify(saved.credentials); } catch (cause) { error = cause instanceof ExternalServiceError ? cause : new ExternalServiceError('WordPress 연결을 확인하지 못했습니다.'); }
    const row = await store.write(db => {
      admin(db, workspace, actor); const current = destination(db, workspace, saved.row.id, actor); checkContentRevision(current, saved.row.revision);
      return db.updateTable('export_destinations', { verification_status: checked ? 'verified' : 'failed', verified_revision: checked ? current.revision : null, verified_at: new Date().toISOString(), can_publish: checked?.can_publish || false, verification_error: error?.message || '' }, where(workspace, current.id), actor)[0];
    });
    if (error) throw error;
    return { ok: true, destination: row };
  }
  if (['wordpress-history-update', 'wordpress-history-delete', 'wordpress-resolve'].includes(command)) return store.write(db => {
    admin(db, workspace, actor); const row = get(db, 'export_publications', workspace, payload.publication_id, actor); checkContentRevision(row, payload.expected_revision);
    if (command === 'wordpress-resolve') {
      if (!active(row) || Date.now() - Date.parse(String(row.created_at)) < 60000 || payload.confirm_absent !== true) throw new Error('요청 후 1분이 지나면 WordPress에서 직접 확인한 뒤 결과를 정리할 수 있습니다.');
      return { ok: true, publication: updatePublication(db, workspace, row, { status: 'unconfirmed', error: '관리자가 원격 상태를 직접 확인하고 이력을 정리했습니다. 자동 재전송하지 않습니다.', resolved_at: new Date().toISOString() }, actor) };
    }
    if (command === 'wordpress-history-delete') {
      if (active(row)) throw new Error('결과를 확인한 게시 이력만 삭제할 수 있습니다.');
      db.deleteTable('export_publications', where(workspace, row.id), actor); return { ok: true };
    }
    return { ok: true, publication: updatePublication(db, workspace, row, { notes: contentText(payload.notes, '게시 메모', 5000) }, actor) };
  });
  if (command === 'wordpress-reconcile') {
    const saved = await store.read(db => {
      const row = get(db, 'export_publications', workspace, payload.publication_id, actor); checkContentRevision(row, payload.expected_revision);
      if (!active(row)) throw new Error('결과를 확인하지 못한 게시만 조회할 수 있습니다.');
      if (row.status === 'sending' && Date.now() - Date.parse(String(row.created_at)) < 30000) throw new Error('게시 요청을 처리 중입니다. 잠시 후 다시 확인해 주세요.');
      const target = destination(db, workspace, row.destination_id, actor);
      return { row, credentials: credentials(db, target) };
    });
    const found = await client.find(saved.credentials, String(saved.row.remote_slug));
    const publication = await store.write(db => {
      admin(db, workspace, actor); const row = get(db, 'export_publications', workspace, saved.row.id, actor);
      if (!active(row)) return row;
      return updatePublication(db, workspace, row, found ? success(found) : { status: 'unknown', error: '원격 게시물을 찾지 못했습니다. WordPress에서 직접 확인해 주세요.' }, actor);
    });
    return { ok: true, publication };
  }
  if (payload.confirm !== true || !['draft', 'publish'].includes(String(payload.status))) throw new Error('미리보기에서 게시 대상과 상태를 확인해 주세요.');
  const key = contentText(payload.idempotency_key, '요청 키', 100, true), fingerprint = requestIdentity(payload);
  const prepared = await store.write(db => {
    admin(db, workspace, actor);
    const previous = db.getServerRecords('export_requests').find(row => row.workspace_id === workspace && row.actor_id === actor && row.key === key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('다른 게시 요청에 같은 요청 키를 사용할 수 없습니다.');
      return { reused: true as const, publication: get(db, 'export_publications', workspace, previous.publication_id, actor) };
    }
    const target = destination(db, workspace, payload.destination_id, actor); checkContentRevision(target, payload.expected_destination_revision);
    if (target.verification_status !== 'verified' || target.verified_revision !== target.revision) throw new Error('WordPress 연결을 먼저 확인해 주세요.');
    if (payload.status === 'publish' && !target.can_publish) throw new Error('이 WordPress 계정은 공개 게시 권한이 없습니다.');
    let source: Row, jobId: unknown, draftId: unknown, sourceKey: string;
    if (payload.translation_id) {
      const translation = get(db, 'article_translations', workspace, payload.translation_id, actor); checkContentRevision(translation, payload.expected_translation_revision);
      if (!['manual', 'deepl', 'openai'].includes(String(translation.origin)) || translation.status !== 'ready') throw new Error('검토를 마친 번역문만 게시할 수 있습니다.');
      source = translation; jobId = translation.content_job_id; draftId = translation.source_draft_id; sourceKey = `${translation.id}:${translation.revision}`;
    } else {
      const job = contentJob(db, workspace, payload.job_id, actor); checkContentRevision(job, payload.expected_content_revision);
      const draft = selectedContentDraft(db, job, actor); if (!draft) throw new Error('게시할 원문이 없습니다.');
      if (payload.status === 'publish' && job.status !== 'ready') throw new Error('공개 게시할 콘텐츠를 제작소에서 사용 준비 상태로 변경해 주세요.');
      source = draft; jobId = job.id; draftId = draft.id; sourceKey = String(draft.id);
    }
    const records = db.queryTable('export_publications', { filters: where(workspace) }, actor).data;
    if (records.some(row => row.destination_id === target.id && row.source_key === sourceKey && ['sending', 'unknown', 'succeeded'].includes(String(row.status)))) throw new Error('이 버전의 게시 이력이 이미 있습니다. 게시 이력에서 결과를 확인해 주세요.');
    const auth = credentials(db, target), id = crypto.randomUUID();
    const [publication] = db.insertTable('export_publications', { id, workspace_id: workspace, destination_id: target.id, destination_snapshot: { name: target.name, site_url: target.site_url, username: target.username }, source_key: sourceKey,
      content_job_id: jobId ?? null, content_draft_id: draftId ?? null, translation_id: payload.translation_id || null,
      source_snapshot: validateTranslationBody(source), title: source.title, requested_status: payload.status, status: 'sending', remote_slug: `halox-${id}`, notes: '', revision: 1, created_by: actor,
    }, actor);
    db.setServerRecords('export_requests', [...db.getServerRecords('export_requests'), { workspace_id: workspace, actor_id: actor, key, fingerprint, publication_id: id }]);
    return { reused: false as const, publication, auth };
  });
  if (prepared.reused) {
    const failed = ['failed', 'unknown', 'unconfirmed'].includes(String(prepared.publication.status));
    return { ok: !failed, publication: prepared.publication, reused: true, ...(failed ? { error: prepared.publication.error || '게시 이력에서 결과를 확인해 주세요.' } : {}) };
  }
  let result: WordPressPost | undefined, error: ExternalServiceError | undefined;
  try { result = await client.publish(prepared.auth!, prepared.publication.source_snapshot as Row, payload.status as 'draft' | 'publish', String(prepared.publication.remote_slug)); }
  catch (cause) { error = cause instanceof ExternalServiceError ? cause : new ExternalServiceError('WordPress 게시 결과를 확인할 수 없습니다.'); }
  const publication = await store.write(db => {
    // If membership was revoked during I/O, RLS leaves this record unresolved;
    // a current administrator can reconcile it without reposting.
    const row = get(db, 'export_publications', workspace, prepared.publication.id, actor);
    if (!active(row)) return row;
    return updatePublication(db, workspace, row, result ? success(result) : { status: error!.uncertain ? 'unknown' : 'failed', error: error!.message, finished_at: new Date().toISOString() }, actor);
  });
  return { ok: !error, publication, ...(error ? { error: error.message, code: error.code } : {}) };
}

function success(post: WordPressPost): Row { return { status: 'succeeded', remote_post_id: post.id, remote_url: post.url, remote_status: post.status, error: '', finished_at: new Date().toISOString() }; }
