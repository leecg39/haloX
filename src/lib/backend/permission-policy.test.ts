import { it } from 'node:test';
import assert from 'node:assert/strict';
import { HaloXDatabase, DEFAULT_USER_ID as OWNER, OTHER_USER_ID as USER, ADMIN_USER_ID as ADMIN, DEFAULT_WORKSPACE_ID as WS, RlsAccessDeniedError, type Row } from './database.ts';
import { runWorkspaceCommand } from './workspace-management.ts';
import { assertRestWrite } from './rest-policy.ts';
import { canAccess, normalizeSections, routeSection, SECTIONS } from '../permissions/workspace.ts';
import { tableSection } from './permission-policy.ts';
import { readExportFile } from './export-service.ts';
import { reportDownload } from './report-service.ts';
const membership = (db: HaloXDatabase, role = 'member', allowed_sections = ['all']) => db.insertTable('workspace_members', { workspace_id: WS, user_id: USER, role, allowed_sections }, OWNER)[0];
const change = (db: HaloXDatabase, row: Row, role: string, sections: string[]) => db.updateTable('workspace_members', { role, allowed_sections: sections }, { id: `eq.${row.id}` }, OWNER);

it('defines all persisted tables, rejects unknown sections and preserves legacy membership scope', () => {
  const db = new HaloXDatabase();
  for (const table of Object.keys(db.exportState().tables)) assert.doesNotThrow(() => tableSection(table));
  for (const value of [['__proto__'], ['toString'], ['analysis', 'analysis'], ['all', 'analysis'], 'all', null]) assert.throws(() => normalizeSections(value));
  assert.deepEqual(normalizeSections(undefined), ['all']); assert.deepEqual(normalizeSections(Object.keys(SECTIONS)), ['all']);
  assert.equal(routeSection('/app/geo/prompts/123'), 'analysis'); assert.equal(routeSection('/app/settings?tab=profile'), undefined);
});
it('applies the role/section matrix to reads, ID-only writes and function execution', async () => {
  const db = new HaloXDatabase(), member = membership(db, 'viewer'), keyword = db.queryTable('keywords', {}, OWNER).data[0];
  assert.ok(db.queryTable('keywords', {}, USER).data.length);
  for (const operation of [() => db.insertTable('keyword_sets', { name: 'no', workspace_id: WS }, USER), () => db.updateTable('keywords', { is_active: false }, { id: `eq.${keyword.id}` }, USER), () => db.deleteTable('keywords', { id: `eq.${keyword.id}` }, USER), () => assertRestWrite(db, 'workspaces', 'PATCH', USER, { name: 'no' }, { id: `eq.${WS}` })]) assert.throws(operation, RlsAccessDeniedError);
  for (const name of ['keywords-collect', 'geo-run', 'site-audit', 'content-draft', 'monitor-rule-check', 'raw-import-create', 'workspace-invite']) await assert.rejects(db.invokeEdgeFunction(name, { workspace_id: WS }, USER), RlsAccessDeniedError);
  change(db, member, 'member', ['analysis']);
  db.insertTable('keyword_sets', { workspace_id: WS, name: '허용된 분석' }, USER);
  assert.throws(() => db.insertTable('writing_style_profiles', { workspace_id: WS, name: '우회' }, USER), RlsAccessDeniedError);
  const job = (await db.invokeEdgeFunction('content-create', { workspace_id: WS, title: '제한된 콘텐츠', target_keyword: '범위', content_md: '본문' }, OWNER)).job as Row;
  assert.throws(() => db.updateTable('content_jobs', { title: '우회' }, { id: `eq.${job.id}` }, USER), RlsAccessDeniedError);
  assert.throws(() => db.deleteTable('content_jobs', { id: `eq.${job.id}` }, USER), RlsAccessDeniedError);
  await assert.rejects(db.invokeEdgeFunction('content-draft', { workspace_id: WS }, USER), RlsAccessDeniedError);
  assert.deepEqual(db.queryTable('content_jobs', { filters: { workspace_id: `eq.${WS}` } }, USER), { data: [], count: 0 });
  change(db, member, 'viewer', ['dashboard']);
  const restored = new HaloXDatabase(); restored.restoreState(db.exportState());
  assert.deepEqual(restored.workspacePermissions(WS, USER), db.workspacePermissions(WS, USER));
  assert.equal(db.workspacePermissions(WS, USER).role, 'viewer');
  assert.equal(canAccess(db.workspacePermissions(WS, USER), 'analysis'), false);
});
it('filters restricted sources from RPC results and never turns authorization errors into rpc-cache success', async () => {
  const db = new HaloXDatabase(); membership(db, 'member', ['dashboard']);
  assert.equal(db.queryTable('keywords', { headOnly: true, filters: { workspace_id: `eq.${WS}` } }, USER).count, 0);
  assert.equal(db.queryTable('workspace_members', {}, USER).data.some(row => row.user_id !== USER && row.workspace_id === WS), false);
  assert.throws(() => db.callRpc('get_keywords_with_gsc_stats', { p_workspace_id: WS }, USER), RlsAccessDeniedError);
  await assert.rejects(db.invokeEdgeFunction('rpc-cache', { rpc_name: 'get_keywords_with_gsc_stats', args: { p_workspace_id: WS } }, USER), RlsAccessDeniedError);
  assert.doesNotThrow(() => db.callRpc('get_app_shell', { p_workspace_id: WS }, USER));
  const result = db.callRpc('get_light_dashboard_overview', { p_workspace_id: WS }, USER);
  const keyword = db.queryTable('keywords', {}, OWNER).data[0]; assert.ok(!JSON.stringify(result).includes(String(keyword.keyword)));
});
it('invitation scope is inherited, changed links are invalidated and an existing session sees new permissions', () => {
  const db = new HaloXDatabase();
  const first = runWorkspaceCommand(db, OWNER, { action: 'invite-create', workspace_id: WS, email: 'other@halox.local', role: 'viewer', allowed_sections: ['analysis'] });
  const revised = runWorkspaceCommand(db, OWNER, { action: 'invite-update', workspace_id: WS, invitation_id: (first.invitation as Row).id, expected_revision: 1, role: 'viewer', allowed_sections: ['monitoring'] });
  assert.throws(() => runWorkspaceCommand(db, USER, { action: 'invite-accept', token: first.token }));
  runWorkspaceCommand(db, USER, { action: 'invite-accept', token: revised.token });
  assert.deepEqual(db.workspacePermissions(WS, USER), { role: 'viewer', allowed_sections: ['monitoring'] });
  const member = db.queryTable('workspace_members', { filters: { user_id: `eq.${USER}`, workspace_id: `eq.${WS}` } }, OWNER).data[0];
  runWorkspaceCommand(db, OWNER, { action: 'member-update', workspace_id: WS, member_id: member.id, expected_revision: 1, role: 'member', allowed_sections: ['analysis'] });
  db.assertWorkspaceAccess(WS, USER, 'analysis', 'write'); assert.throws(() => db.assertWorkspaceAccess(WS, USER, 'monitoring'), RlsAccessDeniedError);
});
it('restricted administrators cannot grant, manage or mint credentials beyond their scope via either API', () => {
  const db = new HaloXDatabase(), admin = db.queryTable('workspace_members', { filters: { user_id: `eq.${ADMIN}`, workspace_id: `eq.${WS}` } }, OWNER).data[0];
  change(db, admin, 'admin', ['other', 'analysis']); const member = membership(db);
  for (const action of ['member-update', 'member-delete']) assert.throws(() => runWorkspaceCommand(db, ADMIN, { action, workspace_id: WS, member_id: member.id, expected_revision: 0, role: 'viewer', allowed_sections: ['analysis'] }), RlsAccessDeniedError);
  assert.throws(() => runWorkspaceCommand(db, ADMIN, { action: 'invite-create', workspace_id: WS, email: 'scope@example.test', role: 'viewer', allowed_sections: ['execution'] }), RlsAccessDeniedError);
  assert.throws(() => assertRestWrite(db, 'workspace_members', 'PATCH', ADMIN, { allowed_sections: ['all'] }, { id: `eq.${member.id}` }), RlsAccessDeniedError);
  assert.throws(() => assertRestWrite(db, 'workspace_api_keys', 'POST', ADMIN, { workspace_id: WS, name: 'escape' }), RlsAccessDeniedError);
  assert.doesNotThrow(() => runWorkspaceCommand(db, ADMIN, { action: 'invite-create', workspace_id: WS, email: 'scope@example.test', role: 'viewer', allowed_sections: ['analysis'] }));
});
it('viewer downloads and API-key RPC writes are denied while own profile edits remain independent', () => {
  const db = new HaloXDatabase(); membership(db, 'viewer');
  const entity = db.insertTable('knowledge_entities', { workspace_id: WS, name: '문서', entity_type: 'document' }, OWNER)[0];
  const file = db.uploadKnowledgeFile(WS, String(entity.id), '원본', 'original.txt', Buffer.from('private'), OWNER);
  assert.throws(() => db.readKnowledgeFile(String(file.id), USER), RlsAccessDeniedError);
  const exported = db.insertTable('export_history', { workspace_id: WS }, OWNER)[0], report = db.insertTable('report_snapshots', { workspace_id: WS }, OWNER)[0];
  assert.throws(() => readExportFile(db, String(exported.id), USER), RlsAccessDeniedError);
  assert.throws(() => reportDownload(db, String(report.id), USER, 'json'), RlsAccessDeniedError);
  const key = db.insertTable('workspace_api_keys', { workspace_id: WS, name: 'owner key' }, OWNER)[0];
  assert.throws(() => db.callRpc('revoke_workspace_api_key', { p_workspace_id: WS, p_key_id: key.id }, USER), RlsAccessDeniedError);
  assertRestWrite(db, 'profiles', 'PATCH', USER, { full_name: '내 프로필' }, { id: `eq.${USER}` });
  db.updateTable('profiles', { full_name: '내 프로필' }, { id: `eq.${USER}` }, USER);
  assert.equal(db.queryTable('profiles', {}, USER).data[0].full_name, '내 프로필');
});

