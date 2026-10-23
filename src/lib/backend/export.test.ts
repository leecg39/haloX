import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_WORKSPACE_ID as WS, DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, ISOLATED_WORKSPACE_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { readExportFile } from './export-service.ts';
import { createExportFile } from './export-files.ts';
import { ContentConflictError } from './content-model.ts';
import { assertRestWrite } from './rest-policy.ts';
import { MAX_EXPORT_WORKSPACE_BYTES } from '../api/exports.ts';

type ResultRow = Row & { id: string; source_snapshot: Row; destination_snapshot: Row };
type Result = { job: ResultRow; draft: ResultRow; history: ResultRow; translation: ResultRow; destination: ResultRow };
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-export-')); directories.push(directory);
  const filename = path.join(directory, 'data.sqlite');
  const store = new PersistentHaloXStore(filename);
  const invoke = (command: string, values: Row = {}, actor = ACTOR) => store.write(db => db.invokeEdgeFunction(command, { workspace_id: WS, ...values }, actor)) as Promise<Result>;
  const rows = (table: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${WS}` } }).data);
  return { store, filename, invoke, rows };
}
const body = { title: '안내 문서', content_md: '## 사용법\n원문 공백  \n\n<script>alert("x")</script>\n', target_keyword: '사용법', meta_title: '검색 제목', meta_description: '검색 설명' };
const translation = { title: 'Instructions', content_md: '## Getting started\nRead the instructions.\n', meta_title: 'Product instructions', meta_description: 'Learn to use the product.', source_locale: 'ko', locale: 'en', status: 'ready' };
const preset = { name: '전달 문서', file_prefix: '검토_', format: 'md', include_metadata: false };
function exportRequest(job: Row, extra: Row = {}) { return { job_id: job.id, expected_content_revision: job.revision, format: 'md', include_metadata: false, idempotency_key: 'request-1', ...extra }; }

describe('durable exports and reviewed translations', () => {
  it('stores exact bytes, retries one request, preserves files after source edits/deletion and a new store instance', async () => {
    const { store, filename, invoke, rows } = fixture();
    const { job } = await invoke('content-create', body);
    const request = exportRequest(job); const saved = await invoke('export-create', request);
    const read = () => store.read(db => readExportFile(db, saved.history.id, ACTOR));
    const file = await read(); assert.equal(Buffer.from(String(file!.base64), 'base64').toString(), body.content_md);
    assert.equal((await invoke('export-create', Object.fromEntries(Object.entries(request).reverse()))).history.id, saved.history.id);
    assert.equal((await rows('export_history')).length, 1);
    await assert.rejects(invoke('export-create', { ...request, format: 'html' }), /같은 요청 키/);
    const edited = await invoke('content-save', { ...body, job_id: job.id, expected_revision: job.revision, content_md: '수정 본문' });
    await assert.rejects(invoke('export-create', { ...request, idempotency_key: 'request-2' }), ContentConflictError);
    await invoke('content-delete', { job_id: job.id, expected_revision: edited.job.revision });
    assert.equal((await rows('export_history'))[0].content_job_id, null);
    const restarted = new PersistentHaloXStore(filename);
    assert.deepEqual(await restarted.read(db => readExportFile(db, saved.history.id, ACTOR)), file);
    const editedHistory = await invoke('export-update', { export_id: saved.history.id, expected_revision: 1, title: '이름 변경', notes: '전달용' });
    assert.equal(editedHistory.history.notes, '전달용'); assert.deepEqual(await read(), file);
    await assert.rejects(invoke('export-delete', { export_id: saved.history.id, expected_revision: 1 }), ContentConflictError);
    await invoke('export-delete', { export_id: saved.history.id, expected_revision: 2 });
    assert.equal(await read(), null); assert.equal((await store.read(db => db.getServerRecords('export_files'))).length, 0);
  });

  it('creates all real file formats, escapes HTML, strips filename controls and preserves JSON/body metadata', () => {
    for (const format of ['md', 'txt', 'html', 'json'] as const) {
      const file = createExportFile({ ...body, title: '../안내\r\n"<문서>' }, format, true, '자료_');
      const bytes = Buffer.from(file.base64, 'base64'), result = bytes.toString();
      assert.equal(bytes.length, file.byte_size); assert.match(file.sha256, /^[a-f0-9]{64}$/); assert.ok(file.filename.endsWith('.' + format)); assert.doesNotMatch(file.filename, /[\r\n/"<>]/);
      if (format === 'html') { assert.ok(result.startsWith('<!doctype html>')); assert.ok(result.includes('&lt;script&gt;')); assert.ok(!result.includes('<script>')); assert.ok(result.includes('Content-Security-Policy')); }
      if (format === 'json') { assert.equal(JSON.parse(result).content_md, body.content_md); assert.equal(JSON.parse(result).meta_description, body.meta_description); }
      if (format === 'md' || format === 'txt') { assert.ok(result.endsWith(body.content_md)); assert.ok(result.includes(body.meta_description)); }
    }
  });

  it('validates and reuses destination settings, detects conflicts and preserves a frozen destination snapshot', async () => {
    const { invoke, rows } = fixture(); const { job } = await invoke('content-create', body);
    const { destination } = await invoke('export-destination-create', preset);
    await assert.rejects(invoke('export-destination-create', preset), /같은 이름/);
    await assert.rejects(invoke('export-destination-create', { ...preset, name: '다른 이름', file_prefix: '../secret' }), /접두어/);
    await assert.rejects(invoke('export-destination-create', { ...preset, format: '__proto__' }), /형식/);
    const { history } = await invoke('export-create', exportRequest(job, { destination_id: destination.id, expected_destination_revision: 1 }));
    assert.equal(history.filename, '검토_안내 문서.md');
    await invoke('export-destination-update', { ...preset, format: 'json', name: '새 이름', destination_id: destination.id, expected_revision: 1 });
    await assert.rejects(invoke('export-create', exportRequest(job, { idempotency_key: 'new', destination_id: destination.id, expected_destination_revision: 1 })), ContentConflictError);
    await invoke('export-destination-delete', { destination_id: destination.id, expected_revision: 2 });
    const snapshot = (await rows('export_history'))[0]; assert.equal(snapshot.destination_id, null); assert.equal((snapshot.destination_snapshot as Row).name, preset.name); assert.equal(snapshot.format, 'md');
  });

  it('stores actual manual translations with immutable source, review gating, uniqueness, conflict checks and export snapshots', async () => {
    const { invoke, store, rows } = fixture(); const { job, draft } = await invoke('content-create', body);
    const request = { ...translation, job_id: job.id, expected_content_revision: job.revision };
    await assert.rejects(invoke('translation-create', { ...request, locale: 'ko' }), /다른 번역 언어/);
    await assert.rejects(invoke('translation-create', { ...request, locale: 'invalid' }), /언어/);
    const created = (await invoke('translation-create', { ...request, status: 'draft' })).translation;
    assert.equal(created.source_snapshot.content_md, body.content_md); assert.equal(created.source_identity, draft.id);
    await assert.rejects(invoke('translation-create', request), /이미 있습니다/);
    const exportValues = { translation_id: created.id, expected_translation_revision: 1, format: 'json', include_metadata: true, idempotency_key: 'translation-1' };
    await assert.rejects(invoke('export-create', exportValues), /검토를 마친/);
    await invoke('translation-update', { ...translation, translation_id: created.id, expected_revision: 1 });
    await assert.rejects(invoke('translation-update', { ...translation, translation_id: created.id, expected_revision: 1 }), ContentConflictError);
    const { history } = await invoke('export-create', { ...exportValues, expected_translation_revision: 2 });
    const file = await store.read(db => readExportFile(db, history.id, ACTOR)); assert.equal(JSON.parse(Buffer.from(String(file!.base64), 'base64').toString()).content_md, translation.content_md);
    await invoke('content-delete', { job_id: job.id, expected_revision: job.revision });
    const stored = (await rows('article_translations'))[0]; assert.equal(stored.content_job_id, null); assert.equal(stored.source_draft_id, null); assert.equal((stored.source_snapshot as Row).content_md, body.content_md);
    await invoke('translation-delete', { translation_id: created.id, expected_revision: 2 });
    assert.equal((await rows('export_history'))[0].translation_id, null); assert.deepEqual(await store.read(db => readExportFile(db, history.id, ACTOR)), file);
    await assert.rejects(invoke('translate-content-v2', { title: '가짜 번역 금지' }), /전용 서버 실행 경로/);
    assert.equal((await rows('articles')).length, 0);
  });

  it('enforces tenant scope, protects file storage from REST, and deletes private bytes with the workspace', async () => {
    const { store, invoke } = fixture(); const { job } = await invoke('content-create', body);
    const { history } = await invoke('export-create', exportRequest(job));
    await assert.rejects(invoke('export-create', exportRequest(job), OTHER_USER_ID), /not authorized/i);
    await assert.rejects(invoke('export-create', { ...exportRequest(job), workspace_id: ISOLATED_WORKSPACE_ID }, OTHER_USER_ID), /콘텐츠를 찾을 수 없습니다/);
    await assert.rejects(invoke('export-update', { export_id: history.id, workspace_id: ISOLATED_WORKSPACE_ID, expected_revision: 1, title: '타인 수정' }, OTHER_USER_ID), /항목을 찾을 수 없습니다/);
    const foreignRead = await store.read(db => readExportFile(db, history.id, OTHER_USER_ID)); assert.equal(foreignRead, null);
    await store.read(db => {
      for (const table of ['export_history', 'article_translations', 'export_destinations']) for (const method of ['POST', 'PATCH', 'DELETE'] as const) assert.throws(() => assertRestWrite(db, table, method, ACTOR, method === 'DELETE' ? undefined : { workspace_id: WS }, { id: `eq.${history.id}` }), /전용 서버/);
      assert.throws(() => db.queryTable('export_files'), /does not exist/);
      assert.equal(JSON.stringify(db.queryTable('export_history')).includes('base64'), false);
    });
    await store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }, ACTOR));
    assert.deepEqual(await store.read(db => db.getServerRecords('export_files')), []);
  });

  it('rejects invalid formats and quota overflow without persisting partial history or consuming a retry key', async () => {
    const { store, invoke, rows } = fixture(); const { job } = await invoke('content-create', body);
    await assert.rejects(invoke('export-create', exportRequest(job, { format: 'pdf' })), /형식/);
    await store.write(db => db.setServerRecords('export_files', [{ workspace_id: WS, byte_size: MAX_EXPORT_WORKSPACE_BYTES }]));
    await assert.rejects(invoke('export-create', exportRequest(job)), /50MB/); assert.deepEqual(await rows('export_history'), []);
    await store.write(db => db.setServerRecords('export_files', []));
    await invoke('export-create', exportRequest(job)); assert.equal((await rows('export_history')).length, 1);
  });
});
