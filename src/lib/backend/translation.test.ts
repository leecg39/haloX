import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_WORKSPACE_ID as WS, DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { createDeepLClient, deepLConfigured, translationBatches, type DeepLClient } from './deepl.ts';
import { runTranslationCommand } from './translation-service.ts';
import { ExternalServiceError } from './public-json.ts';
import { ContentConflictError } from './content-model.ts';
import { readExportFile } from './export-service.ts';
import { wordpressContent } from './wordpress.ts';
import { assertRestWrite } from './rest-policy.ts';

type RecordRow = Row & { id: string; revision: number };
type Result = { ok: boolean; reused: boolean; run: RecordRow; job: RecordRow; draft: RecordRow; translation: RecordRow; history: RecordRow };
const original = { title: '제품 안내', content_md: '## 사용법\n반갑습니다.\n', meta_title: '안내', meta_description: '', target_keyword: '사용법' };
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
const translated: DeepLClient = { translate: async batch => batch.map(piece => ({ text: piece.field === 'title' ? 'Instructions' : piece.field === 'content_md' ? '## Instructions\nWelcome.\n' : 'Guide', billed_characters: [...piece.text].length })) };
function fixture(client: DeepLClient = translated) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-translation-')); directories.push(directory);
  const filename = path.join(directory, 'data.sqlite'), store = new PersistentHaloXStore(filename);
  const invoke = (command: string, values: Row = {}) => store.write(db => db.invokeEdgeFunction(command, { ...values, workspace_id: WS }, ACTOR)) as Promise<Result>;
  const call = (values: Row, command = 'translate-content-v2', actor = ACTOR, now?: () => number) => runTranslationCommand(store, command, { workspace_id: WS, ...values }, actor, client, now) as Promise<Result>;
  const rows = (table: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${WS}` } }, ACTOR).data as RecordRow[]);
  async function request(body = original) { const { job, draft } = await invoke('content-create', body); return { job, draft, values: { job_id: job.id, expected_content_revision: job.revision, source_locale: 'ko', locale: 'en', confirm: true, idempotency_key: 'once' } }; }
  return { filename, store, invoke, call, rows, request };
}

describe('DeepL adapter', () => {
  it('batches maximum Korean/Unicode input below the request limit without losing a character or field', async () => {
    const source = { ...original, content_md: ('한글😀"\\\n').repeat(13000).slice(0, 99998), meta_description: '검색 설명' };
    const batches = translationBatches(source, 'ko', 'en'); assert.ok(batches.length > 1);
    for (const field of ['title', 'content_md', 'meta_title', 'meta_description']) assert.equal(batches.flat().filter(piece => piece.field === field).map(piece => piece.text).join(''), source[field as keyof typeof source]);
    let calls = 0;
    const client = createDeepLClient({ DEEPL_API_KEY: 'fixture-key', DEEPL_API_PLAN: 'pro' }, async (url, options) => {
      calls++; assert.equal(url, 'https://api.deepl.com/v2/translate'); assert.equal(options.authorization, 'DeepL-Auth-Key fixture-key');
      const body = options.body as Row & { text: string[] }; assert.ok(Buffer.byteLength(JSON.stringify(body)) < 128 * 1024); assert.ok(body.text.length <= 50); assert.equal(body.target_lang, 'EN-US'); assert.equal(body.source_lang, 'KO'); assert.equal(body.preserve_formatting, true); assert.equal(body.show_billed_characters, true);
      return { status: 200, body: { translations: body.text.map(text => ({ text, billed_characters: [...text].length })) } };
    });
    for (const batch of batches) assert.equal((await client.translate(batch, 'ko', 'en')).length, batch.length);
    assert.equal(calls, batches.length);
    assert.throws(() => translationBatches(source, 'ko', 'ko'), /다른 번역 언어/);
    assert.throws(() => translationBatches(source, 'ko', '__proto__'), /언어/);
  });

  it('uses the Free endpoint, validates responses, sanitizes failures, and never retries', async () => {
    const batch = [{ field: 'title' as const, text: '안녕' }]; let calls = 0;
    assert.equal(deepLConfigured({}), false); assert.equal(deepLConfigured({ DEEPL_API_KEY: 'x', DEEPL_API_PLAN: 'untrusted' }), false);
    assert.throws(() => createDeepLClient({}), (error: unknown) => error instanceof ExternalServiceError && error.status === 503);
    const successful = createDeepLClient({ DEEPL_API_KEY: 'fixture' }, async (url, options) => { assert.equal(url, 'https://api-free.deepl.com/v2/translate'); assert.equal((options.body as Row).target_lang, 'ZH-HANS'); return { status: 200, body: { translations: [{ text: '你好' }] } }; });
    assert.equal((await successful.translate(batch, 'ko', 'zh'))[0].billed_characters, null);
    for (const status of [403, 429, 456, 302, 503]) {
      const client = createDeepLClient({ DEEPL_API_KEY: 'fixture' }, async () => { calls++; return { status, body: { error: 'secret provider body' } }; });
      await assert.rejects(client.translate(batch, 'ko', 'en'), (error: unknown) => error instanceof ExternalServiceError && error.uncertain === !(status >= 400 && status < 500) && !error.message.includes('secret'));
    }
    assert.equal(calls, 5);
    for (const translations of [[], [{}], [{ text: '' }], [{ text: 'ok', billed_characters: -1 }], [{ text: 'a' }, { text: 'b' }]]) await assert.rejects(createDeepLClient({ DEEPL_API_KEY: 'fixture' }, async () => ({ status: 200, body: { translations } })).translate(batch, 'ko', 'en'), ExternalServiceError);
    await assert.rejects(createDeepLClient({ DEEPL_API_KEY: 'fixture' }, async () => { throw new Error('SECRET'); }).translate(batch, 'ko', 'en'), error => !String(error).includes('SECRET'));
  });
});

describe('durable automatic translations', () => {
  it('persists a real result, gates exports on review, reuses requests across restart and preserves provenance', async () => {
    let calls = 0; const f = fixture({ translate: async (...args) => { calls++; return translated.translate(...args); } });
    const { values, draft } = await f.request(); const result = await f.call(values); assert.equal(result.ok, true); assert.equal(result.run.status, 'succeeded');
    const translation = (await f.rows('article_translations'))[0]; assert.equal(translation.origin, 'deepl'); assert.equal(translation.status, 'draft'); assert.equal(translation.source_identity, draft.id); assert.equal((translation.source_snapshot as Row).content_md, original.content_md);
    const download = { translation_id: translation.id, expected_translation_revision: 1, format: 'json', include_metadata: true, idempotency_key: 'file' };
    await assert.rejects(f.invoke('export-create', download), /검토를/);
    const edit = await f.invoke('translation-update', { ...translation, content_md: 'Reviewed translation', status: 'ready', translation_id: translation.id, expected_revision: 1 });
    const file = await f.invoke('export-create', { ...download, expected_translation_revision: edit.translation.revision });
    assert.equal(JSON.parse(Buffer.from(String((await f.store.read(db => readExportFile(db, file.history.id, ACTOR)))!.base64), 'base64').toString()).content_md, 'Reviewed translation');
    assert.equal((await f.rows('usage_reservations')).filter(row => row.id === result.run.reservation_id)[0].status, 'committed');
    const restarted = new PersistentHaloXStore(f.filename);
    assert.equal((await runTranslationCommand(restarted, 'translate-content-v2', { workspace_id: WS, ...values }, ACTOR)).reused, true); assert.equal(calls, 1);
    await assert.rejects(f.call({ ...values, locale: 'ja' }), /같은 요청 키/);
    await assert.rejects(f.call({ ...values, idempotency_key: 'new' }), /이미 있습니다/);
    await f.invoke('translation-delete', { translation_id: translation.id, expected_revision: edit.translation.revision }); assert.equal((await f.rows('translation_runs'))[0].translation_id, null);
    const noted = await f.call({ run_id: result.run.id, expected_revision: result.run.revision, notes: '검토 완료' }, 'translation-run-update'); assert.equal(noted.run.notes, '검토 완료');
    await assert.rejects(f.call({ run_id: result.run.id, expected_revision: result.run.revision }, 'translation-run-delete'), ContentConflictError);
    await f.call({ run_id: result.run.id, expected_revision: noted.run.revision }, 'translation-run-delete');
    assert.equal((await f.call(values)).ok, false); assert.equal(calls, 1); assert.equal((await f.store.read(db => db.getServerRecords('translation_requests'))).length, 1);
  });

  it('does not hold the writer lock during I/O and blocks duplicate/manual requests while keeping deleted source snapshots', async () => {
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
    const f = fixture({ translate: async (...args) => { started(); await gate; return translated.translate(...args); } });
    const { values, job } = await f.request(); const pending = f.call(values); await entered;
    try {
      const result = await f.call(values); assert.equal(result.run.status, 'running'); assert.equal(result.reused, true);
      await assert.rejects(f.call({ ...values, idempotency_key: 'parallel' }), /진행 중/);
      await assert.rejects(f.invoke('translation-create', { ...values, ...original, status: 'draft' }), /진행 중/);
      await assert.rejects(f.store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }, ACTOR)), /번역/);
      await f.invoke('content-delete', { job_id: job.id, expected_revision: job.revision });
    } finally { release(); }
    assert.equal((await pending).ok, true);
    const translation = (await f.rows('article_translations'))[0]; assert.equal(translation.content_job_id, null); assert.equal(translation.source_draft_id, null); assert.equal((translation.source_snapshot as Row).content_md, original.content_md);
    assert.equal((await f.rows('translation_runs'))[0].content_job_id, null);
  });

  it('releases usage for a definite first-batch rejection but not for a partial paid result', async () => {
    const first = fixture({ translate: async () => { throw new ExternalServiceError('한도 초과', 'TRANSLATION_REJECTED', 502, false); } });
    const { values } = await first.request(); const failed = await first.call(values); assert.equal(failed.run.status, 'failed'); assert.equal(failed.run.quota_status, 'released'); assert.equal((await first.call(values)).reused, true);
    let calls = 0;
    const partial = fixture({ translate: async batch => { if (++calls > 1) throw new ExternalServiceError('한도 초과', 'TRANSLATION_REJECTED', 502, false); return batch.map(piece => ({ text: `확인된 결과 ${piece.text}`, billed_characters: [...piece.text].length })); } });
    const request = await partial.request({ ...original, content_md: '한국어 긴 문단입니다.\n'.repeat(6000) }); const result = await partial.call(request.values);
    assert.equal(result.run.status, 'failed'); assert.equal(result.run.quota_status, 'committed'); assert.equal(result.run.completed_batches, 1); assert.ok(Number(result.run.billed_characters) > 0); assert.match(String((result.run.partial_body as Row).content_md), /확인된 결과/); assert.equal((await partial.rows('article_translations')).length, 0);
    assert.equal((await partial.call(request.values)).reused, true); assert.equal(calls, 2);
  });

  it('never automatically retries uncertain work, requires a delayed explicit close, and keeps tombstones and usage', async () => {
    let calls = 0; const f = fixture({ translate: async () => { calls++; throw new ExternalServiceError('응답 시간 초과'); } });
    const { values } = await f.request(); const result = await f.call(values); assert.equal(result.run.status, 'unknown'); assert.equal(result.run.billing_complete, false); assert.equal(result.run.quota_status, 'committed');
    await assert.rejects(f.call({ ...values, idempotency_key: 'different' }), /불확실/); assert.equal(calls, 1);
    const mutation = { run_id: result.run.id, expected_revision: result.run.revision, confirm: true };
    await assert.rejects(f.call(mutation, 'translation-run-delete'), /먼저 종료/);
    await assert.rejects(f.call(mutation, 'translation-run-resolve'), /5분/);
    const closed = await f.call(mutation, 'translation-run-resolve', ACTOR, () => Date.now() + 301000); assert.equal(closed.run.status, 'abandoned');
    assert.equal((await f.call(values)).ok, false); assert.equal(calls, 1);
    await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }, ACTOR)); assert.equal((await f.store.read(db => db.getServerRecords('translation_requests'))).length, 0);
  });

  it('enforces confirmation, revisions, member/tenant roles and REST protection before network I/O', async () => {
    let calls = 0; const f = fixture({ translate: async (...args) => { calls++; return translated.translate(...args); } }); const { values } = await f.request();
    await assert.rejects(f.call({ ...values, confirm: false }), /확인/); await assert.rejects(f.call({ ...values, expected_content_revision: 99 }), ContentConflictError);
    await assert.rejects(f.call(values, 'translate-content-v2', OTHER_USER_ID), /not authorized/i);
    await f.store.write(db => db.insertTable('workspace_members', { workspace_id: WS, user_id: OTHER_USER_ID, role: 'member' }, ACTOR));
    await assert.rejects(f.call(values, 'translate-content-v2', OTHER_USER_ID), /관리자 권한/); assert.equal(calls, 0);
    await f.store.read(db => { for (const method of ['POST', 'PATCH', 'DELETE'] as const) assert.throws(() => assertRestWrite(db, 'translation_runs', method, ACTOR, { workspace_id: WS }, { id: 'eq.test' }), /전용 서버/); assert.throws(() => db.queryTable('translation_requests'), /does not exist/); });
    assert.equal((await f.rows('translation_runs')).length, 0);
  });

  it('saves expanded output for editing, downloads and WordPress, and retains invalid oversized output as a failed run', async () => {
    const f = fixture({ translate: async batch => batch.map(piece => ({ text: piece.field === 'title' ? 'T'.repeat(700) : piece.field === 'content_md' ? 'Expanded '.repeat(20000) : 'M', billed_characters: piece.text.length })) });
    const { values } = await f.request(); const result = await f.call(values); assert.equal(result.ok, true); const row = (await f.rows('article_translations'))[0]; assert.ok(String(row.content_md).length > 100000);
    await f.invoke('translation-update', { ...row, translation_id: row.id, expected_revision: row.revision, status: 'ready' });
    const file = await f.invoke('export-create', { translation_id: row.id, expected_translation_revision: 2, format: 'md', include_metadata: false, idempotency_key: 'expanded' }); assert.ok(Number(file.history.byte_size) > 100000); assert.equal(wordpressContent(row).title.length, 700);
    const invalid = fixture({ translate: async batch => batch.map(piece => ({ text: piece.field === 'title' ? 'T'.repeat(1001) : 'body', billed_characters: piece.text.length })) });
    const failed = await invalid.call((await invalid.request()).values); assert.equal(failed.run.status, 'failed'); assert.equal(String((failed.run.partial_body as Row).title).length, 1001); assert.equal((await invalid.rows('article_translations')).length, 0);
  });
});