it('previously issued API keys stop authenticating when the issuer loses authority', () => {
  const db = new HaloXDatabase(), member = db.queryTable('workspace_members', { filters: { workspace_id: `eq.${WS}`, user_id: `eq.${ADMIN}` } }, OWNER).data[0];
  const key = db.insertTable('workspace_api_keys', { workspace_id: WS, name: 'issuer key' }, ADMIN)[0];
  assert.ok(db.verifyWorkspaceApiKey(String(key.raw_key)));
  change(db, member, 'admin', ['other']); assert.equal(db.verifyWorkspaceApiKey(String(key.raw_key)), null);
  change(db, member, 'viewer', ['all']); assert.equal(db.verifyWorkspaceApiKey(String(key.raw_key)), null);
});

it('ID-only REST cannot mutate hidden member metadata after its preflight returns no rows', () => {
  const db = new HaloXDatabase(); membership(db, 'member', ['analysis']);
  const target = db.queryTable('workspace_members', { filters: { workspace_id: `eq.${WS}`, user_id: `eq.${ADMIN}` } }, OWNER).data[0];
  const filter = { id: `eq.${target.id}` };
  assert.deepEqual(db.queryTable('workspace_members', { filters: filter }, USER).data, []);
  assert.throws(() => { assertRestWrite(db, 'workspace_members', 'PATCH', USER, { role: 'member' }, filter); db.updateTable('workspace_members', { role: 'member' }, filter, USER); }, RlsAccessDeniedError);
  assert.throws(() => { assertRestWrite(db, 'workspace_members', 'DELETE', USER, undefined, filter); db.deleteTable('workspace_members', filter, USER); }, RlsAccessDeniedError);
});
