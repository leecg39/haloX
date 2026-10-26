import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeProviders, runtimeProviderStatus } from './runtime-providers.ts';
import { ExternalServiceError, type publicJsonRequest } from './public-json.ts';
import { HaloXDatabase, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID as WS } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { applyContentChanges } from './optimization-service.ts';

const env = { OPENAI_API_KEY: 'test-only-key', DATAFORSEO_LOGIN: 'test-login', DATAFORSEO_PASSWORD: 'test-password' };
const article = { title: '실제 초안', content_md: '## 근거\n\n검증한 자료로 작성한 본문입니다.', meta_title: '검색 제목', meta_description: '검색 설명' };
const response = (text: string, annotations: unknown[] = []) => ({ status: 200, body: { id: 'resp_test', model: 'test-model', status: 'completed', usage: { input_tokens: 10, output_tokens: 20 }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }] }] } });
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const storeFor = (request: typeof publicJsonRequest, settings = env) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'halox-runtime-')); dirs.push(dir);
  const filename = path.join(dir, 'test.sqlite');
  const factory = () => new HaloXDatabase(createRuntimeProviders(settings, request));
  return { store: new PersistentHaloXStore(filename, factory), reopen: () => new PersistentHaloXStore(filename, factory) };
};

test('missing configuration fails without network or fabricated results; demo is explicit', async () => {
  let calls = 0;
  const providers = createRuntimeProviders({}, async () => { calls++; throw new Error(); });
  await assert.rejects(providers.generateContentDraft('주제'), /OPENAI_API_KEY/);
  await assert.rejects(providers.runGeoPrompt('질문', 'openai'), /OPENAI_API_KEY/);
  await assert.rejects(providers.collectSerp('검색어'), /DATAFORSEO_LOGIN/);
  assert.equal(calls, 0);
  assert.equal(runtimeProviderStatus({}).mode, 'live');
  assert.deepEqual(runtimeProviderStatus(env), { mode: 'live', openai: true, dataforseo: true });
  assert.match((await createRuntimeProviders({ HALOX_PROVIDER_MODE: 'demo' }).runGeoPrompt('질문', 'claude')).answerText, /데모/);
});

test('content uses Responses schema and supplied evidence, preserving receipt without fake scores', async () => {
  const providers = createRuntimeProviders(env, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.authorization, 'Bearer test-only-key');
    const body = options.body as Record<string, unknown>;
    assert.equal(body.store, false); assert.equal(body.model, 'gpt-4.1-mini');
    assert.match(JSON.stringify(body.text), /json_schema/);
    assert.match(String(body.input), /사용자 자료/);
    return response(JSON.stringify(article));
  });
  const draft = await providers.generateContentDraft('주제', '희망 제목', { knowledge: [{ id: 'knowledge', name: '사용자 자료', description: '', body: '', contexts: [], sources: [{ id: 'source', title: '근거', url: 'https://example.com/evidence', content: '원문', filename: '' }] }] });
  assert.equal(draft.contentMd, article.content_md); assert.equal(draft.seoScore, null); assert.equal(draft.aioScore, null);
  assert.equal(draft.receipt?.responseId, 'resp_test'); assert.equal(draft.receipt?.model, 'test-model');
  assert.deepEqual(draft.groundingSources, ['https://example.com/evidence']);
});

test('GEO uses only web search citations, links valid ranges, and does not bias the question with brand', async () => {
  const providers = createRuntimeProviders(env, async (_url, options) => {
    const body = options.body as Record<string, unknown>;
    assert.equal(body.input, '어떤 도구를 추천하나요?'); assert.equal(body.tool_choice, 'required');
    assert.deepEqual(body.tools, [{ type: 'web_search' }]);
    return response('자료 [1]과 [2]를 확인하세요.', [
      { type: 'url_citation', url: 'https://docs.example.co.kr/guide', title: '가이드', start_index: 3, end_index: 6 },
      { type: 'url_citation', url: 'https://notexample.co.kr/other', title: '다른 자료', start_index: 8, end_index: 11 },
      { type: 'url_citation', url: 'javascript:alert(1)' },
      { type: 'file_citation', url: 'https://fake.example/' },
    ]);
  });
  const result = await providers.runGeoPrompt('어떤 도구를 추천하나요?', 'openai', 'example.co.kr');
  assert.equal(result.citations.length, 2); assert.equal(result.citations[0].is_ours, true); assert.equal(result.citations[0].root_domain, 'example.co.kr');
  assert.equal(result.citations[1].is_ours, false); assert.equal(result.citationRate, 50);
  assert.equal(result.answerAnnotations?.length, 2);
  await assert.rejects(providers.runGeoPrompt('질문', 'claude'), /OpenAI/);
});

