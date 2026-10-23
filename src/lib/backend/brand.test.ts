import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HaloXDatabase, DEFAULT_USER_ID as OWNER, OTHER_USER_ID as USER, DEFAULT_WORKSPACE_ID as WS, type Row } from './database.ts';
import { brandDomain, domainKey, classifyBrandEvidence, validateBrandConfig, BrandConflictError, type BrandConfig } from './brand-model.ts';
import { readBrandSettings, readBrandConfig, runBrandCommand, reclassifyBrandData } from './brand-service.ts';
import { PersistentHaloXStore } from './store.ts';
import { readAnalysisData } from './analysis-model.ts';
import { defaultAnalysisFilters } from '../api/analyses.ts';
import { runRawImportCommand, readRawImportFile } from './raw-import-service.ts';
import { assertRestWrite } from './rest-policy.ts';
const base: BrandConfig = { enabled: true, revision: 1, mode: 'root', brands: [{ id: 'a', brand_name: 'Apple', role: 'self', mentions: ['애플'], domains: ['apple.co.kr'], keyword_set_ids: [] }], products: [], aliases: [] };
function fixture() {
  const db = new HaloXDatabase(), workspace = String(db.insertTable('workspaces', { name: '브랜드 테스트', default_brand_filter: 'legacy.test' })[0].id);
  const run = (action: string, values: Row = {}, actor = OWNER) => runBrandCommand(db, actor, { action, workspace_id: workspace, expected_revision: readBrandConfig(db, workspace, actor).revision, ...values });
  const insert = (table: string, values: Row) => db.insertTable(table, { workspace_id: workspace, ...values })[0];
  const keyword = insert('keywords', { keyword: '비교 검색' }), prompt = insert('geo_prompts', { prompt_text: '어떤 도구가 좋나요?' }), at = new Date(Date.now() - 1000).toISOString();
  const snapshot = insert('serp_snapshots', { keyword_id: keyword.id, keyword_text: keyword.keyword, captured_at: at, language: 'ko', country: 'KR', engine: 'google', provider: 'fixture', top_results_json: [{ url: 'https://shop.apple.co.kr/item', rank: 3, title: 'Apple Atlas' }, { url: 'https://rival.test/info', rank: 1 }], ai_overview_detected: true, ai_overview_json: { text: '원본 요약', cited_domains: ['shop.apple.co.kr'] } });
  const geo = insert('geo_prompt_runs', { prompt_id: prompt.id, prompt_text: prompt.prompt_text, language_code: 'ko', location_code: 'KR', engine: 'openai', status: 'completed', finished_at: at, brand_domain: '', answer_text: 'Apple Atlas를 추천합니다. 애플은 좋은 제품입니다. Rival도 있습니다.', provider: 'fixture' });
  const metric = insert('geo_run_metrics', { run_id: geo.id, brand_mentioned: false, is_cited: false, citation_rank_score: 80, mention_rank_score: 70 });
  insert('geo_answers_raw', { run_id: geo.id, prompt_id: prompt.id, answer_text: geo.answer_text });
  const citation = insert('geo_citations', { run_id: geo.id, cited_url: 'https://old-apple.test/info', position_index: 1, is_ours: false, is_competitor: false });
  insert('geo_citations', { run_id: geo.id, cited_url: 'https://rival.test/info', position_index: 2, is_ours: false, is_competitor: false });
  const config = () => readBrandConfig(db, workspace, OWNER), row = (table: string, id: unknown) => db.queryTable(table, { filters: { id: `eq.${id}` } }).data[0];
  const own = () => run('brand-create', { brand_name: 'Apple', role: 'self', mentions: ['애플'], domains: ['apple.co.kr'] });
  return { db, workspace, run, insert, keyword, prompt, snapshot, geo, metric, citation, config, row, own };
}

