import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import type { HaloXProviders } from './providers.ts';
import { ContentConflictError, contentSections, contentText, validateContentBody } from './content-model.ts';
import { checkContentRevision, contentJob, runContentCommand, saveContentVersion, selectedContentDraft } from './content-service.ts';
import { fetchPublicDocument } from './public-document.ts';
import { CHANGE_FIELDS, CHANGE_OPERATIONS } from '../api/optimization.ts';

export const OPTIMIZATION_COMMANDS = ['optimize-audit-content', 'optimize-serp-fetch', 'optimize-strategy-synthesis', 'optimize-rewrite-content', 'optimize-review-update', 'optimize-review-delete', 'optimize-change-create', 'optimize-change-update', 'optimize-change-delete', 'optimize-restore-original'];
const fieldLimit = (field: string) => field === 'content_md' ? 100000 : field === 'meta_description' ? 1000 : 200;

function validateChange(input: Row): Row {
  const field = String(input.target_field || 'content_md'), operation = String(input.operation || 'append');
  if (!Object.hasOwn(CHANGE_FIELDS, field) || !Object.hasOwn(CHANGE_OPERATIONS, operation)) throw new Error('제안의 대상과 적용 방법을 확인해 주세요.');
  if (field !== 'content_md' && operation !== 'replace') throw new Error('제목과 검색 메타 정보는 교체만 지원합니다.');
  const status = input.status || 'proposed';
  if (!['proposed', 'excluded'].includes(String(status))) throw new Error('제안 상태를 확인해 주세요.');
  return {
    section_title: contentText(input.section_title, '제안 제목', 200, true),
    target_field: field, operation,
    before_text: contentText(input.before_text, '교체할 원문', fieldLimit(field), false, true),
    after_text: contentText(input.after_text, '변경할 내용', fieldLimit(field), operation !== 'replace', true),
    rationale: contentText(input.rationale, '변경 이유', 2000), status,
  };
}

export function applyContentChanges(source: Row, changes: Row[]): ReturnType<typeof validateContentBody> {
  const result: Row = { ...validateContentBody(source) };
  for (const change of changes) {
    const field = String(change.target_field), before = String(change.before_text), after = String(change.after_text), current = String(result[field]);
    if (change.operation === 'prepend') result[field] = `${after}\n\n${current}`;
    else if (change.operation === 'append') result[field] = `${current}\n\n${after}`;
    else {
      if (field !== 'content_md') {
        if (current !== before) throw new Error(`“${change.section_title}”의 원문이 일치하지 않습니다. 겹치는 제안을 수정하거나 제외해 주세요.`);
        result[field] = after;
      } else {
        if (!before || current.indexOf(before) < 0 || current.indexOf(before) !== current.lastIndexOf(before)) throw new Error(`“${change.section_title}”에서 교체할 원문은 본문에 정확히 한 번 있어야 합니다.`);
        result[field] = current.replace(before, () => after);
      }
    }
  }
  return validateContentBody(result);
}