test('SERP sends locale and maps organic ranks, PAA and related searches without invented volume', async () => {
  const providers = createRuntimeProviders(env, async (url, options) => {
    assert.equal(url, 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced');
    assert.equal(options.authorization, `Basic ${Buffer.from('test-login:test-password').toString('base64')}`);
    assert.deepEqual(options.body, [{ keyword: 'tool', location_name: 'United States', language_code: 'en', depth: 10, device: 'desktop' }]);
    return { status: 200, body: { status_code: 20000, tasks: [{ id: 'task-live', status_code: 20000, result: [{ items: [
      { type: 'organic', rank_group: 1, rank_absolute: 3, title: 'Guide', url: 'https://example.com/guide' },
      { type: 'paid', rank_group: 1, title: 'Ad', url: 'https://ads.example/' },
      { type: 'people_also_ask', items: [{ title: 'How does it work?' }] },
      { type: 'related_searches', items: ['tool tutorial'] }, { type: 'ai_overview' },
    ] }] }] } };
  });
  const result = await providers.collectSerp('tool', 'google', { language: 'en', country: 'US' });
  assert.equal(result.topResults.length, 1); assert.equal(result.topResults[0].rank, 1);
  assert.equal(result.searchVolume, null); assert.equal(result.keywordDifficulty, null); assert.equal(result.intent, null);
  assert.equal(result.aiOverviewDetected, true); assert.deepEqual(result.paaQuestions, ['How does it work?']);
  assert.deepEqual(result.relatedSearches, ['tool tutorial']); assert.equal(result.receipt?.provider, 'dataforseo');
});

test('provider failures, refusals, incomplete and malformed responses do not produce successful drafts', async () => {
  for (const result of [
    { status: 401, body: { secret: 'private-upstream-error' } },
    { status: 200, body: { status: 'incomplete' } },
    response('not-json'), response(JSON.stringify({ ...article, content_md: '' })),
    { status: 200, body: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal' }] }] } },
  ]) {
    let calls = 0;
    await assert.rejects(createRuntimeProviders(env, async () => { calls++; return result; }).generateContentDraft('주제'), error => error instanceof ExternalServiceError && !error.message.includes('private-upstream-error'));
    assert.equal(calls, 1);
  }
  await assert.rejects(createRuntimeProviders(env, async () => ({ status: 200, body: { status_code: 20000, tasks: [{ status_code: 40102 }] } })).collectSerp('주제'), /DataForSEO/);
});

test('real-shaped generation persists content and provenance across store reopen', async () => {
  const { store, reopen } = storeFor(async () => response(JSON.stringify(article)));
  const result = await store.write(db => db.invokeEdgeFunction('generate-content-draft', { workspace_id: WS, target_keyword: '자료 검증' }, DEFAULT_USER_ID));
  const draft = result.draft as Record<string, unknown>;
  const saved = await reopen().read(db => db.queryTable('content_drafts', { filters: { id: `eq.${draft.id}` } }, DEFAULT_USER_ID).data[0]);
  assert.equal(saved.content_md, article.content_md); assert.equal(saved.seo_score, null);
  assert.equal((saved.provider_receipt as Record<string, unknown>).provider, 'openai');
  assert.equal((saved.provider_receipt as Record<string, unknown>).responseId, 'resp_test');
});

test('failed live generation rolls back content and quota; mixed unsupported GEO engines fail before paid calls', async () => {
  let calls = 0;
  const { store } = storeFor(async () => { calls++; return { status: 429, body: {} }; });
  const before = await store.read(db => db.exportState());
  await assert.rejects(store.write(db => db.invokeEdgeFunction('generate-content-draft', { workspace_id: WS, target_keyword: '실패 테스트' }, DEFAULT_USER_ID)), /OpenAI/);
  assert.deepEqual(await store.read(db => db.exportState()), before); assert.equal(calls, 1);
  await assert.rejects(store.write(db => db.invokeEdgeFunction('geo-run', { workspace_id: WS, prompt_text: '멀티 엔진 질문', engines: ['openai', 'claude'] }, DEFAULT_USER_ID)), /OpenAI만/);
  assert.equal(calls, 1); assert.deepEqual(await store.read(db => db.exportState()), before);
});

test('optimization generates reviewable replacements that apply to the exact original', async () => {
  const revised = { ...article, content_md: '## 개선한 근거\n검증한 내용입니다.', meta_description: '개선한 검색 설명' };
  const providers = createRuntimeProviders(env, async (_url, options) => {
    assert.match(String((options.body as Record<string, unknown>).input), /수집한 참고/);
    return response(JSON.stringify(revised));
  });
  const result = await providers.proposeOptimization!('검증', article, { topResults: [{ title: '수집한 참고', url: 'https://example.com' }] });
  assert.equal(result.changes.length, 2); assert.equal(result.receipt.provider, 'openai');
  assert.deepEqual(applyContentChanges(article, result.changes), revised);
  assert.throws(() => applyContentChanges({ ...article, content_md: '동시에 편집한 내용' }, result.changes), /원문/);
});

test('agent answers the conversation with supplied metrics instead of a fixed recommendation', async () => {
  const providers = createRuntimeProviders(env, async (_url, options) => {
    const input = JSON.parse(String((options.body as Record<string, unknown>).input));
    assert.equal(input.messages.at(-1).content, '검색량이 왜 없나요?');
    assert.deepEqual(input.workspace_metrics, { search_volume: null });
    return response('별도 검색량 측정 자료가 없어 표시되지 않습니다.');
  });
  const result = await providers.answerAgent!([{ role: 'user', content: '검색량이 왜 없나요?' }], { search_volume: null });
  assert.equal(result.text, '별도 검색량 측정 자료가 없어 표시되지 않습니다.');
  assert.equal(result.receipt.responseId, 'resp_test');
});

test('live GEO and SERP provenance survives database collection without fabricated measurements', async () => {
  const { store, reopen } = storeFor(async url => url.includes('dataforseo') ? {
    status: 200, body: { status_code: 20000, tasks: [{ id: 'live-serp-task', status_code: 20000, result: [{ items: [{ type: 'organic', rank_group: 1, url: 'https://brizzi.kr/source', title: '실제 출처' }] }] }] },
  } : response('brizzi.kr 참고 [1]', [{ type: 'url_citation', url: 'https://brizzi.kr/source', title: '근거', start_index: 13, end_index: 16 }]));
  await store.write(db => db.invokeEdgeFunction('keywords-collect', { workspace_id: WS, keywords: ['실제 응답 자료 검증'], language: 'ko', country: 'KR' }, DEFAULT_USER_ID));
  await store.write(db => db.invokeEdgeFunction('geo-run', { workspace_id: WS, prompt_text: '실제 근거 확인 질문', engines: ['openai'] }, DEFAULT_USER_ID));
  await reopen().read(db => {
    const snapshot = db.queryTable('serp_snapshots', { filters: { provider: 'eq.dataforseo' } }, DEFAULT_USER_ID).data[0];
    assert.ok(snapshot); assert.equal(snapshot.search_volume, null); assert.equal(snapshot.keyword_difficulty, null);
    assert.equal((snapshot.provider_receipt as Record<string, unknown>).responseId, 'live-serp-task');
    const run = db.queryTable('geo_prompt_runs', { filters: { provider: 'eq.openai' } }, DEFAULT_USER_ID).data[0];
    assert.ok(run); assert.equal(run.cost_usd, null); assert.equal(run.model_name, 'test-model');
    assert.equal((run.provider_receipt as Record<string, unknown>).responseId, 'resp_test');
    const raw = db.queryTable('geo_answers_raw', { filters: { run_id: `eq.${run.id}` } }, DEFAULT_USER_ID).data[0];
    assert.equal(raw.provider, 'openai'); assert.equal(raw.answer_text, 'brizzi.kr 참고 [1]');
  });
});

test('GEO respects the saved language and country without injecting the tracked brand', async () => {
  const providers = createRuntimeProviders(env, async (_url, options) => {
    const body = options.body as Record<string, unknown>;
    assert.equal(body.instructions, 'Respond in language en.');
    assert.deepEqual(body.tools, [{ type: 'web_search', user_location: { type: 'approximate', country: 'US' } }]);
    assert.equal(body.input, 'Recommend a tool');
    assert.doesNotMatch(JSON.stringify(body), /tracked.example/);
    return response('Here are some options.');
  });
  await providers.runGeoPrompt('Recommend a tool', 'openai', 'tracked.example', { language: 'en', country: 'US' });
});
