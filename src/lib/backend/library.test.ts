import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { HaloXDatabase, DEFAULT_WORKSPACE_ID as WS, DEFAULT_USER_ID, OTHER_USER_ID } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { prepareLibraryFile } from './library-files.ts';
import { MAX_LIBRARY_FILE_BYTES } from '../api/library.ts';
import { assertRestWrite } from './rest-policy.ts';
import { createDeterministicProviders, type ContentGenerationContext } from './providers.ts';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function fixture(factory = () => new HaloXDatabase()) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-library-')); directories.push(directory);
  return new PersistentHaloXStore(path.join(directory, 'data.sqlite'), factory);
}

describe('persona and knowledge library', () => {
  it('validates fields, enforces one default per workspace and rejects duplicate names and foreign parents', () => {
    const db = new HaloXDatabase();
    const [profile] = db.insertTable('writing_style_profiles', { name: '설명하는 문체', is_default: true, forbidden_terms: ['최고', ' 최고 '] });
    assert.deepEqual(profile.forbidden_terms, ['최고']);
    assert.equal(db.queryTable('writing_style_profiles', { filters: { is_default: 'eq.true' } }).count, 1);
    assert.throws(() => db.insertTable('writing_style_profiles', { name: ' 설명하는 문체 ' }), /같은 이름/);
    assert.throws(() => db.updateTable('writing_style_profiles', { forbidden_terms: ['x'.repeat(101)] }, { id: `eq.${profile.id}` }), /금지어/);
    const [workspace] = db.insertTable('workspaces', { name: '다른 공간' });
    assert.throws(() => db.insertTable('writing_style_samples', { workspace_id: workspace.id, writing_style_profile_id: profile.id, title: '예시', content: '본문' }), /같은 워크스페이스/);
    assert.throws(() => db.insertTable('knowledge_entities', { name: '잘못된 URL', base_url: 'javascript:alert(1)' }), /URL/);
    assert.throws(() => db.insertTable('knowledge_entities', { name: '유형', knowledge_type: 'made-up' }), /유형/);
  });

  it('persists original file bytes privately, rejects forged metadata and cleans up on source/entity/workspace deletion', async () => {
    const store = fixture();
    const [entity] = await store.write(db => db.insertTable('knowledge_entities', { name: '원본 보관' }));
    const bytes = Buffer.from('고객이 제공한 원본\n정확히 보존');
    const source = await store.write(db => db.uploadKnowledgeFile(WS, String(entity.id), '원본 문서', 'source.md', bytes));
    assert.equal(source.content, bytes.toString()); assert.equal(source.base64, undefined);
    assert.deepEqual(await store.read(db => Buffer.from(String(db.readKnowledgeFile(String(source.id))?.base64), 'base64')), bytes);
    assert.throws(() => prepareLibraryFile('../escape.txt', bytes), /파일 이름/);
    assert.throws(() => prepareLibraryFile('payload.html', bytes), /PDF, TXT, MD/);
    assert.throws(() => prepareLibraryFile('fake.pdf', bytes), /올바른 PDF/);
    assert.throws(() => prepareLibraryFile('invalid.txt', Uint8Array.from([0xff, 0xfe])), /UTF-8/);
    assert.throws(() => prepareLibraryFile('big.pdf', new Uint8Array(MAX_LIBRARY_FILE_BYTES + 1)), /5MB/);
    await assert.rejects(store.read(db => db.readKnowledgeFile(String(source.id), OTHER_USER_ID)), /not authorized/);
    await assert.rejects(store.read(db => assertRestWrite(db, 'knowledge_entity_sources', 'POST', DEFAULT_USER_ID, { source_type: 'file' })), /업로드/);
    await assert.rejects(store.read(db => assertRestWrite(db, 'knowledge_entity_sources', 'PATCH', DEFAULT_USER_ID, { base64: 'fake' }, { id: `eq.${source.id}` })), /변경할 수 없는/);
    const [context] = await store.write(db => db.insertTable('evidence_contexts', { knowledge_entity_id: entity.id, source_id: source.id, title: '근거', content: '원문 요약' }));
    await store.write(db => db.deleteTable('knowledge_entity_sources', { id: `eq.${source.id}` }));
    assert.equal(await store.read(db => db.readKnowledgeFile(String(source.id))), null);
    assert.equal(await store.read(db => db.queryTable('evidence_contexts', { filters: { id: `eq.${context.id}` } }).data[0].source_id), null);
    const again = await store.write(db => db.uploadKnowledgeFile(WS, String(entity.id), '', 'source.md', bytes));
    await store.write(db => db.deleteTable('knowledge_entities', { id: `eq.${entity.id}` }));
    assert.equal(await store.read(db => db.readKnowledgeFile(String(again.id))), null);
    assert.equal(await store.read(db => db.queryTable('evidence_contexts').count), 0);
    const [workspace] = await store.write(db => db.insertTable('workspaces', { name: '파일 공간' }));
    const [another] = await store.write(db => db.insertTable('knowledge_entities', { workspace_id: workspace.id, name: '별도 자료' }));
    const file = await store.write(db => db.uploadKnowledgeFile(String(workspace.id), String(another.id), '', 'source.md', bytes));
    await store.write(db => db.deleteTable('workspaces', { id: `eq.${workspace.id}` }));
    assert.equal(await store.read(db => db.readKnowledgeFile(String(file.id))), null);
  });

  it('validates source ownership and keyword links, preserving the transaction on a failed upload', async () => {
    const store = fixture();
    const [one, two] = await store.write(db => db.insertTable('knowledge_entities', [{ name: '자료1' }, { name: '자료2' }]));
    const [source] = await store.write(db => db.insertTable('knowledge_entity_sources', { knowledge_entity_id: one.id, title: '공식 문서', source_type: 'url', url: 'https://example.com/source', content: '출처 요약' }));
    await assert.rejects(store.write(db => db.insertTable('evidence_contexts', { knowledge_entity_id: two.id, source_id: source.id, title: '잘못된 연결', content: '내용' })), /해당 자료/);
    await assert.rejects(store.write(db => db.updateTable('knowledge_entity_sources', { knowledge_entity_id: two.id }, { id: `eq.${source.id}` })), /이동/);
    await store.write(db => {
      const keyword = db.queryTable('keywords').data[0];
      db.insertTable('keyword_knowledge_entities', { knowledge_entity_id: one.id, keyword_id: keyword.id });
      assert.throws(() => db.insertTable('keyword_knowledge_entities', { knowledge_entity_id: one.id, keyword_id: keyword.id }), /이미 연결/);
    });
    const before = await store.read(db => db.exportState());
    await assert.rejects(store.write(db => db.uploadKnowledgeFile(WS, 'missing', '제목', 'file.txt', Buffer.from('본문'))), /같은 워크스페이스/);
    assert.deepEqual(await store.read(db => db.exportState()), before);
    await store.write(db => db.deleteTable('knowledge_entities', { id: `eq.${one.id}` }));
    assert.equal(await store.read(db => db.queryTable('keyword_knowledge_entities').count), 0);
  });

  it('passes the selected persona, samples and sources to generation and preserves snapshots after edits and deletion', async () => {
    let received: ContentGenerationContext | undefined;
    const provider = createDeterministicProviders();
    const store = fixture(() => new HaloXDatabase({ ...provider, generateContentDraft: async (keyword, title, context) => { received = context; return provider.generateContentDraft(keyword, title, context); } }));
    const [profile] = await store.write(db => db.insertTable('writing_style_profiles', { name: '기본 문체', tone: '간결하게', audience: '개발자', is_default: true }));
    await store.write(db => db.insertTable('writing_style_samples', { writing_style_profile_id: profile.id, title: '문체 예시', content: '짧게 설명합니다.' }));
    const [entity] = await store.write(db => db.insertTable('knowledge_entities', { name: '출처 자료', body: '확인된 사용자 입력', description: '자료 요약' }));
    await store.write(db => db.insertTable('knowledge_entity_sources', { knowledge_entity_id: entity.id, title: '원문', source_type: 'url', url: 'https://example.com/research', content: '원문 인용' }));
    const result = await store.write(db => db.invokeEdgeFunction('content-draft', { workspace_id: WS, target_keyword: '콘텐츠 참조', knowledge_entity_ids: [entity.id], idempotency_key: 'library-content-once' }));
    const afterCreate = await store.read(db => db.exportState());
    await assert.rejects(store.write(db => db.invokeEdgeFunction('content-draft', { workspace_id: WS, target_keyword: '다른 제목', idempotency_key: 'library-content-once' })), /이미 사용된/);
    await assert.rejects(store.write(db => { assertRestWrite(db, 'content_jobs', 'PATCH', DEFAULT_USER_ID, { generation_context: {} }, { id: `eq.${(result.job as Record<string, unknown>).id}` }); }), /서버 작업/);
    assert.deepEqual(await store.read(db => db.exportState()), afterCreate);
    assert.equal(received?.persona?.id, profile.id); assert.equal(received?.persona?.samples[0].content, '짧게 설명합니다.');
    assert.equal(received?.knowledge[0].sources[0].content, '원문 인용');
    assert.match(String((result.draft as Record<string, unknown>).content_md), /확인된 사용자 입력/);
    await store.write(db => { db.updateTable('knowledge_entities', { body: '수정된 최신 내용' }, { id: `eq.${entity.id}` }); db.deleteTable('writing_style_profiles', { id: `eq.${profile.id}` }); db.deleteTable('knowledge_entities', { id: `eq.${entity.id}` }); });
    const job = await store.read(db => db.queryTable('content_jobs').data[0]);
    assert.equal(job.writing_style_profile_id, null); assert.deepEqual(job.knowledge_entity_ids, []);
    assert.equal((job.generation_context as ContentGenerationContext).knowledge[0].body, '확인된 사용자 입력');
    assert.equal(await store.read(db => db.queryTable('writing_style_samples').count), 0);
  });

  it('rejects foreign generation references before reserving quota and blocks the quota cache bypass', async () => {
    const store = fixture();
    const [workspace] = await store.write(db => db.insertTable('workspaces', { name: '별도 생성 공간' }));
    const before = await store.read(db => db.exportState());
    for (const payload of [{ writing_style_profile_id: '60000000-0000-4000-8000-000000000001' }, { knowledge_entity_ids: ['61000000-0000-4000-8000-000000000001'] }]) await assert.rejects(store.write(db => db.invokeEdgeFunction('content-draft', { workspace_id: workspace.id, ...payload })), /같은 워크스페이스/);
    for (const rpc_name of ['reserve_unit_with_bypass', 'commit_reservation', 'release_reservation']) await assert.rejects(store.write(db => db.invokeEdgeFunction('rpc-cache', { rpc_name, args: { workspace_id: WS } })), /서버 작업/);
    assert.deepEqual(await store.read(db => db.exportState()), before);
  });
});