describe('brand tracking and source-preserving reclassification', () => {
  it('normalizes domains with public/private suffix boundaries and rejects ambiguous URL inputs', () => {
    assert.equal(brandDomain('HTTPS://EXAMPLE.COM/'), 'example.com'); assert.equal(brandDomain('bücher.de'), 'xn--bcher-kva.de');
    assert.equal(domainKey('shop.apple.co.kr', 'root'), 'apple.co.kr'); assert.equal(domainKey('one.github.io', 'root'), 'one.github.io'); assert.notEqual(domainKey('one.github.io', 'root'), domainKey('two.github.io', 'root'));
    for (const input of ['co.uk', 'github.io', 'localhost', 'x.local', 'x.localhost', '127.0.0.1', '[::1]', 'https://example.com:443', 'example.com:80', 'a@example.com', 'https://example.com/a/..', 'example.com?q=x', 'example.com/#x', 'javascript:alert(1)', '-bad.com', 'x'.repeat(64) + '.com', 5]) assert.throws(() => brandDomain(input));
  });
  it('matches normalized mentions and products without ASCII substring false positives', () => {
    const config = { ...base, products: [{ id: 'p', brand_id: 'a', name: 'Atlas', mentions: ['아틀라스'], category: '', url: '', description: '' }] };
    assert.equal(classifyBrandEvidence(config, 'pineapple is nice', []).mentioned, false);
    const found = classifyBrandEvidence(config, 'ＡＰＰＬＥ Atlas와 애플을 비교합니다.', [{ url: 'https://shop.apple.co.kr/product' }, { url: 'https://apple.co.kr.evil.test/' }]);
    assert.equal(found.mentioned, true); assert.deepEqual(found.product_ids, ['p']); assert.equal(found.sources[0].is_ours, true); assert.equal(found.sources[1].is_ours, false);
    assert.equal(classifyBrandEvidence({ ...config, mode: 'full' }, null, [{ url: 'https://shop.apple.co.kr/' }]).cited, false);
    assert.equal(classifyBrandEvidence({ ...base, brands: [] }, '', []).mentioned, null);
  });
  it('validates aliases, cycles, mode changes, cross-brand collisions and duplicate names', () => {
    const full = { ...base, mode: 'full' as const, brands: [...base.brands, { ...base.brands[0], id: 'b', brand_name: 'Other', mentions: [], domains: ['shop.apple.co.kr'] }] };
    assert.doesNotThrow(() => validateBrandConfig(full, [])); assert.throws(() => validateBrandConfig({ ...full, mode: 'root' }, []), /같은 도메인/);
    assert.throws(() => validateBrandConfig({ ...base, aliases: [{ id: 'a', source: 'old.test', target: 'new.test' }, { id: 'b', source: 'new.test', target: 'old.test' }] }, []), /순환/);
    assert.throws(() => validateBrandConfig({ ...base, aliases: [{ id: 'a', source: 'shop.apple.co.kr', target: 'apple.co.kr' }] }, []), /자기 자신/);
    assert.throws(() => validateBrandConfig({ ...base, brands: [...base.brands, { ...base.brands[0], id: 'b', brand_name: 'ＡＰＰＬＥ' }] }, []), /대표 이름/);
    assert.throws(() => validateBrandConfig({ ...base, brands: [...base.brands, { ...base.brands[0], id: 'b', brand_name: 'Rival', mentions: ['애플'], domains: ['rival.test'] }] }, []), /멘션/);
  });
  it('upgrades legacy brands deterministically without activating rules or resurrecting deleted competitors', () => {
    const db = new HaloXDatabase(), legacy = db.exportState(), first = legacy.tables.brands[0];
    legacy.tables.brands = [Object.fromEntries(Object.entries(first).filter(([key]) => !['role', 'mentions', 'domains', 'keyword_set_ids'].includes(key)))];
    const restored = new HaloXDatabase(); restored.restoreState(legacy); const migrated = readBrandConfig(restored, WS, OWNER);
    assert.equal(migrated.enabled, false); assert.equal(migrated.brands.length, 3); assert.deepEqual(restored.exportState().tables.serp_snapshots, legacy.tables.serp_snapshots);
    restored.deleteTable('brands', { id: `eq.${migrated.brands[1].id}` }); const reopened = new HaloXDatabase(); reopened.restoreState(restored.exportState());
    assert.equal(readBrandConfig(reopened, WS, OWNER).brands.length, 2); assert.equal(readBrandConfig(reopened, WS, OWNER).brands[1].id, migrated.brands[2].id);
  });
  it('reclassifies SEO/GEO, aliases and product mentions while retaining raw bytes and original provider values', () => {
    const f = fixture(), original = f.db.exportState(); f.own();
    f.run('brand-create', { brand_name: 'Rival', role: 'competitor', domains: ['rival.test'], mentions: [] });
    f.run('alias-create', { source: 'old-apple.test', target: 'apple.co.kr' });
    f.run('product-create', { brand_id: f.config().brands[0].id, name: 'Atlas', mentions: [], category: '분석', url: 'https://apple.co.kr/atlas', description: '분석 도구' });
    const seo = readAnalysisData(f.db, f.workspace, OWNER, 'seo', defaultAnalysisFilters()), geo = readAnalysisData(f.db, f.workspace, OWNER, 'geo', defaultAnalysisFilters());
    assert.equal(seo.summary.average_rank, 3); assert.equal(seo.summary.aio_percent, 100); assert.equal(seo.domains.find(row => row.domain === 'rival.test')?.competitor, 1);
    assert.equal(readAnalysisData(f.db, f.workspace, OWNER, 'seo', { ...defaultAnalysisFilters(), domain: 'rival.test' }).summary.average_rank, 1);
    assert.equal(geo.summary.mention_percent, 100); assert.equal(geo.summary.citation_percent, 100); assert.equal(geo.domains.find(row => row.domain === 'rival.test')?.competitor, 1);
    assert.deepEqual(f.row('serp_snapshots', f.snapshot.id).top_results_json, f.snapshot.top_results_json); assert.equal(f.row('serp_snapshots', f.snapshot.id).provider_analysis_json, null);
    assert.equal(f.row('geo_prompt_runs', f.geo.id).answer_text, f.geo.answer_text); assert.equal(f.row('geo_prompt_runs', f.geo.id).brand_domain, ''); assert.equal(f.row('geo_citations', f.citation.id).cited_url, f.citation.cited_url);
    const metrics = f.row('geo_run_metrics', f.metric.id); assert.equal(metrics.citation_rank_score, null); assert.equal((metrics.provider_classification as Row).citation_rank_score, 80); assert.equal((metrics.provider_classification as Row).brand_mentioned, false);
    assert.deepEqual(f.db.exportState().tables.geo_answers_raw, original.tables.geo_answers_raw);
    const view = readBrandSettings(f.db, f.workspace, OWNER); assert.equal(view.brand_counts[f.config().brands[0].id], 1); assert.equal(view.product_counts[f.config().products[0].id], 1);
    f.run('policy-update', { mode: 'full' }); assert.equal(readAnalysisData(f.db, f.workspace, OWNER, 'seo', defaultAnalysisFilters()).summary.average_rank, null);
    assert.equal(f.row('serp_snapshots', f.snapshot.id).provider_analysis_json, null); assert.equal((f.row('geo_run_metrics', f.metric.id).provider_classification as Row).citation_rank_score, 80);
  });
  it('uses linked keyword-set brands, updates classifications on moves, and cleans deleted set bindings', () => {
    const f = fixture(), set = f.insert('keyword_sets', { name: 'Apple 전용' }); f.own(); f.run('brand-create', { brand_name: '두 번째 자사', role: 'self', mentions: [], domains: ['rival.test'] });
    const own = f.config().brands[0]; f.run('brand-update', { id: own.id, keyword_set_ids: [set.id] });
    f.db.updateTable('keywords', { keyword_set_id: set.id }, { id: `eq.${f.keyword.id}` }); assert.equal((f.row('serp_snapshots', f.snapshot.id).brand_classification as Row).rank, 3);
    f.db.updateTable('keywords', { keyword_set_id: null }, { id: `eq.${f.keyword.id}` }); assert.equal((f.row('serp_snapshots', f.snapshot.id).brand_classification as Row).rank, 1);
    const before = f.config().revision; f.db.deleteTable('keyword_sets', { id: `eq.${set.id}` }); assert.deepEqual(f.config().brands[0].keyword_set_ids, []); assert.equal(f.config().revision, before + 1);
    assert.throws(() => f.run('brand-update', { id: own.id, expected_revision: before, brand_name: '오래된 입력' }), BrandConflictError);
  });
  it('merges same-role profiles and products, supports product/alias CRUD and deletion leaves evidence intact', () => {
    const f = fixture(); f.own(); const own = f.config().brands[0]; f.run('brand-create', { brand_name: 'Another', role: 'self', mentions: ['다른 이름'], domains: ['another.test'] });
    const source = f.config().brands[1]; f.run('product-create', { brand_id: source.id, name: '제품', mentions: ['별명'] }); const product = f.config().products[0];
    f.run('brand-merge', { id: source.id, target_id: own.id }); assert.equal(f.config().brands.length, 1); assert.ok(f.config().brands[0].mentions.includes('Another')); assert.equal(f.config().products[0].brand_id, own.id);
    f.run('product-update', { id: product.id, category: '분석', description: '변경', url: 'https://apple.co.kr/a' }); assert.equal(f.config().products[0].description, '변경');
    f.run('alias-create', { source: 'old.test', target: 'another.test' }); const alias = f.config().aliases[0]; f.run('alias-update', { id: alias.id, target: 'apple.co.kr' }); assert.equal(f.config().aliases[0].target, 'apple.co.kr'); f.run('alias-delete', { id: alias.id });
    f.run('product-delete', { id: product.id }); assert.equal(f.config().products.length, 0); f.run('product-create', { brand_id: own.id, name: '연쇄 제품' }); f.run('brand-delete', { id: own.id });
    assert.equal(f.config().products.length, 0); assert.equal(readAnalysisData(f.db, f.workspace, OWNER, 'geo', defaultAnalysisFilters()).summary.mention_percent, null); assert.ok(f.row('geo_prompt_runs', f.geo.id));
  });
  it('applies active rules to newly collected results and raw imports without rewriting import files', async () => {
    const f = fixture(); f.own(); f.run('brand-update', { id: f.config().brands[0].id, domains: ['brizzi.kr'] });
    const collected = await f.db.invokeEdgeFunction('keywords-collect', { workspace_id: f.workspace, keywords: ['새로 수집'] }); assert.equal(((collected.snapshots as Row[])[0].brand_classification as Row).config_revision, f.config().revision);
    const generated = await f.db.invokeEdgeFunction('geo-run', { workspace_id: f.workspace, prompt_id: f.prompt.id, engines: ['openai'] }); assert.ok(JSON.stringify(generated).includes('config_revision'));
    const contents = JSON.stringify({ schema_version: 1, kind: 'seo', source: { provider: 'fixture', url: '' }, records: [{ source_id: 'import-one', keyword_id: f.keyword.id, keyword_text: f.keyword.keyword, language: 'ko', country: 'KR', engine: 'google', captured_at: new Date(Date.now() - 1000).toISOString(), top_results: [{ url: 'https://brizzi.kr/import', rank: 2 }] }] });
    const imported = runRawImportCommand(f.db, 'raw-import-create', { idempotency_key: 'import-test', title: '원문', filename: 'data.json', contents }, f.workspace, OWNER).batch as Row;
    const snapshot = f.db.queryTable('serp_snapshots', { filters: { import_batch_id: `eq.${imported.id}` } }).data[0]; assert.equal((snapshot.brand_classification as Row).rank, 2);
    assert.equal(readRawImportFile(f.db, f.workspace, OWNER, String(imported.id)).bytes.toString(), contents);
  });
  it('requires admin plus both menu scopes and rejects REST mutation, foreign references and stale settings', () => {
    const f = fixture(); f.own(); const member = f.db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: USER, role: 'member' })[0];
    assert.equal(readBrandSettings(f.db, f.workspace, USER).editable, false); assert.throws(() => f.run('policy-update', { mode: 'full' }, USER));
    f.db.updateTable('workspace_members', { role: 'admin', allowed_sections: ['other'] }, { id: `eq.${member.id}` }); assert.throws(() => readBrandSettings(f.db, f.workspace, USER)); assert.throws(() => f.run('policy-update', { mode: 'full' }, USER));
    for (const table of ['brands', 'brand_tracking_settings', 'brand_products', 'brand_domain_aliases', 'brand_reclassify_jobs']) assert.throws(() => assertRestWrite(f.db, table, 'POST', OWNER, { workspace_id: f.workspace }));
    const foreignSet = f.db.queryTable('keyword_sets').data[0]; assert.throws(() => f.run('brand-update', { id: f.config().brands[0].id, keyword_set_ids: [foreignSet.id] }));
    assert.throws(() => f.run('product-create', { brand_id: 'foreign', name: '침범' })); assert.throws(() => f.run('policy-update', { mode: 'full', expected_revision: 0 }), BrandConflictError);
  });
  it('serializes settings, rolls back invalid updates, persists history and prevents repeated manual jobs after deletion', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'halox-brand-')), filename = path.join(directory, 'test.sqlite'), store = new PersistentHaloXStore(filename);
    try {
      const before = await store.read(db => db.exportState());
      await assert.rejects(store.write(db => runBrandCommand(db, OWNER, { workspace_id: WS, action: 'brand-create', expected_revision: 0, brand_name: '중복', role: 'self', domains: ['brizzi.kr'] }))); assert.deepEqual(await store.read(db => db.exportState()), before);
      const outcomes = await Promise.allSettled([store, new PersistentHaloXStore(filename)].map(item => item.write(db => runBrandCommand(db, OWNER, { workspace_id: WS, action: 'policy-update', expected_revision: 0, mode: 'full' })))); assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
      const payload = { workspace_id: WS, action: 'recalculate', expected_revision: 1, idempotency_key: 'single-run' };
      const job = (await store.write(db => runBrandCommand(db, OWNER, payload))).job as Row;
      assert.equal((await new PersistentHaloXStore(filename).write(db => runBrandCommand(db, OWNER, payload))).replayed, true);
      await store.write(db => runBrandCommand(db, OWNER, { workspace_id: WS, action: 'job-update', id: job.id, expected_revision: 1, notes: '검토 완료' }));
      assert.equal((await store.read(db => readBrandSettings(db, WS, OWNER))).jobs.find(row => row.id === job.id)?.notes, '검토 완료');
      await assert.rejects(store.write(db => runBrandCommand(db, OWNER, { workspace_id: WS, action: 'job-delete', id: job.id, expected_revision: 1 })), BrandConflictError);
      await store.write(db => runBrandCommand(db, OWNER, { workspace_id: WS, action: 'job-delete', id: job.id, expected_revision: 2 })); await assert.rejects(store.write(db => runBrandCommand(db, OWNER, payload)), /이미 실행/);
      await store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` })); assert.equal((await store.read(db => db.getServerRecords('brand_reclassify_requests'))).length, 0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
