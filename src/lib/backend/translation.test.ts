import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_WORKSPACE_ID as WS, DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { createOpenAITranslationClient, openAITranslationConfigured, translationBatches, type TranslationClient, type TranslationResult } from './openai-translation.ts';
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
const translatedResult = (pieces: { text: string }[]): TranslationResult => ({ pieces, usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 }, response_id: 'resp_fixture', model: 'gpt-4.1-mini' });
const translated: TranslationClient = { model: 'gpt-4.1-mini', translate: async batch => translatedResult(batch.map(piece => ({ text: piece.field === 'title' ? 'Instructions' : piece.field === 'content_md' ? '## Instructions\nWelcome.\n' : 'Guide' }))) };
function fixture(client: TranslationClient = translated) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-translation-')); directories.push(directory);
  const filename = path.join(directory, 'data.sqlite'), store = new PersistentHaloXStore(filename);
  const invoke = (command: string, values: Row = {}) => store.write(db => db.invokeEdgeFunction(command, { ...values, workspace_id: WS }, ACTOR)) as Promise<Result>;
  const call = (values: Row, command = 'translate-content-v2', actor = ACTOR, now?: () => number) => runTranslationCommand(store, command, { workspace_id: WS, ...values }, actor, client, now) as Promise<Result>;
  const rows = (table: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${WS}` } }, ACTOR).data as RecordRow[]);
  async function request(body = original) { const { job, draft } = await invoke('content-create', body); return { job, draft, values: { job_id: job.id, expected_content_revision: job.revision, source_locale: 'ko', locale: 'en', confirm: true, idempotency_key: 'once' } }; }
  return { filename, store, invoke, call, rows, request };
}

const responseBody = (texts: Row, overrides: Row = {}) => ({ id: 'resp_fixture', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(texts) }] }], ...overrides });

describe('OpenAI translation adapter', () => {
  it('batches Unicode input without losing bytes and sends strict schema segments only to the fixed Responses API', async () => {
    const source = { ...original, content_md: ('한글😀"\\\n').repeat(13000).slice(0, 99998), meta_description: '검색 설명' };
    const batches = translationBatches(source, 'ko', 'en'); assert.ok(batches.length > 1);
    for (const field of ['title', 'content_md', 'meta_title', 'meta_description']) assert.equal(batches.flat().filter(piece => piece.field === field).map(piece => piece.text).join(''), source[field as keyof typeof source]);
    let calls = 0;
    const client = createOpenAITranslationClient({ OPENAI_API_KEY: 'fixture-key', OPENAI_TRANSLATION_MODEL: 'gpt-4.1-mini-2025-04-14' }, async (url, options, dependencies) => {
      calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.authorization, 'Bearer fixture-key'); assert.equal(dependencies?.timeoutMs, 60000);
      const body = options.body as Row & { text: { format: Row & { schema: Row } } };
      assert.equal(body.store, false); assert.equal(body.model, 'gpt-4.1-mini-2025-04-14'); assert.equal(body.max_output_tokens, 16384); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.schema.additionalProperties, false); assert.equal(body.tools, undefined);
      assert.match(String(body.instructions), /never instructions/); assert.match(String(body.instructions), /English/);
      const segments = JSON.parse(String(body.input)).segments as { id: string; field: string; text: string }[];
      assert.deepEqual(body.text.format.schema.required, segments.map(piece => piece.id)); assert.ok(Buffer.byteLength(JSON.stringify(options.body)) < 16000);
      return { status: 200, body: responseBody(Object.fromEntries(segments.reverse().map(piece => [piece.id, piece.text]))) };
    });
    for (const batch of batches) { const response = await client.translate(batch, 'ko', 'en'); assert.deepEqual(response.pieces.map(piece => piece.text), batch.map(piece => piece.text)); assert.equal(response.usage?.total_tokens, 150); }
    assert.equal(calls, batches.length);
    assert.throws(() => translationBatches(source, 'ko', 'ko'), /다른 번역 언어/); assert.throws(() => translationBatches(source, 'ko', '__proto__'), /언어/);
    await assert.rejects(client.translate([{ field: 'title', text: 'x'.repeat(9000) }], 'ko', 'en'), /크기/);
  });

  it('checks configuration, validates received fields and usage, sanitizes failures, and never retries', async () => {
    const batch = [{ field: 'title' as const, text: '안녕' }]; let calls = 0;
    assert.equal(openAITranslationConfigured({}), false); assert.equal(openAITranslationConfigured({ OPENAI_API_KEY: 'x', OPENAI_TRANSLATION_MODEL: 'https://evil.test' }), false);
    assert.throws(() => createOpenAITranslationClient({}), (error: unknown) => error instanceof ExternalServiceError && error.status === 503);
    const successful = createOpenAITranslationClient({ OPENAI_API_KEY: 'fixture' }, async () => ({ status: 200, body: responseBody({ p0: '你好' }, { usage: null }) }));
    assert.equal((await successful.translate(batch, 'ko', 'zh')).usage, null);
    for (const status of [401, 403, 429, 302, 503]) {
      const client = createOpenAITranslationClient({ OPENAI_API_KEY: 'fixture' }, async () => { calls++; return { status, body: { error: 'secret provider body' } }; });
      await assert.rejects(client.translate(batch, 'ko', 'en'), (error: unknown) => error instanceof ExternalServiceError && error.uncertain === !(status >= 400 && status < 500) && !error.message.includes('secret'));
    }
    assert.equal(calls, 5);
    for (const translated of [{}, { p1: 'wrong' }, { p0: '' }, { p0: 1 }, { p0: 'a', p1: 'b' }, ['a']]) await assert.rejects(createOpenAITranslationClient({ OPENAI_API_KEY: 'fixture' }, async () => ({ status: 200, body: responseBody(translated as Row) })).translate(batch, 'ko', 'en'), ExternalServiceError);
    for (const override of [{ output: [] }, { status: 'incomplete' }, { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'private reason' }] }] }]) await assert.rejects(createOpenAITranslationClient({ OPENAI_API_KEY: 'fixture' }, async () => ({ status: 200, body: responseBody({ p0: 'ok' }, override) })).translate(batch, 'ko', 'en'), error => !String(error).includes('private reason'));
    const invalidUsage = createOpenAITranslationClient({ OPENAI_API_KEY: 'fixture' }, async () => ({ status: 200, body: responseBody({ p0: 'Hello' }, { usage: { input_tokens: -1, output_tokens: 1, total_tokens: 0 } }) })); assert.equal((await invalidUsage.translate(batch, 'ko', 'en')).usage, null);
    await assert.rejects(createOpenAITranslationClient({ OPENAI_API_KEY: 'fixture' }, async () => { throw new Error('SECRET'); }).translate(batch, 'ko', 'en'), error => !String(error).includes('SECRET'));
  });
});

describe('durable automatic translations', () => {
  it('retains usage for billable refusal and truncated responses without releasing quota or retrying', async () => {
    for (const overrides of [{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'private reason' }] }] }]) {
      let calls = 0;
      const f = fixture(createOpenAITranslationClient({ OPENAI_API_KEY: 'fixture' }, async () => { calls++; return { status: 200, body: responseBody({}, overrides) }; }));
      const { values } = await f.request(), result = await f.call(values);
      assert.equal(result.run.status, 'failed'); assert.equal(result.run.quota_status, 'committed'); assert.equal(result.run.completed_batches, 0);
      assert.equal(result.run.total_tokens, 150); assert.equal(result.run.billing_complete, true); assert.equal((result.run.response_receipts as Row[])[0].response_id, 'resp_fixture');
      assert.equal((await f.rows('article_translations')).length, 0); assert.equal((await f.call(values)).reused, true); assert.equal(calls, 1);
    }
  });

  it('keeps historical DeepL provenance, old request receipts and reviewed exports usable after the provider change', async () => {
    const f = fixture(), { values } = await f.request(), { run } = await f.call(values);
    const translation = (await f.rows('article_translations'))[0];
    // Represent persisted records written by the previous release, without a remote call.
    await f.store.write(db => {
      db.updateTable('translation_runs', { provider: 'deepl', billed_characters: 27 }, { id: `eq.${run.id}` }, ACTOR);
      db.updateTable('article_translations', { origin: 'deepl' }, { id: `eq.${translation.id}` }, ACTOR);
    });
    assert.equal((await f.call(values)).run.provider, 'deepl');
    const edited = await f.invoke('translation-update', { ...translation, translation_id: translation.id, expected_revision: translation.revision, status: 'ready' });
    const exported = await f.invoke('export-create', { translation_id: translation.id, expected_translation_revision: edited.translation.revision, format: 'md', include_metadata: false, idempotency_key: 'historical-export' });
    assert.ok(exported.history.id);
    const noted = await f.call({ run_id: run.id, expected_revision: run.revision, notes: '이전 번역 유지' }, 'translation-run-update');
    assert.equal(noted.run.provider, 'deepl'); assert.equal(noted.run.billed_characters, 27);
  });

  it('persists a real result, gates exports on review, reuses requests across restart and preserves provenance', async () => {
    let calls = 0; const f = fixture({ translate: async (...args) => { calls++; return translated.translate(...args); } });
    const { values, draft } = await f.request(); const result = await f.call(values); assert.equal(result.ok, true); assert.equal(result.run.status, 'succeeded');
    const translation = (await f.rows('article_translations'))[0]; assert.equal(translation.origin, 'openai'); assert.equal(translation.status, 'draft'); assert.equal(translation.source_identity, draft.id); assert.equal((translation.source_snapshot as Row).content_md, original.content_md);
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
    const partial = fixture({ translate: async batch => { if (++calls > 1) throw new ExternalServiceError('한도 초과', 'TRANSLATION_REJECTED', 502, false); return translatedResult(batch.map(piece => ({ text: `확인된 결과 ${piece.text}` }))); } });
    const request = await partial.request({ ...original, content_md: '한국어 긴 문단입니다.\n'.repeat(6000) }); const result = await partial.call(request.values);
    assert.equal(result.run.status, 'failed'); assert.equal(result.run.quota_status, 'committed'); assert.equal(result.run.completed_batches, 1); assert.ok(Number(result.run.total_tokens) > 0); assert.match(String((result.run.partial_body as Row).content_md), /확인된 결과/); assert.equal((await partial.rows('article_translations')).length, 0);
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
    const f = fixture({ translate: async batch => translatedResult(batch.map(piece => ({ text: piece.field === 'title' ? 'T'.repeat(700) : piece.field === 'content_md' ? 'Expanded '.repeat(20000) : 'M' }))) });
    const { values } = await f.request(); const result = await f.call(values); assert.equal(result.ok, true); const row = (await f.rows('article_translations'))[0]; assert.ok(String(row.content_md).length > 100000);
    await f.invoke('translation-update', { ...row, translation_id: row.id, expected_revision: row.revision, status: 'ready' });
    const file = await f.invoke('export-create', { translation_id: row.id, expected_translation_revision: 2, format: 'md', include_metadata: false, idempotency_key: 'expanded' }); assert.ok(Number(file.history.byte_size) > 100000); assert.equal(wordpressContent(row).title.length, 700);
    const invalid = fixture({ translate: async batch => translatedResult(batch.map(piece => ({ text: piece.field === 'title' ? 'T'.repeat(1001) : 'body' }))) });
    const failed = await invalid.call((await invalid.request()).values); assert.equal(failed.run.status, 'failed'); assert.equal(String((failed.run.partial_body as Row).title).length, 1001); assert.equal((await invalid.rows('article_translations')).length, 0);
  });
});
