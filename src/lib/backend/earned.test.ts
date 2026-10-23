import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_USER_ID as OWNER, OTHER_USER_ID as OTHER, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { earnedUrl, earnedValues, parseEarnedCsv } from './earned-model.ts';
import { readEarned, runEarnedCommand, EarnedConflictError } from './earned-service.ts';
import { assertRestWrite } from './rest-policy.ts';
import { parseRawImport } from './raw-import-format.ts';
const directories: string[] = [], period = { start: '2026-10-01', end: '2026-10-10' }, url = 'https://media.example/article?id=1';
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-earned-')); directories.push(directory); const file = path.join(directory, 'db.sqlite'), store = new PersistentHaloXStore(file);
  const ws = await store.write(db => db.insertTable('workspaces', { name: '등록 URL 검증' }, OWNER)[0]), workspace = String(ws.id);
  const command = (input: Row, actor = OWNER) => store.write(db => runEarnedCommand(db, actor, { workspace_id: workspace, ...input }));
  const create = (extra: Row = {}) => command({ action: 'create', request_id: crypto.randomUUID(), url, title: '발행 글', ...extra });
  const data = (actor = OWNER, filters = period) => store.read(db => readEarned(db, workspace, actor, filters));
  const insert = (table: string, row: Row) => store.write(db => db.insertTable(table, { ...row, workspace_id: workspace }, OWNER)[0]);
  const keyword = () => insert('keywords', { keyword: '외부 발행 검색' });
  const snapshot = (kw: Row, values: Row = {}) => insert('serp_snapshots', { keyword_id: kw.id, keyword_text: kw.keyword, language: kw.language, country: kw.country, engine: 'google', provider: 'fixture:seo', captured_at: '2026-10-03T01:00:00Z', top_results_json: [{ url, rank: 3 }], ...values });
  return { store, file, workspace, command, create, data, insert, keyword, snapshot };
}
describe('registered external publication URLs', () => {
  it('normalizes only safe URL syntax and fragments while preserving query, protocol and path identity', () => {
    assert.equal(earnedUrl(' HTTPS://Media.Example:443/article?id=1#section '), url);
    for (const other of ['http://media.example/article?id=1', 'https://media.example/article/?id=1', 'https://media.example/article?id=2']) assert.notEqual(earnedUrl(other), url);
    for (const bad of ['file:///tmp/x', 'https://u:p@media.example/', 'http://127.0.0.1/', 'http://localhost/', 'https://media.example:8080/', 'https://media.example/a\nb', 'https://media.example/a b']) assert.throws(() => earnedUrl(bad));
    assert.equal(earnedValues({ url }).channel, 'media.example'); assert.throws(() => earnedValues({ url, published_at: '2026-02-30' })); assert.throws(() => earnedValues({ url, title: 'a'.repeat(201) }));
    const longHost = earnedValues({ url: `https://${'a'.repeat(60)}.media.example/article` });
    assert.equal(longHost.channel.length, 60); assert.deepEqual(earnedValues(longHost), longHost);
  });
  it('parses UTF-8 CSV quoting, multiline cells and exact headers and rejects partial/malformed/oversized batches', () => {
    const parsed = parseEarnedCsv('\uFEFFurl,title,notes\r\n"https://media.example/a?q=1,2","제목 ""인용""","두 줄\n메모"\r\n');
    assert.equal(parsed[0].title, '제목 "인용"'); assert.equal(parsed[0].notes, '두 줄\n메모');
    for (const csv of ['url,url\na,b', 'title\n제목', 'url,bad\nhttps://media.example/a,x', 'url,title\nhttps://media.example/a', 'url\n"https://media.example/a', 'url\n"https://media.example/a"x', 'url\nhttps://media.example/a\nhttp://localhost/x', 'url\nhttps://media.example/a\nhttps://media.example/a#same', 'url\n' + 'a'.repeat(1024 * 1024), 'url\n' + Array.from({ length: 501 }, (_, i) => `https://media.example/${i}`).join('\n')]) assert.throws(() => parseEarnedCsv(csv));
  });
  it('persists CRUD, unique URLs, revisions and request tombstones across reopen and workspace deletion', async () => {
    const f = await fixture(), request = { action: 'create', request_id: 'once', url, title: '최초 제목' };
    await f.command(request); assert.equal((await f.command(request)).reused, true); await assert.rejects(f.create(), /이미 등록/);
    const row = (await f.data()).rows[0]; await f.command({ action: 'update', id: row.id, expected_revision: row.revision, url, title: '수정 제목', notes: '보관 메모' });
    await assert.rejects(f.command({ action: 'delete', id: row.id, expected_revision: row.revision }), EarnedConflictError);
    const reopened = new PersistentHaloXStore(f.file); assert.equal((await reopened.read(db => readEarned(db, f.workspace, OWNER, period))).rows[0].notes, '보관 메모');
    await f.command({ action: 'delete', id: row.id, expected_revision: 2 }); const replay = await f.command(request); assert.equal(replay.reused, true); assert.deepEqual(replay.rows, []); assert.equal((await f.data()).rows.length, 0);
    await assert.rejects(f.command({ ...request, url: 'https://media.example/different' }), EarnedConflictError);
    await f.create(); await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${f.workspace}` }, OWNER));
    assert.equal(await f.store.read(db => db.getServerRecords('earned_requests').some(row => row.workspace_id === f.workspace)), false);
  });
  it('previews all CSV rows, atomically imports once and rejects changed registry or changed CSV without partial writes', async () => {
    const f = await fixture(), csv = 'url,title\nhttps://media.example/first,첫째\nhttps://media.example/second,둘째';
    const preview = await f.command({ action: 'preview', csv }); assert.equal((await f.data()).rows.length, 0);
    await f.create(); await assert.rejects(f.command({ action: 'import', csv, request_id: 'csv', ...preview }), EarnedConflictError); assert.equal((await f.data()).rows.length, 1);
    const refreshed = await f.command({ action: 'preview', csv });
    await assert.rejects(f.command({ action: 'import', csv: csv.replace('첫째', '다른 제목'), request_id: 'csv', ...refreshed }), EarnedConflictError);
    const request = { action: 'import', csv, request_id: 'csv', ...refreshed }; await f.command(request); assert.equal((await f.command(request)).reused, true); assert.equal((await f.data()).rows.length, 3);
    await assert.rejects(f.command({ action: 'import', csv: 'url\nhttps://media.example/new\nhttp://localhost/x', request_id: 'bad' })); assert.equal((await f.data()).rows.length, 3);
    const a = (await f.data()).rows.find(row => row.url.endsWith('/first'))!; await f.command({ action: 'delete', id: a.id, expected_revision: a.revision }); await f.command(request); assert.equal((await f.data()).rows.length, 2);
  });
  it('aggregates exact SERP, AIO and GEO URL evidence once per sample and preserves original provider measurements', async () => {
    const f = await fixture(); await f.create(); const kw = await f.keyword();
    const original = await f.snapshot(kw, { top_results_json: [{ url: url + '#one', rank: 5 }, { url, rank: 2 }, { url: 'https://media.example/other', rank: 1 }], ai_overview_detected: true, ai_overview_json: { cited_domains: ['media.example'], cited_urls: [url, url + '#two'] } });
    await f.snapshot(kw, { captured_at: '2026-10-04T01:00:00Z', top_results_json: [], ai_overview_detected: true, ai_overview_json: { cited_domains: ['media.example'] } });
    await f.snapshot(kw, { captured_at: '2026-10-11T00:00:00Z' });
    const p = await f.insert('geo_prompts', { prompt_text: '추천 문서' }), run = await f.insert('geo_prompt_runs', { prompt_id: p.id, prompt_text: p.prompt_text, language_code: p.language_code, location_code: p.location_code, engine: 'openai', status: 'completed', finished_at: '2026-10-05T00:00:00Z', provider: 'fixture:geo' });
    for (const cited_url of [url, url + '#duplicate', 'https://media.example/other']) await f.insert('geo_citations', { run_id: run.id, cited_url });
    const data = await f.data(), row = data.rows[0]; assert.deepEqual(data.coverage, { serp: 2, aio: 1, geo: 1 }); assert.deepEqual([row.serp_hits, row.aio_hits, row.geo_hits, row.best_rank], [1, 1, 1, 2]); assert.equal(row.evidence_total, 3); assert.equal(row.evidence[0].provider, 'fixture:geo');
    await f.command({ action: 'update', id: row.id, expected_revision: row.revision, url: 'https://media.example/unobserved' }); const changed = (await f.data()).rows[0]; assert.equal(changed.evidence_total, 0); assert.equal(changed.serp_hits, 0);
    assert.deepEqual(await f.store.read(db => db.queryTable('serp_snapshots', { filters: { id: `eq.${original.id}` } }, OWNER).data[0]), original);
    await f.command({ action: 'delete', id: row.id, expected_revision: 2 }); assert.equal(await f.store.read(db => db.queryTable('geo_citations', { filters: { run_id: `eq.${run.id}` } }, OWNER).count), 3);
  });
  it('keeps missing AIO URLs unknown and recomputes after raw source deletion or entity changes', async () => {
    const f = await fixture(); await f.create(); const kw = await f.keyword(), snapshot = await f.snapshot(kw, { ai_overview_detected: true, ai_overview_json: { cited_domains: ['media.example'] } });
    assert.equal((await f.data()).rows[0].aio_hits, null);
    await f.store.write(db => db.deleteTable('serp_snapshots', { id: `eq.${snapshot.id}` }, OWNER)); assert.equal((await f.data()).rows[0].serp_hits, null);
    await f.snapshot(kw); await f.store.write(db => db.updateTable('keywords', { keyword: '변경한 문구' }, { id: `eq.${kw.id}` }, OWNER)); assert.equal((await f.data()).rows[0].evidence_total, 0); assert.equal((await f.data()).excluded_records, 1);
    await assert.rejects(f.data(OWNER, { start: '2026-02-30', end: '2026-10-10' }));
  });
  it('enforces tenant/menu/viewer isolation and blocks direct REST writes and measured evidence leaks', async () => {
    const f = await fixture(); await f.create(); await f.snapshot(await f.keyword()); await assert.rejects(f.data(OTHER)); await assert.rejects(f.create({ workspace_id: 'foreign' }));
    await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: OTHER, role: 'viewer', allowed_sections: ['other'] }, OWNER));
    const hidden = await f.data(OTHER); assert.equal(hidden.editable, false); assert.equal(hidden.can_read_analysis, false); assert.deepEqual(hidden.coverage, { serp: 0, aio: 0, geo: 0 }); assert.equal(hidden.rows[0].serp_hits, null); assert.deepEqual(hidden.rows[0].evidence, []);
    await assert.rejects(f.command({ action: 'create', url: 'https://media.example/b', request_id: 'viewer' }, OTHER));
    await f.store.write(db => db.updateTable('workspace_members', { role: 'member', allowed_sections: ['other'] }, { workspace_id: `eq.${f.workspace}`, user_id: `eq.${OTHER}` }, OWNER));
    await f.command({ action: 'create', url: 'https://media.example/b', request_id: 'member' }, OTHER); assert.equal((await f.data(OTHER)).rows.length, 2);
    await f.store.read(db => { for (const method of ['POST', 'PATCH', 'DELETE'] as const) assert.throws(() => assertRestWrite(db, 'earned_publications', method, OWNER, { workspace_id: f.workspace }, { workspace_id: `eq.${f.workspace}` })); });
  });
  it('accepts explicit AIO URL evidence through raw import and preserves missing-vs-empty semantics', async () => {
    const f = await fixture(), kw = await f.keyword();
    const record = { source_id: 'aio-proof', keyword_id: kw.id, keyword_text: kw.keyword, language: kw.language, country: kw.country, engine: 'google', captured_at: '2026-10-03T01:00:00Z', ai_overview_detected: true, ai_overview: { text: '원본 요약', cited_domains: ['media.example'], cited_urls: [url] } };
    const parse = (item: Row) => f.store.read(db => parseRawImport(db, f.workspace, OWNER, JSON.stringify({ schema_version: 1, kind: 'seo', source: { provider: 'fixture' }, records: [item] }), Date.parse('2026-10-10T00:00:00Z')));
    assert.deepEqual((await parse(record)).records[0].ai_overview_json, record.ai_overview);
    assert.equal('cited_urls' in ((await parse({ ...record, ai_overview: { cited_domains: ['media.example'] } })).records[0].ai_overview_json as Row), false);
    assert.equal('cited_urls' in ((await parse({ ...record, ai_overview: { cited_urls: null } })).records[0].ai_overview_json as Row), false);
    assert.deepEqual(((await parse({ ...record, ai_overview: { cited_urls: [] } })).records[0].ai_overview_json as Row).cited_urls, []);
    await assert.rejects(parse({ ...record, ai_overview: { cited_urls: ['javascript:alert(1)'] } }));
  });
});