export async function runOptimizationCommand(db: HaloXDatabase, providers: HaloXProviders, command: string, payload: Row, workspaceId: string, actor: string): Promise<Row> {
  if (!payload.workspace_id) throw new Error('워크스페이스를 선택해 주세요.');
  const getChanges = (id: unknown) => db.queryTable('content_change_items', { filters: { workspace_id: `eq.${workspaceId}`, review_run_id: `eq.${id}` }, order: 'position.asc' }, actor).data;
  if (command === 'optimize-audit-content') {
    let job: Row, draft: Row | undefined, sourceMode = 'existing', fetchedAt: unknown = null;
    if (payload.job_id) {
      job = contentJob(db, workspaceId, payload.job_id, actor); checkContentRevision(job, payload.expected_content_revision);
      draft = selectedContentDraft(db, job, actor);
    } else {
      const target = contentText(payload.target_keyword, '대상 주제', 200, true);
      let imported: Row = payload;
      if (payload.source_mode === 'url') {
        const url = contentText(payload.url, '원문 URL', 2000, true);
        imported = await fetchPublicDocument(url); sourceMode = 'url'; fetchedAt = imported.fetched_at;
      } else if (payload.source_mode === 'text' || payload.content_md !== undefined) sourceMode = 'text';
      else throw new Error('기존 콘텐츠, 공개 URL 또는 본문을 선택해 주세요.');
      const created = runContentCommand(db, 'content-create', { ...validateContentBody({ ...imported, title: payload.title || imported.title }), target_keyword: target, source_url: imported.url || payload.url || '' }, workspaceId, actor);
      job = created.job as Row; draft = created.draft as Row;
    }
    if (!draft) throw new Error('진단할 본문 버전이 없습니다.');
    const reservation = db.callRpc('reserve_unit_with_bypass', { p_workspace_id: workspaceId, p_unit_key: 'content_gen', p_amount: 1, p_idempotency_key: String(payload.idempotency_key || crypto.randomUUID()) }, actor) as { reservation_id: string; idempotent?: boolean };
    if (reservation.idempotent) throw new Error('이미 사용한 진단 요청입니다. 최적화 목록을 확인해 주세요.');
    const sections = contentSections(String(draft.content_md));
    const [run] = db.insertTable('content_review_runs', {
      workspace_id: workspaceId, title: payload.review_title ? contentText(payload.review_title, '진단 이름', 200, true) : draft.title,
      notes: '', url: job.source_url || '', target_keyword: job.target_keyword,
      content_job_id: job.id, base_draft_id: draft.id, base_job_revision: Number(job.revision || 0), source_snapshot: draft,
      source_mode: sourceMode, fetched_at: fetchedAt, status: 'audited', revision: 1, provider: 'local-content-audit',
      audit: { character_count: String(draft.content_md).length, word_count: String(draft.content_md).trim().split(/\s+/u).length, section_count: sections.length, has_meta_description: Boolean(draft.meta_description), has_summary: /^(?:##?\s+)?(?:핵심 요약|요약|TL;DR)/im.test(String(draft.content_md)) },
    }, actor);
    db.callRpc('commit_reservation', { p_reservation_id: reservation.reservation_id }, actor);
    return { ok: true, review_run: run, change_items: [], job, draft };
  }
  const run = db.queryTable('content_review_runs', { filters: { id: `eq.${String(payload.review_run_id || '')}`, workspace_id: `eq.${workspaceId}` } }, actor).data[0];
  if (!run) throw new Error('최적화 작업을 찾을 수 없습니다.');
  checkContentRevision(run, payload.expected_revision);
  const filters = { id: `eq.${run.id}`, workspace_id: `eq.${workspaceId}` };
  const update = (patch: Row = {}) => db.updateTable('content_review_runs', { ...patch, revision: Number(run.revision || 0) + 1 }, filters, actor)[0];
  if (command === 'optimize-review-delete') { db.deleteTable('content_review_runs', filters, actor); return { ok: true, deleted_id: run.id }; }
  if (command === 'optimize-review-update') {
    const changed = update({ title: contentText(payload.title, '진단 이름', 200, true), notes: contentText(payload.notes, '메모', 5000) });
    return { ok: true, review_run: changed, change_items: getChanges(run.id) };
  }
  if (!run.base_draft_id || !run.source_snapshot || !run.content_job_id) throw new Error('이전 데모 이력입니다. 본문을 등록해 새 진단을 시작해 주세요.');
  const source = run.source_snapshot as Row;
  if (command === 'optimize-serp-fetch') {
    if (run.status !== 'audited') throw new Error('본문 진단 단계에서만 검색 참고를 수집할 수 있습니다.');
    const serp = await providers.collectSerp(String(run.target_keyword));
    const changed = update({ status: 'collected', serp_result: serp, search_provider: serp.receipt?.provider || 'deterministic' });
    return { ok: true, review_run: changed, change_items: [] };
  }
  if (command === 'optimize-strategy-synthesis') {
    if (run.status !== 'collected') throw new Error('검색 참고 수집을 완료한 뒤 제안을 생성해 주세요.');
    const excerpt = String(source.content_md).replace(/^#{1,6}\s+.*$/gm, '').replace(/[`*_>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const proposals: Row[] = [
      { section_title: '원문 기반 핵심 요약 추가', target_field: 'content_md', operation: 'prepend', before_text: '', after_text: `## 핵심 요약\n\n${excerpt}`, rationale: '원문 앞부분을 요약 영역으로 분리한 데모 제안입니다. 문맥과 중복을 검토한 뒤 적용해 주세요.', status: 'proposed' },
      { section_title: '검색 설명 정리', target_field: 'meta_description', operation: 'replace', before_text: String(source.meta_description || ''), after_text: excerpt.slice(0, 160), rationale: '원문에서 추출한 검색 설명입니다. 실제 검색 성과를 예측하는 값은 아닙니다.', status: 'proposed' },
    ];
    const generated = providers.proposeOptimization ? await providers.proposeOptimization(String(run.target_keyword), source, run.serp_result) : undefined;
    const changes = db.insertTable('content_change_items', (generated?.changes || proposals).map((proposal, position) => ({ ...validateChange(proposal), workspace_id: workspaceId, review_run_id: run.id, position })), actor);
    return { ok: true, review_run: update({ status: 'proposed', provider: generated?.receipt.provider || 'deterministic', provider_receipt: generated?.receipt || null }), change_items: changes };
  }
  if (command.startsWith('optimize-change-')) {
    if (run.status !== 'proposed') throw new Error('제안 검토 단계에서만 제안을 변경할 수 있습니다.');
    const changes = getChanges(run.id);
    if (command === 'optimize-change-create') {
      if (changes.length >= 50) throw new Error('제안은 최대 50개까지 등록할 수 있습니다.');
      db.insertTable('content_change_items', { ...validateChange(payload), workspace_id: workspaceId, review_run_id: run.id, position: Math.max(-1, ...changes.map(item => Number(item.position))) + 1 }, actor);
    } else {
      const change = changes.find(item => item.id === payload.change_id);
      if (!change) throw new Error('해당 작업의 제안을 찾을 수 없습니다.');
      const where = { id: `eq.${change.id}`, workspace_id: `eq.${workspaceId}` };
      if (command === 'optimize-change-delete') db.deleteTable('content_change_items', where, actor);
      else {
        const editable = ['section_title', 'target_field', 'operation', 'before_text', 'after_text', 'rationale', 'status'];
        const patch = Object.fromEntries(editable.filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]]));
        db.updateTable('content_change_items', validateChange({ ...change, ...patch }), where, actor);
      }
    }
    return { ok: true, review_run: update(), change_items: getChanges(run.id) };
  }
  const job = contentJob(db, workspaceId, run.content_job_id, actor), current = selectedContentDraft(db, job, actor);
  if (command === 'optimize-rewrite-content') {
    if (run.status !== 'proposed') throw new Error('제안 검토 단계에서만 적용할 수 있습니다. 이미 적용한 작업은 다시 적용하지 않습니다.');
    if (current?.id !== run.base_draft_id || Number(job.revision || 0) !== Number(run.base_job_revision)) throw new ContentConflictError();
    const ids = payload.change_ids;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('적용할 제안을 중복 없이 선택해 주세요.');
    const changes = getChanges(run.id).filter(change => ids.includes(change.id));
    if (changes.length !== ids.length || changes.some(change => change.status !== 'proposed')) throw new Error('검토 중인 이 작업의 제안만 적용할 수 있습니다.');
    const edited = applyContentChanges(source, changes);
    if (JSON.stringify(edited) === JSON.stringify(validateContentBody(source))) throw new Error('원문과 동일한 변경입니다. 적용할 내용을 확인해 주세요.');
    const saved = saveContentVersion(db, job, edited, actor, 'optimized', source);
    db.updateTable('content_change_items', { status: 'applied', applied_draft_id: saved.draft.id }, { review_run_id: `eq.${run.id}`, id: `in.(${ids.join(',')})`, workspace_id: `eq.${workspaceId}` }, actor);
    return { ...saved, review_run: update({ status: 'applied', applied_draft_id: saved.draft.id, applied_at: new Date().toISOString() }), change_items: getChanges(run.id) };
  }
  if (command === 'optimize-restore-original') {
    if (run.status !== 'applied') throw new Error('적용 완료 상태에서만 원본을 복원할 수 있습니다.');
    checkContentRevision(job, payload.expected_content_revision);
    if (current?.id !== run.applied_draft_id) throw new ContentConflictError();
    const saved = saveContentVersion(db, job, source, actor, 'restored', source);
    return { ...saved, review_run: update({ status: 'reverted', reverted_draft_id: saved.draft.id }), change_items: getChanges(run.id) };
  }
  throw new Error('지원하지 않는 최적화 작업입니다.');
}
