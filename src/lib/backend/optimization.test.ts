import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { HaloXDatabase, DEFAULT_WORKSPACE_ID as WS, DEFAULT_USER_ID, OTHER_USER_ID, ISOLATED_WORKSPACE_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { createDeterministicProviders } from './providers.ts';
import { assertRestWrite } from './rest-policy.ts';
import { ContentConflictError } from './content-model.ts';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function fixture(factory = () => new HaloXDatabase()) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-optimize-')); directories.push(directory);
  return new PersistentHaloXStore(path.join(directory, 'data.sqlite'), factory);
}
const source = { source_mode: 'text', title: '원문 제목', target_keyword: '버전 관리', content_md: '# 안내\n\n검증한 문구입니다.\n\n## 주요 기능\n버전을 보관합니다.', meta_description: '' };
type Result = { review_run: Row; change_items: Row[]; job: Row; draft: Row };
const call = (store: PersistentHaloXStore, name: string, payload: Row = {}, actor = DEFAULT_USER_ID) => store.write(db => db.invokeEdgeFunction(name, { workspace_id: WS, ...payload }, actor)) as Promise<Result>;
const step = (store: PersistentHaloXStore, name: string, run: Row, payload: Row = {}) => call(store, name, { ...payload, review_run_id: run.id, expected_revision: run.revision });
async function proposals(store: PersistentHaloXStore) {
  const first = await call(store, 'optimize-audit-content', source);
  const collected = await step(store, 'optimize-serp-fetch', first.review_run);
  const ready = await step(store, 'optimize-strategy-synthesis', collected.review_run);
  return { ...ready, job: first.job, draft: first.draft };
}

