import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { HaloXDatabase, DEFAULT_WORKSPACE_ID as WS, DEFAULT_USER_ID, OTHER_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { assertRestWrite } from './rest-policy.ts';
import { contentSections, ContentConflictError } from './content-model.ts';
import { createDeterministicProviders } from './providers.ts';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function fixture(factory = () => new HaloXDatabase()) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-content-')); directories.push(directory);
  const filename = path.join(directory, 'data.sqlite');
  return { filename, store: new PersistentHaloXStore(filename, factory) };
}
const body = { target_keyword: '버전 관리', title: '원본 제목', content_md: '# 제목\n\n원본 공백  \n\n## 근거\n자료 내용\n', meta_title: '검색 제목', meta_description: '검색 설명' };
const invoke = (store: PersistentHaloXStore, command: string, payload: Row = {}, actor = DEFAULT_USER_ID) => store.write(db => db.invokeEdgeFunction(command, { workspace_id: WS, ...payload }, actor)) as Promise<{ job: Row; draft: Row }>;

describe('content factory versions', () => {
  it('creates a manual draft, edits without destroying prior bytes, selects/restores and keeps monotonically increasing versions', async () => {
    const { filename, store } = fixture();
    const initialUsage = await store.read(db => db.queryTable('usage_reservations').count);
    const first = await invoke(store, 'content-create', body);
    assert.equal(first.draft.content_md, body.content_md); assert.equal(first.job.revision, 1);
    assert.equal(await store.read(db => db.queryTable('usage_reservations').count), initialUsage);
    const second = await invoke(store, 'content-save', { job_id: first.job.id, expected_revision: 1, ...body, title: '편집 제목', content_md: '## 수정\n새 본문' });
    assert.equal(second.draft.version, 2); assert.equal(second.draft.seo_score, null);
    const reopened = new PersistentHaloXStore(filename);
    assert.equal(await reopened.read(db => db.queryTable('content_drafts', { filters: { id: `eq.${first.draft.id}` } }).data[0].content_md), body.content_md);
    assert.equal(await reopened.read(db => db.queryTable('content_compositions', { filters: { content_draft_id: `eq.${second.draft.id}` } }).data[0].heading), '수정');
    const selected = await invoke(store, 'content-select', { job_id: first.job.id, expected_revision: 2, draft_id: first.draft.id });
    assert.equal(selected.job.title, '원본 제목'); assert.equal(selected.draft.version, 1);
    const restored = await invoke(store, 'content-restore', { job_id: first.job.id, expected_revision: 3, draft_id: second.draft.id });
    assert.equal(restored.draft.version, 3); assert.equal(restored.draft.restored_from_version, 2); assert.equal(restored.draft.content_md, second.draft.content_md);
    await assert.rejects(invoke(store, 'content-delete-version', { job_id: first.job.id, expected_revision: 4, draft_id: restored.draft.id }), /현재 선택한/);
    await invoke(store, 'content-select', { job_id: first.job.id, expected_revision: 4, draft_id: first.draft.id });
    await invoke(store, 'content-delete-version', { job_id: first.job.id, expected_revision: 5, draft_id: restored.draft.id });
    const latest = await invoke(store, 'content-save', { ...body, job_id: first.job.id, expected_revision: 6 });
    assert.equal(latest.draft.version, 4);
    assert.equal(await store.read(db => db.queryTable('content_compositions', { filters: { content_draft_id: `eq.${restored.draft.id}` } }).count), 0);
    assert.equal(await store.read(db => db.queryTable('content_drafts', { filters: { is_selected: 'eq.true' } }).count), 1);
  });

  it('rejects stale concurrent edits and ABA version selections without partial changes', async () => {
    const { filename, store } = fixture(); const other = new PersistentHaloXStore(filename);
    const first = await invoke(store, 'content-create', body);
    const edits = await Promise.allSettled([invoke(store, 'content-save', { ...body, title: 'first writer', job_id: first.job.id, expected_revision: 1 }), invoke(other, 'content-save', { ...body, title: 'second writer', job_id: first.job.id, expected_revision: 1 })]);
    assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
    const failed = edits.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(failed.reason instanceof ContentConflictError);
    await invoke(store, 'content-select', { job_id: first.job.id, draft_id: first.draft.id, expected_revision: 2 });
    await assert.rejects(invoke(store, 'content-save', { ...body, job_id: first.job.id, expected_revision: 1 }), ContentConflictError);
    assert.equal(await store.read(db => db.queryTable('content_drafts').count), 2);
    await assert.rejects(invoke(store, 'content-update', { job_id: first.job.id, status: 'ready' }), /revision/);
    const changed = await invoke(store, 'content-update', { job_id: first.job.id, expected_revision: 3, status: 'ready', notes: '출고 전 검토', target_keyword: '검토한 주제' });
    assert.equal(changed.job.status, 'ready'); assert.equal(changed.job.notes, '출고 전 검토');
  });

  it('enforces same-workspace parents, immutable public REST, field limits and authenticated operations', async () => {
    const { store } = fixture();
    const first = await invoke(store, 'content-create', body);
    const second = await invoke(store, 'content-create', { ...body, title: '다른 콘텐츠' });
    await assert.rejects(invoke(store, 'content-select', { job_id: first.job.id, draft_id: second.draft.id, expected_revision: 1 }), /버전을 찾을/);
    await assert.rejects(invoke(store, 'content-save', { ...body, job_id: first.job.id, expected_revision: 1 }, OTHER_USER_ID), /not authorized/);
    for (const patch of [{ title: ' ' }, { content_md: 'x'.repeat(100001) }, { meta_title: 123 }]) {
      await assert.rejects(invoke(store, 'content-save', { ...body, ...patch, job_id: first.job.id, expected_revision: 1 }));
    }
    await assert.rejects(invoke(store, 'content-update', { job_id: first.job.id, expected_revision: 1, status: 'published' }), /상태/);
    await assert.rejects(invoke(store, 'content-create', { ...body, source_url: 'javascript:alert(1)' }), /URL/);
    const [workspace] = await store.write(db => db.insertTable('workspaces', { name: '다른 공간' }));
    await assert.rejects(invoke(store, 'content-create', { ...body, workspace_id: workspace.id, keyword_id: '66000000-0000-4000-8000-000000000001' }), /같은 워크스페이스/);
    for (const table of ['content_jobs', 'content_drafts', 'content_compositions']) for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      await assert.rejects(store.write(db => assertRestWrite(db, table, method, DEFAULT_USER_ID, method === 'DELETE' ? undefined : { title: 'forged' }, { id: `eq.${first.job.id}` })), /서버 작업/);
    }
    assert.equal(await store.read(db => db.queryTable('content_drafts').count), 2);
  });

  it('regenerates as a new version, snapshots references per draft, and rolls quota and edits back on provider failure', async () => {
    let fail = false;
    const provider = createDeterministicProviders();
    const { store } = fixture(() => new HaloXDatabase({ ...provider, async generateContentDraft(...args) { if (fail) throw new Error('provider failed'); return provider.generateContentDraft(...args); } }));
    const [persona] = await store.write(db => db.insertTable('writing_style_profiles', { name: '문체 1', tone: '짧게' }));
    const first = await invoke(store, 'content-draft', { target_keyword: body.target_keyword, writing_style_profile_id: persona.id, idempotency_key: 'create-draft' });
    await store.write(db => db.updateTable('writing_style_profiles', { name: '문체 2' }, { id: `eq.${persona.id}` }));
    const second = await invoke(store, 'content-draft', { job_id: first.job.id, expected_revision: 1, target_keyword: '새 주제', writing_style_profile_id: persona.id, idempotency_key: 'regenerate' });
    assert.equal(second.draft.version, 2); assert.equal(second.job.id, first.job.id);
    assert.equal((first.draft.generation_context as { persona: { name: string } }).persona.name, '문체 1');
    assert.equal((second.draft.generation_context as { persona: { name: string } }).persona.name, '문체 2');
    await assert.rejects(invoke(store, 'content-draft', { target_keyword: '중복', idempotency_key: 'regenerate' }), /이미 사용된/);
    const before = await store.read(db => db.exportState()); fail = true;
    await assert.rejects(invoke(store, 'content-draft', { job_id: first.job.id, expected_revision: 2, target_keyword: '실패', idempotency_key: 'failure' }), /provider failed/);
    assert.deepEqual(await store.read(db => db.exportState()), before);
    await store.write(db => db.deleteTable('writing_style_profiles', { id: `eq.${persona.id}` }));
    const restored = await invoke(store, 'content-restore', { job_id: first.job.id, expected_revision: 2, draft_id: first.draft.id });
    assert.equal((restored.draft.generation_context as { persona: { name: string } }).persona.name, '문체 1');
  });

  it('deletes all job versions/compositions/reviews while preserving export history without a dangling job reference', async () => {
    const { store } = fixture(); const first = await invoke(store, 'content-create', body);
    const [run] = await store.write(db => db.insertTable('content_review_runs', { content_job_id: first.job.id, base_draft_id: first.draft.id }));
    await store.write(db => db.insertTable('content_change_items', { review_run_id: run.id }));
    await store.write(db => db.insertTable('export_history', { content_job_id: first.job.id, filename: 'preserved.md' }));
    await invoke(store, 'content-delete', { job_id: first.job.id, expected_revision: 1 });
    for (const table of ['content_jobs', 'content_drafts', 'content_compositions', 'content_review_runs', 'content_change_items']) assert.equal(await store.read(db => db.queryTable(table).count), 0);
    assert.equal(await store.read(db => db.queryTable('export_history').data[0].content_job_id), null);
  });

  it('cannot forge generation snapshots and keeps manual versions ungrounded after generation; deleted links remain editable', async () => {
    const { store } = fixture();
    const [keyword] = await store.write(db => db.insertTable('keywords', { keyword: '연결용 키워드' }));
    const [prompt] = await store.write(db => db.insertTable('geo_prompts', { prompt_text: '콘텐츠와 연결할 질문은?', engines: ['openai'] }));
    const first = await invoke(store, 'content-create', { ...body, keyword_id: keyword.id, geo_prompt_id: prompt.id });
    await invoke(store, 'content-draft', { job_id: first.job.id, expected_revision: 1, target_keyword: '데모 생성' });
    await invoke(store, 'content-select', { job_id: first.job.id, expected_revision: 2, draft_id: first.draft.id });
    await store.write(db => { db.deleteTable('keywords', { id: `eq.${keyword.id}` }); db.deleteTable('geo_prompts', { id: `eq.${prompt.id}` }); });
    const edit = await invoke(store, 'content-save', { ...body, job_id: first.job.id, expected_revision: 3, generation_context: { persona: { name: 'forged' } }, grounding_sources: ['https://fake.example.com'], seo_score: 100 });
    assert.equal(edit.draft.generation_context, null); assert.deepEqual(edit.draft.grounding_sources, []); assert.equal(edit.draft.seo_score, null);
    assert.equal(edit.job.keyword_id, null); assert.equal(edit.job.geo_prompt_id, null);
  });

  it('derives headings without treating fenced code as content sections', () => {
    assert.deepEqual(contentSections('intro\n## One\ntext\n```md\n## code\n```\n## Two\nlast').map(row => row.heading), ['도입', 'One', 'Two']);
  });
});
