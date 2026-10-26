import type { HaloXDatabase, Row } from './database.ts';
import { ContentConflictError, contentSections, contentText, validateContentBody } from './content-model.ts';

export const CONTENT_COMMANDS = ['content-create', 'content-save', 'content-update', 'content-select', 'content-restore', 'content-delete-version', 'content-delete'];

export function contentJob(db: HaloXDatabase, workspaceId: string, id: unknown, actor: string): Row {
  const job = db.queryTable('content_jobs', { filters: { workspace_id: `eq.${workspaceId}`, id: `eq.${String(id || '')}` } }, actor).data[0];
  if (!job) throw new Error('콘텐츠를 찾을 수 없습니다.');
  return job;
}

export function checkContentRevision(job: Row, expected: unknown) {
  if (!Number.isSafeInteger(expected) || Number(expected) < 0) throw new Error('수정할 콘텐츠의 revision이 필요합니다.');
  if (Number(job.revision || 0) !== expected) throw new ContentConflictError();
}

export function selectedContentDraft(db: HaloXDatabase, job: Row, actor: string): Row | undefined {
  return db.queryTable('content_drafts', { filters: { content_job_id: `eq.${job.id}`, workspace_id: `eq.${job.workspace_id}` } }, actor).data.find(row => job.current_draft_id ? row.id === job.current_draft_id : row.is_selected);
}

/** Call inside PersistentHaloXStore.write so the version, composition, pointer and quota commit together. */
export function saveContentVersion(db: HaloXDatabase, job: Row, input: Row, actor: string, origin: string, sourceDraft?: Row) {
  const body = validateContentBody(input);
  const where = { content_job_id: `eq.${job.id}`, workspace_id: `eq.${job.workspace_id}` };
  const versions = db.queryTable('content_drafts', { filters: where }, actor).data;
  const version = Math.max(Number(job.latest_version || 0), ...versions.map(row => Number(row.version)), 0) + 1;
  const wordCount = body.content_md.trim().split(/\s+/u).length;
  const [draft] = db.insertTable('content_drafts', {
    ...body, workspace_id: job.workspace_id, content_job_id: job.id, version, origin,
    restored_from_version: origin === 'restored' ? sourceDraft?.version : null,
    generation_context: Object.hasOwn(input, 'generation_context') ? input.generation_context : sourceDraft && Object.hasOwn(sourceDraft, 'generation_context') ? sourceDraft.generation_context : job.generation_context ?? null,
    grounding_sources: input.grounding_sources ?? sourceDraft?.grounding_sources ?? [],
    provider_receipt: origin === 'generated' ? input.provider_receipt ?? null : origin === 'restored' ? sourceDraft?.provider_receipt ?? null : null,
    word_count: wordCount, character_count: body.content_md.length, is_selected: false,
    // Edited text has not been evaluated by a provider; do not copy stale scores.
    seo_score: origin === 'generated' ? input.seo_score : null, aio_score: origin === 'generated' ? input.aio_score : null,
  }, actor);
  const sections = contentSections(body.content_md);
  if (sections.length) db.insertTable('content_compositions', sections.map(section => ({ ...section, ...{ workspace_id: job.workspace_id, content_job_id: job.id, content_draft_id: draft.id } })), actor);
  db.updateTable('content_drafts', { is_selected: false }, where, actor);
  const [selected] = db.updateTable('content_drafts', { is_selected: true }, { ...where, id: `eq.${draft.id}` }, actor);
  const [updated] = db.updateTable('content_jobs', { title: body.title, current_draft_id: draft.id, latest_version: version, revision: Number(job.revision || 0) + 1, stage: 'completed', strategy_status: 'completed', writing_status: 'completed' }, { id: `eq.${job.id}`, workspace_id: `eq.${job.workspace_id}` }, actor);
  return { ok: true, job: updated, draft: selected };
}

export function runContentCommand(db: HaloXDatabase, command: string, payload: Row, workspaceId: string, actor: string): Row {
  if (command === 'content-create') {
    const body = validateContentBody(payload);
    const [job] = db.insertTable('content_jobs', {
      workspace_id: workspaceId, title: body.title, target_keyword: contentText(payload.target_keyword, '주제', 200, true),
      notes: payload.notes, source_url: payload.source_url, keyword_id: payload.keyword_id, geo_prompt_id: payload.geo_prompt_id,
      revision: 0, latest_version: 0, status: 'draft', origin: 'manual',
    }, actor);
    return saveContentVersion(db, job, body, actor, 'manual');
  }
  const job = contentJob(db, workspaceId, payload.job_id, actor);
  checkContentRevision(job, payload.expected_revision);
  const where = { id: `eq.${job.id}`, workspace_id: `eq.${workspaceId}` };
  if (command === 'content-delete') {
    db.deleteTable('content_jobs', where, actor); return { ok: true, deleted_id: job.id };
  }
  if (command === 'content-update') {
    const allowed = ['target_keyword', 'notes', 'status', 'source_url', 'keyword_id', 'geo_prompt_id'];
    const patch = Object.fromEntries(allowed.filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]]));
    const [updated] = db.updateTable('content_jobs', { ...patch, revision: Number(job.revision || 0) + 1 }, where, actor);
    return { ok: true, job: updated, draft: selectedContentDraft(db, updated, actor) };
  }
  if (command === 'content-save') return saveContentVersion(db, job, validateContentBody(payload), actor, 'edited', selectedContentDraft(db, job, actor));
  const draft = db.queryTable('content_drafts', { filters: { id: `eq.${String(payload.draft_id || '')}`, content_job_id: `eq.${job.id}`, workspace_id: `eq.${workspaceId}` } }, actor).data[0];
  if (!draft) throw new Error('이 콘텐츠의 버전을 찾을 수 없습니다.');
  if (command === 'content-restore') return saveContentVersion(db, job, draft, actor, 'restored', draft);
  if (command === 'content-select') {
    db.updateTable('content_drafts', { is_selected: false }, { content_job_id: `eq.${job.id}`, workspace_id: `eq.${workspaceId}` }, actor);
    const [selected] = db.updateTable('content_drafts', { is_selected: true }, { id: `eq.${draft.id}` }, actor);
    const [updated] = db.updateTable('content_jobs', { title: draft.title, current_draft_id: draft.id, revision: Number(job.revision || 0) + 1 }, where, actor);
    return { ok: true, job: updated, draft: selected };
  }
  if (command === 'content-delete-version') {
    if (draft.id === selectedContentDraft(db, job, actor)?.id) throw new Error('현재 선택한 버전은 삭제할 수 없습니다. 다른 버전을 선택해 주세요.');
    if (db.queryTable('content_review_runs', { filters: { content_job_id: `eq.${job.id}` } }, actor).data.some(run => run.base_draft_id === draft.id || run.applied_draft_id === draft.id || run.reverted_draft_id === draft.id)) throw new Error('최적화 이력에서 참조하는 버전은 삭제할 수 없습니다.');
    db.deleteTable('content_drafts', { id: `eq.${draft.id}`, workspace_id: `eq.${workspaceId}` }, actor);
    const [updated] = db.updateTable('content_jobs', { revision: Number(job.revision || 0) + 1 }, where, actor);
    return { ok: true, job: updated, draft: selectedContentDraft(db, updated, actor) };
  }
  throw new Error('지원하지 않는 콘텐츠 작업입니다.');
}
