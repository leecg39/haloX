import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HaloXDatabase, DEFAULT_USER_ID as OWNER, OTHER_USER_ID as OTHER, DEFAULT_WORKSPACE_ID as WS, type Row } from './database.ts';
import { readTagSettings, runTagCommand, TagConflictError } from './tag-settings.ts';
import { PersistentHaloXStore } from './store.ts';
import { assertRestWrite } from './rest-policy.ts';
const run = (db: HaloXDatabase, action: string, values: Row = {}, actor = OWNER) => runTagCommand(db, actor, { action, workspace_id: WS, ...values });
const read = (db: HaloXDatabase, actor = OWNER) => readTagSettings(db, WS, actor);
const create = (db: HaloXDatabase, name = '브랜드') => run(db, 'tag-create', { name, color: '#7357aa' }).row as Row;
const tag = (db: HaloXDatabase, id: unknown) => read(db).tags.find(item => (item as Row).id === id)! as Row;
const assignment = (db: HaloXDatabase, id: unknown, keywordIds: unknown[], promptIds: unknown[]) => {
  const row = tag(db, id); return run(db, 'tag-assign', { id, expected_revision: row.revision, links_stamp: row.links_stamp, keyword_ids: keywordIds, prompt_ids: promptIds });
};

describe('shared tag settings', () => {
  it('shares normalized tag/group CRUD and revisions with REST and detaches groups without removing tags', () => {
    const db = new HaloXDatabase(), group = run(db, 'group-create', { name: ' 브랜드 ' }).row as Row;
    const first = run(db, 'tag-create', { name: '핵심', group_id: group.id }).row as Row;
    assert.equal(first.revision, 1); assert.equal((read(db).groups[0] as Row).name, '브랜드');
    run(db, 'tag-update', { id: first.id, expected_revision: 1, name: '수정', color: '#112233' });
    assert.equal(db.queryTable('workspace_tags').data[0].name, '수정');
    assertRestWrite(db, 'workspace_tags', 'PATCH', OWNER, { name: 'REST 변경' }, { id: `eq.${first.id}` });
    db.updateTable('workspace_tags', { name: 'REST 변경' }, { id: `eq.${first.id}` });
    assert.throws(() => run(db, 'tag-update', { id: first.id, expected_revision: 2, name: '유실' }), TagConflictError);
    const groupView = read(db).groups[0] as Row, before = tag(db, first.id);
    run(db, 'group-delete', { id: group.id, expected_revision: 1, contents_stamp: groupView.contents_stamp });
    const detached = tag(db, first.id); assert.equal(detached.group_id, null); assert.equal(detached.revision, 4); assert.notEqual(detached.updated_at, before.updated_at);
    assert.throws(() => run(db, 'tag-update', { id: first.id, expected_revision: 3, group_id: group.id }), TagConflictError);
    assert.equal(read(db).groups.length, 0); assert.equal(read(db).tags.length, 1);
  });
  it('rejects malformed, duplicate, cross-workspace and missing records', () => {
    const db = new HaloXDatabase(), foreign = db.insertTable('workspaces', { name: '다른 공간' })[0];
    const foreignGroup = db.insertTable('workspace_tag_groups', { workspace_id: foreign.id, name: '외부 그룹' })[0];
    create(db, 'ＡＢＣ');
    for (const name of ['', ' ', 'abc', 'a'.repeat(61), 42]) assert.throws(() => run(db, 'tag-create', { name }));
    assert.throws(() => run(db, 'tag-create', { name: 'X', color: 'red' }));
    assert.throws(() => run(db, 'tag-create', { name: 'X', group_id: foreignGroup.id }), /같은 워크스페이스/);
    assert.throws(() => run(db, 'group-update', { id: foreignGroup.id, expected_revision: 1, name: '불가' }), /현재 워크스페이스/);
    assert.throws(() => run(db, 'group-delete', { id: 'missing', expected_revision: 0 }), /현재 워크스페이스/);
    assert.throws(() => run(db, 'drop-all')); assert.throws(() => read(db, OTHER));
  });
  it('assigns both entity types, preserves other tags and supports exact unlinking and deletion', () => {
    const db = new HaloXDatabase(), first = create(db), other = create(db, '다른 태그');
    const keyword = db.queryTable('keywords').data[0], prompt = db.queryTable('geo_prompts').data[0];
    assignment(db, other.id, [keyword.id], [prompt.id]); assignment(db, first.id, [keyword.id], [prompt.id]);
    const view = tag(db, first.id); assert.equal(view.keyword_count, 1); assert.equal(view.prompt_count, 1);
    assert.deepEqual(view.keyword_ids, [keyword.id]); assert.deepEqual(view.prompt_ids, [prompt.id]);
    const snapshot = db.exportState(); assignment(db, first.id, [keyword.id], [prompt.id]); assert.deepEqual(db.exportState(), snapshot); // No-op retries do not churn relation IDs/timestamps.
    assignment(db, first.id, [], [prompt.id]); assert.equal(tag(db, first.id).keyword_count, 0); assert.equal(tag(db, other.id).keyword_count, 1);
    const beforeDelete = tag(db, first.id);
    run(db, 'tag-delete', { id: first.id, expected_revision: beforeDelete.revision, links_stamp: beforeDelete.links_stamp });
    assert.ok(db.queryTable('geo_prompts').data.some(row => row.id === prompt.id)); assert.ok(db.queryTable('keywords').data.some(row => row.id === keyword.id));
    assert.equal(db.queryTable('geo_prompt_tag_assignments', { filters: { tag_id: `eq.${first.id}` } }).count, 0);
    assert.equal(tag(db, other.id).prompt_count, 1);
  });
  it('detects relation and group-content changes from other screens including ABA edits', () => {
    const db = new HaloXDatabase(), group = run(db, 'group-create', { name: 'G' }).row as Row;
    const initialGroup = read(db).groups[0] as Row, first = create(db), keyword = db.queryTable('keywords').data[0], before = tag(db, first.id);
    const relation = db.insertTable('keyword_tag_assignments', { tag_id: first.id, keyword_id: keyword.id })[0];
    for (const action of ['tag-assign', 'tag-delete']) assert.throws(() => run(db, action, { id: first.id, expected_revision: 1, links_stamp: before.links_stamp, keyword_ids: [], prompt_ids: [] }), TagConflictError);
    const linked = tag(db, first.id); db.deleteTable('keyword_tag_assignments', { id: `eq.${relation.id}` }); db.insertTable('keyword_tag_assignments', { tag_id: first.id, keyword_id: keyword.id });
    assert.throws(() => run(db, 'tag-assign', { id: first.id, expected_revision: 1, links_stamp: linked.links_stamp, keyword_ids: [], prompt_ids: [] }), TagConflictError);
    db.updateTable('workspace_tags', { group_id: group.id }, { id: `eq.${first.id}` });
    assert.throws(() => run(db, 'group-delete', { id: group.id, expected_revision: 1, contents_stamp: initialGroup.contents_stamp }), TagConflictError);
    assert.equal(read(db).groups.length, 1);
  });
  it('invalidates stale keyword and prompt edit forms when tag assignments change in settings or REST', async () => {
    const db = new HaloXDatabase(), first = create(db), keyword = db.queryTable('keywords').data[0], prompt = db.queryTable('geo_prompts').data[0];
    assignment(db, first.id, [keyword.id], [prompt.id]);
    await assert.rejects(db.invokeEdgeFunction('keywords-save', { workspace_id: WS, keyword_id: keyword.id, updated_at: keyword.updated_at, patch: {}, tag_ids: [] }), /다른 곳/);
    await assert.rejects(db.invokeEdgeFunction('geo-save', { workspace_id: WS, prompt_id: prompt.id, updated_at: prompt.updated_at, patch: {}, tag_ids: [] }), /다른 곳/);
    const current = db.queryTable('keywords', { filters: { id: `eq.${keyword.id}` } }).data[0];
    const result = await db.invokeEdgeFunction('keywords-save', { workspace_id: WS, keyword_id: keyword.id, updated_at: current.updated_at, patch: {}, tag_ids: [first.id] });
    assert.equal((result.keyword as Row).updated_at, db.queryTable('keywords', { filters: { id: `eq.${keyword.id}` } }).data[0].updated_at);
    const before = db.queryTable('geo_prompts', { filters: { id: `eq.${prompt.id}` } }).data[0];
    run(db, 'tag-delete', { id: first.id, expected_revision: 1, links_stamp: tag(db, first.id).links_stamp });
    assert.notEqual(db.queryTable('geo_prompts', { filters: { id: `eq.${prompt.id}` } }).data[0].updated_at, before.updated_at);
  });
  it('respects viewer, menu scope, deletion cascade and tenant boundaries without leaking counts', () => {
    const db = new HaloXDatabase(), first = create(db), keyword = db.queryTable('keywords').data[0];
    assignment(db, first.id, [keyword.id], []);
    const member = db.insertTable('workspace_members', { workspace_id: WS, user_id: OTHER, role: 'viewer', allowed_sections: ['other', 'analysis'] })[0];
    assert.equal(read(db, OTHER).editable, false); assert.equal(read(db, OTHER).tags[0].keyword_count, 1);
    assert.throws(() => run(db, 'tag-create', { name: '불가' }, OTHER));
    db.updateTable('workspace_members', { role: 'member', allowed_sections: ['other'] }, { id: `eq.${member.id}` });
    const restricted = read(db, OTHER); assert.equal(restricted.tags[0].keyword_count, null); assert.deepEqual(restricted.keywords, []); assert.deepEqual(restricted.tags[0].keyword_ids, []); assert.equal(restricted.tags[0].links_stamp, null);
    run(db, 'tag-update', { id: first.id, expected_revision: 1, name: '분류명 수정' }, OTHER);
    assert.throws(() => assignment(db, first.id, ['foreign'], []));
    assert.throws(() => run(db, 'tag-delete', { id: first.id, expected_revision: 2, links_stamp: tag(db, first.id).links_stamp }, OTHER));
    assert.throws(() => db.deleteTable('workspace_tags', { id: `eq.${first.id}` }, OTHER));
    db.updateTable('workspace_members', { allowed_sections: ['analysis'] }, { id: `eq.${member.id}` }); assert.throws(() => read(db, OTHER));
  });
  it('validates every selection before mutation, rolls back errors, persists and serializes competing updates', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'halox-tags-')), filename = path.join(directory, 'test.sqlite');
    try {
      const store = new PersistentHaloXStore(filename), first = await store.write(db => create(db));
      const keyword = await store.read(db => db.queryTable('keywords').data[0]);
      const foreign = await store.write(db => { const ws = db.insertTable('workspaces', { name: '다른 공간' })[0]; return db.insertTable('geo_prompts', { workspace_id: ws.id, prompt_text: '외부 질문' })[0]; });
      const initial = await store.read(db => db.exportState());
      await assert.rejects(store.write(db => assignment(db, first.id, [keyword.id], [foreign.id])));
      await assert.rejects(store.write(db => assignment(db, first.id, [keyword.id, keyword.id], [])));
      await assert.rejects(store.write(db => assignment(db, first.id, new Array(2001).fill(keyword.id), [])));
      assert.deepEqual(await store.read(db => db.exportState()), initial);
      const reopened = new PersistentHaloXStore(filename);
      const outcomes = await Promise.allSettled([store, reopened].map((item, index) => item.write(db => run(db, 'tag-update', { id: first.id, expected_revision: 1, name: `동시 수정 ${index}` }))));
      assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
      await store.write(db => assignment(db, first.id, [keyword.id], [])); assert.equal((await reopened.read(db => tag(db, first.id))).keyword_count, 1);
      await store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }));
      assert.equal(await reopened.read(db => db.queryTable('workspace_tags').count), 0);
      assert.equal(await reopened.read(db => db.queryTable('keyword_tag_assignments').count), 0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