describe('content optimization', () => {
  it('persists all four stages, applies chosen edits to a new version, and restores the exact source without deleting either version', async () => {
    const store = fixture(), first = await proposals(store);
    assert.equal(first.review_run.status, 'proposed'); assert.equal(first.change_items.length, 2);
    const bodyChange = first.change_items.find(row => row.target_field === 'content_md')!, metadata = first.change_items.find(row => row.target_field === 'meta_description')!;
    const edited = await step(store, 'optimize-change-update', first.review_run, { change_id: bodyChange.id, after_text: '## 검토한 요약\n\n새 버전에서 보존하는 내용' });
    const excluded = await step(store, 'optimize-change-update', edited.review_run, { change_id: metadata.id, status: 'excluded' });
    await assert.rejects(step(store, 'optimize-rewrite-content', excluded.review_run, { change_ids: [metadata.id] }), /검토 중인/);
    const applied = await step(store, 'optimize-rewrite-content', excluded.review_run, { change_ids: [bodyChange.id] });
    assert.equal(applied.draft.version, 2); assert.equal(applied.draft.origin, 'optimized'); assert.ok(String(applied.draft.content_md).startsWith('## 검토한 요약'));
    assert.equal(applied.draft.meta_description, ''); assert.equal(applied.review_run.status, 'applied');
    assert.equal(await store.read(db => db.queryTable('content_drafts', { filters: { id: `eq.${first.draft.id}` } }).data[0].content_md), source.content_md);
    await assert.rejects(step(store, 'optimize-rewrite-content', applied.review_run, { change_ids: [bodyChange.id] }), /이미 적용/);
    const restored = await step(store, 'optimize-restore-original', applied.review_run, { expected_content_revision: applied.job.revision });
    assert.equal(restored.draft.version, 3); assert.equal(restored.draft.content_md, source.content_md); assert.equal(restored.review_run.status, 'reverted');
    await step(store, 'optimize-review-delete', restored.review_run);
    assert.equal(await store.read(db => db.queryTable('content_change_items').count), 0); assert.equal(await store.read(db => db.queryTable('content_review_runs').count), 0); assert.equal(await store.read(db => db.queryTable('content_drafts').count), 3);
  });

  it('supports custom replacements and proposal CRUD with revision checks and literal replacement text', async () => {
    const store = fixture(), ready = await proposals(store);
    const created = await step(store, 'optimize-change-create', ready.review_run, { section_title: '확인한 문구 변경', target_field: 'content_md', operation: 'replace', before_text: '검증한 문구입니다.', after_text: '직접 확인한 $& 문구입니다.', rationale: '편집자 확인' });
    const custom = created.change_items.find(row => row.section_title === '확인한 문구 변경')!;
    await assert.rejects(step(store, 'optimize-change-delete', ready.review_run, { change_id: custom.id }), ContentConflictError);
    const named = await step(store, 'optimize-review-update', created.review_run, { title: '검토 제목', notes: '검토 메모' });
    const removed = await step(store, 'optimize-change-delete', named.review_run, { change_id: ready.change_items[0].id });
    const applied = await step(store, 'optimize-rewrite-content', removed.review_run, { change_ids: [custom.id] });
    assert.match(String(applied.draft.content_md), /직접 확인한 \$& 문구/); assert.equal(applied.review_run.notes, '검토 메모');
    await assert.rejects(step(store, 'optimize-change-update', applied.review_run, { change_id: custom.id, after_text: '사후 위조' }), /검토 단계/);
  });

  it('rejects invalid stage transitions, overlapping replacements and stale source edits atomically', async () => {
    const store = fixture(), first = await call(store, 'optimize-audit-content', source);
    await assert.rejects(step(store, 'optimize-strategy-synthesis', first.review_run), /검색 참고/);
    const collected = await step(store, 'optimize-serp-fetch', first.review_run);
    const ready = await step(store, 'optimize-strategy-synthesis', collected.review_run);
    await assert.rejects(step(store, 'optimize-strategy-synthesis', ready.review_run), /검색 참고/);
    let latest = ready;
    for (const after of ['서로 다른 교체 1', '서로 다른 교체 2']) latest = await step(store, 'optimize-change-create', latest.review_run, { section_title: after, operation: 'replace', target_field: 'content_md', before_text: '검증한 문구입니다.', after_text: after });
    const before = await store.read(db => db.exportState());
    await assert.rejects(step(store, 'optimize-rewrite-content', latest.review_run, { change_ids: latest.change_items.filter(row => row.operation === 'replace' && row.target_field === 'content_md').map(row => row.id) }), /정확히 한 번/);
    assert.deepEqual(await store.read(db => db.exportState()), before);
    await call(store, 'content-save', { job_id: first.job.id, expected_revision: first.job.revision, title: '별도 편집', content_md: '새 본문' });
    await assert.rejects(step(store, 'optimize-rewrite-content', latest.review_run, { change_ids: [ready.change_items[0].id] }), ContentConflictError);
    assert.equal(await store.read(db => db.queryTable('content_drafts').count), 2);
  });

  it('uses an existing draft, rejects foreign jobs/reviews/changes, and blocks REST forgery', async () => {
    const store = fixture(); const content = await call(store, 'content-create', source);
    const first = await call(store, 'optimize-audit-content', { job_id: content.job.id, expected_content_revision: content.job.revision });
    assert.equal(first.job.id, content.job.id); assert.equal(await store.read(db => db.queryTable('content_jobs').count), 1);
    await assert.rejects(call(store, 'optimize-audit-content', { job_id: content.job.id, expected_content_revision: 0 }), ContentConflictError);
    await assert.rejects(call(store, 'optimize-audit-content', { job_id: content.job.id, expected_content_revision: 1 }, OTHER_USER_ID), /not authorized/);
    await assert.rejects(call(store, 'optimize-review-delete', { workspace_id: ISOLATED_WORKSPACE_ID, review_run_id: first.review_run.id, expected_revision: 1 }, OTHER_USER_ID), /찾을 수 없습니다/);
    for (const table of ['content_review_runs', 'content_change_items']) for (const method of ['POST', 'PATCH', 'DELETE'] as const) await assert.rejects(store.write(db => assertRestWrite(db, table, method, DEFAULT_USER_ID, method === 'DELETE' ? undefined : { status: 'applied' }, { id: `eq.${first.review_run.id}` })), /서버 작업/);
    const ready = await proposals(store);
    await assert.rejects(step(store, 'optimize-change-update', ready.review_run, { change_id: 'not-in-this-review', after_text: 'bad' }), /제안을 찾을/);
    await assert.rejects(step(store, 'optimize-change-create', ready.review_run, { section_title: '비정상 필드', target_field: 'generation_context', operation: 'replace' }), /대상과 적용/);
  });

  it('rolls back failed fetches/providers and idempotency conflicts without leaving jobs or duplicate quota', async () => {
    const provider = createDeterministicProviders(), store = fixture(() => new HaloXDatabase({ ...provider, async collectSerp() { throw new Error('provider failed'); } }));
    const before = await store.read(db => db.exportState());
    await assert.rejects(call(store, 'optimize-audit-content', { source_mode: 'url', url: 'http://127.0.0.1/private', target_keyword: '주소 검증' }), /내부 네트워크/);
    assert.deepEqual(await store.read(db => db.exportState()), before);
    const first = await call(store, 'optimize-audit-content', { ...source, idempotency_key: 'first-review' });
    const audited = await store.read(db => db.exportState());
    await assert.rejects(step(store, 'optimize-serp-fetch', first.review_run), /provider failed/);
    await assert.rejects(call(store, 'optimize-audit-content', { ...source, idempotency_key: 'first-review' }), /이미 사용한/);
    assert.deepEqual(await store.read(db => db.exportState()), audited);
  });
});
