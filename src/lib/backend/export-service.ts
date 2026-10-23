import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { contentText, validateContentBody } from './content-model.ts';
import { checkContentRevision, contentJob, selectedContentDraft } from './content-service.ts';
import { createExportFile, exportFormat } from './export-files.ts';
import { MAX_EXPORT_WORKSPACE_BYTES, TRANSLATION_LOCALES, TRANSLATION_STATUS } from '../api/exports.ts';

export const EXPORT_COMMANDS = ['export-create', 'export-update', 'export-delete', 'export-destination-create', 'export-destination-update', 'export-destination-delete', 'translation-create', 'translation-update', 'translation-delete'];
const where = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id ? { id: `eq.${String(id)}` } : {}) });
function item(db: HaloXDatabase, table: string, workspace: string, id: unknown, actor: string): Row {
  if (typeof id !== 'string' || !id) throw new Error('대상 항목을 선택해 주세요.');
  const row = db.queryTable(table, { filters: where(workspace, id) }, actor).data[0];
  if (!row) throw new Error('현재 워크스페이스에서 항목을 찾을 수 없습니다.');
  return row;
}
function locale(value: unknown) {
  if (typeof value !== 'string' || !Object.hasOwn(TRANSLATION_LOCALES, value)) throw new Error('지원하는 언어를 선택해 주세요.');
  return value;
}
function translationBody(payload: Row) {
  if (!Object.hasOwn(TRANSLATION_STATUS, String(payload.status))) throw new Error('번역문 검토 상태를 선택해 주세요.');
  return { ...validateContentBody(payload), status: payload.status, notes: contentText(payload.notes, '메모', 5000) };
}
function destinationBody(payload: Row) {
  const name = contentText(payload.name, '설정 이름', 100, true);
  const file_prefix = contentText(payload.file_prefix, '파일명 접두어', 40);
  if (/[\p{Cc}\p{Cf}<>:"/\\|?*]/u.test(file_prefix)) throw new Error('파일명 접두어에 경로나 특수 제어문자를 사용할 수 없습니다.');
  if (typeof payload.include_metadata !== 'boolean') throw new Error('메타 정보 포함 여부를 선택해 주세요.');
  return { name, file_prefix, format: exportFormat(payload.format), include_metadata: payload.include_metadata, kind: 'download' };
}

/** These commands are committed together with private file bytes inside Store.write. */
export function runExportCommand(db: HaloXDatabase, command: string, payload: Row, workspace: string, actor: string): Row {
  db.assertWorkspaceMember(workspace, actor);
  if (command.startsWith('export-destination-')) {
    const row = command.endsWith('-create') ? undefined : item(db, 'export_destinations', workspace, payload.destination_id, actor);
    if (row?.kind === 'wordpress') throw new Error('WordPress 전용 연결 기능을 사용해 주세요.');
    if (row) checkContentRevision(row, payload.expected_revision);
    if (command.endsWith('-delete')) { db.deleteTable('export_destinations', where(workspace, row!.id), actor); return { ok: true }; }
    const values = destinationBody(payload);
    if (db.queryTable('export_destinations', { filters: where(workspace) }, actor).data.some(other => other.id !== row?.id && String(other.name).toLocaleLowerCase() === values.name.toLocaleLowerCase())) throw new Error('같은 이름의 내보내기 설정이 있습니다.');
    const [destination] = row ? db.updateTable('export_destinations', { ...values, revision: Number(row.revision) + 1 }, where(workspace, row.id), actor) : db.insertTable('export_destinations', { ...values, workspace_id: workspace, revision: 1 }, actor);
    return { ok: true, destination };
  }
  if (command === 'translation-create') {
    const job = contentJob(db, workspace, payload.job_id, actor); checkContentRevision(job, payload.expected_content_revision);
    const draft = selectedContentDraft(db, job, actor); if (!draft) throw new Error('저장된 원문이 없습니다.');
    const targetLocale = locale(payload.locale), sourceLocale = locale(payload.source_locale);
    if (targetLocale === sourceLocale) throw new Error('원문과 다른 번역 언어를 선택해 주세요.');
    if (db.queryTable('article_translations', { filters: where(workspace) }, actor).data.some(row => row.source_identity === draft.id && row.locale === targetLocale)) throw new Error('이 원문 버전의 번역문이 이미 있습니다. 기존 번역문을 수정해 주세요.');
    const [translation] = db.insertTable('article_translations', {
      ...translationBody(payload), workspace_id: workspace, content_job_id: job.id, source_draft_id: draft.id,
      source_identity: draft.id, source_snapshot: { ...validateContentBody(draft), version: draft.version },
      source_locale: sourceLocale, locale: targetLocale, origin: 'manual', revision: 1,
    }, actor);
    return { ok: true, translation };
  }
  if (command === 'translation-update' || command === 'translation-delete') {
    const row = item(db, 'article_translations', workspace, payload.translation_id, actor); checkContentRevision(row, payload.expected_revision);
    if (command === 'translation-delete') { db.deleteTable('article_translations', where(workspace, row.id), actor); return { ok: true }; }
    if (row.origin !== 'manual') throw new Error('이전 데모 번역은 삭제한 뒤 실제 번역문을 등록해 주세요.');
    const [translation] = db.updateTable('article_translations', { ...translationBody(payload), revision: Number(row.revision) + 1 }, where(workspace, row.id), actor);
    return { ok: true, translation };
  }
  if (command === 'export-update' || command === 'export-delete') {
    const row = item(db, 'export_history', workspace, payload.export_id, actor); checkContentRevision(row, payload.expected_revision);
    if (command === 'export-delete') { db.deleteTable('export_history', where(workspace, row.id), actor); return { ok: true }; }
    const [history] = db.updateTable('export_history', { title: contentText(payload.title, '이력 이름', 200, true), notes: contentText(payload.notes, '메모', 5000), revision: Number(row.revision || 0) + 1 }, where(workspace, row.id), actor);
    return { ok: true, history };
  }
  if (command !== 'export-create') throw new Error('지원하지 않는 내보내기 작업입니다.');
  const key = contentText(payload.idempotency_key, '요청 키', 100, true);
  // Explicitly canonicalize the request so a retry with reordered object keys is equivalent.
  const request = Object.fromEntries(['job_id', 'expected_content_revision', 'translation_id', 'expected_translation_revision', 'destination_id', 'expected_destination_revision', 'format', 'include_metadata'].map(field => [field, payload[field] ?? null]));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const files = db.getServerRecords('export_files');
  const prior = files.find(row => row.workspace_id === workspace && row.actor_id === actor && row.request_key === key);
  if (prior) {
    if (prior.request_hash !== fingerprint) throw new Error('같은 요청 키를 다른 내보내기에 사용할 수 없습니다.');
    return { ok: true, history: item(db, 'export_history', workspace, prior.export_id, actor), reused: true };
  }
  let source: Row, jobId: unknown, draftId: unknown, sourceVersion: unknown;
  if (payload.translation_id) {
    const translation = item(db, 'article_translations', workspace, payload.translation_id, actor); checkContentRevision(translation, payload.expected_translation_revision);
    if (translation.origin !== 'manual' || translation.status !== 'ready') throw new Error('검토를 마친 실제 번역문만 내보낼 수 있습니다.');
    source = translation; jobId = translation.content_job_id; draftId = translation.source_draft_id; sourceVersion = (translation.source_snapshot as Row)?.version;
  } else {
    const job = contentJob(db, workspace, payload.job_id, actor); checkContentRevision(job, payload.expected_content_revision);
    const draft = selectedContentDraft(db, job, actor); if (!draft) throw new Error('내보낼 본문 버전이 없습니다.');
    source = draft; jobId = job.id; draftId = draft.id; sourceVersion = draft.version;
  }
  const destination = payload.destination_id ? item(db, 'export_destinations', workspace, payload.destination_id, actor) : undefined;
  if (destination?.kind !== 'download' && destination) throw new Error('다운로드용 파일 설정을 선택해 주세요.');
  if (destination) checkContentRevision(destination, payload.expected_destination_revision);
  const format = exportFormat(destination?.format ?? payload.format);
  const includeMetadata = destination?.include_metadata ?? payload.include_metadata;
  if (typeof includeMetadata !== 'boolean') throw new Error('메타 정보 포함 여부를 선택해 주세요.');
  const { base64, ...metadata } = createExportFile(source, format, includeMetadata, String(destination?.file_prefix || ''));
  const used = files.filter(row => row.workspace_id === workspace).reduce((sum, row) => sum + Number(row.byte_size), 0);
  if (used + metadata.byte_size > MAX_EXPORT_WORKSPACE_BYTES) throw new Error('내보내기 파일 저장 한도 50MB를 초과했습니다. 이전 이력을 삭제해 주세요.');
  const [history] = db.insertTable('export_history', {
    ...metadata, workspace_id: workspace, content_job_id: jobId ?? null, content_draft_id: draftId ?? null,
    translation_id: payload.translation_id || null, translation_revision: payload.translation_id ? source.revision : null,
    locale: payload.translation_id ? source.locale : null, source_version: sourceVersion, source_title: source.title,
    destination_id: destination?.id ?? null, destination_snapshot: destination ? { name: destination.name, format, file_prefix: destination.file_prefix, include_metadata: includeMetadata } : null,
    title: source.title, notes: '', format, include_metadata: includeMetadata, revision: 1, status: 'created', created_by: actor,
  }, actor);
  db.setServerRecords('export_files', [...files, { ...metadata, base64, export_id: history.id, workspace_id: workspace, actor_id: actor, request_key: key, request_hash: fingerprint }]);
  return { ok: true, history, reused: false };
}

export function readExportFile(db: HaloXDatabase, id: string, actor: string): Row | null {
  const record = db.queryTable('export_history', { filters: { id: `eq.${id}` } }, actor).data[0];
  if (!record) return null;
  return db.getServerRecords('export_files').find(file => file.export_id === id && file.workspace_id === record.workspace_id) ?? null;
}
