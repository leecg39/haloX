import crypto from 'node:crypto';
import { type HaloXDatabase, type Row } from './database.ts';
import { type PersistentHaloXStore } from './store.ts';
import { assertActiveSession } from './account-session.ts';
import { requireWorkspaceManager, workspaceWhere } from './workspace-management.ts';
import { checkContentRevision } from './content-service.ts';
import { contentText } from './content-model.ts';
import { sealIntegrationSecret, openIntegrationSecret } from './integration-secret.ts';
import { createGoogleClient, googleConfig, googleReady, googleDate, GOOGLE_SCOPES, GOOGLE_TABLES, type GoogleClient, type GoogleConfig, type GoogleTokens } from './google-client.ts';

export type GooglePrivateCollection = 'google_credentials' | 'google_resources' | 'google_oauth_states' | 'google_sync_work' | 'google_sync_requests';
export const googleWhere = (workspace: string, id?: unknown) => ({ ...workspaceWhere(workspace), ...(id ? { id: `eq.${id}` } : {}) });
export function googleManager(db: HaloXDatabase, workspace: string, actor: string) { requireWorkspaceManager(db, workspace, actor); db.assertWorkspaceAccess(workspace, actor, 'analysis', 'write'); }
export function googleConnection(db: HaloXDatabase, workspace: string, actor: string): Row | undefined { return db.queryTable('workspace_google_connections', { filters: googleWhere(workspace) }, actor).data[0]; }
export function googleUpdate(db: HaloXDatabase, row: Row, patch: Row, actor: string) { return db.updateTable('workspace_google_connections', { ...patch, revision: Number(row.revision || 0) + 1 }, googleWhere(String(row.workspace_id), row.id), actor)[0]; }
export function googleJobUpdate(db: HaloXDatabase, row: Row, patch: Row, actor: string) { return db.updateTable('google_sync_jobs', { ...patch, revision: Number(row.revision) + 1 }, googleWhere(String(row.workspace_id), row.id), actor)[0]; }
export function saveGoogleResources(db: HaloXDatabase, row: Row, resources: { sites: { id: string; name: string }[]; properties: { id: string; name: string }[] }) {
  db.setServerRecords('google_resources', [...db.getServerRecords('google_resources').filter(item => item.connection_id !== row.id), { workspace_id: row.workspace_id, connection_id: row.id, resources }]);
}
function googleResources(db: HaloXDatabase, row: Row) { return (db.getServerRecords('google_resources').find(item => item.connection_id === row.id)?.resources || { sites: [], properties: [] }) as { sites: Row[]; properties: Row[] }; }
export function googleView(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'other');
  let editable = true; try { googleManager(db, workspace, actor); } catch { editable = false; }
  const row = googleConnection(db, workspace, actor);
  return { connection: row ? { ...row, resources: editable ? googleResources(db, row) : { sites: [], properties: [] } } as Row : null, jobs: db.queryTable('google_sync_jobs', { filters: googleWhere(workspace), order: 'created_at.desc', limit: 50 }, actor).data, editable, configured: googleReady() };
}
function clearData(db: HaloXDatabase, row: Row, actor: string) { for (const table of GOOGLE_TABLES) db.deleteTable(table, { ...googleWhere(String(row.workspace_id)), connection_id: `eq.${row.id}`, provider: 'eq.google' }, actor); }
function cancelWork(db: HaloXDatabase, workspace: string, actor: string) {
  db.setServerRecords('google_sync_work', db.getServerRecords('google_sync_work').filter(row => row.workspace_id !== workspace));
  for (const job of db.queryTable('google_sync_jobs', { filters: googleWhere(workspace) }, actor).data) if (['queued', 'running'].includes(String(job.status))) googleJobUpdate(db, job, { status: 'cancelled', completed_at: new Date().toISOString() }, actor);
}
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const scope = (row: Row) => `google:${row.workspace_id}:${row.id}`;
export function readGoogleTokens(db: HaloXDatabase, row: Row): GoogleTokens {
  const saved = db.getServerRecords('google_credentials').find(item => item.connection_id === row.id);
  if (!saved) throw new Error('Google 연결을 다시 설정해 주세요.');
  return JSON.parse(openIntegrationSecret(String(saved.ciphertext), scope(row)));
}
export function saveGoogleTokens(db: HaloXDatabase, row: Row, tokens: GoogleTokens) {
  db.setServerRecords('google_credentials', [...db.getServerRecords('google_credentials').filter(item => item.connection_id !== row.id), { workspace_id: row.workspace_id, connection_id: row.id, ciphertext: sealIntegrationSecret(JSON.stringify(tokens), scope(row)) }]);
}
export async function googleAccess(store: PersistentHaloXStore, saved: Row, actor: string, client: GoogleClient) {
  const tokens = await store.read(db => { googleManager(db, String(saved.workspace_id), actor); const current = googleConnection(db, String(saved.workspace_id), actor); if (!current || current.id !== saved.id || current.status !== 'connected') throw new Error('Google 연결이 변경되었습니다.'); checkContentRevision(current, saved.revision); return readGoogleTokens(db, current); });
  if (tokens.expires_at > Date.now() + 60000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('Google 연결을 다시 설정해 주세요.');
  const updated = await client.refresh(tokens.refresh_token, googleConfig());
  await store.write(db => { googleManager(db, String(saved.workspace_id), actor); const current = googleConnection(db, String(saved.workspace_id), actor); if (!current || current.id !== saved.id || current.status !== 'connected') throw new Error('Google 연결이 변경되었습니다.'); checkContentRevision(current, saved.revision); saveGoogleTokens(db, current, { ...tokens, ...updated }); });
  return updated.access_token;
}
export async function startGoogleOAuth(store: PersistentHaloXStore, workspace: string, actor: string, session: string, config: GoogleConfig = googleConfig()) {
  const state = crypto.randomBytes(32).toString('base64url');
  await store.write(db => {
    assertActiveSession(db, actor, session); googleManager(db, workspace, actor);
    const current = googleConnection(db, workspace, actor); if (current && current.status !== 'disconnected') throw new Error('현재 연결을 먼저 해제하거나 연결 시도를 취소해 주세요.');
    if (current) clearData(db, current, actor);
    // Fail before redirect if server-side token encryption is not configured.
    sealIntegrationSecret('configuration-check', 'google-config');
    const values = { status: 'authorizing', name: 'Google 통합 계정', email: '', connected_by: actor, auto_sync: false, gsc_site_url: '', ga4_property_id: '', resources: { sites: [], properties: [] }, error: '', last_synced_at: null, next_sync_at: null };
    const row = current ? googleUpdate(db, current, values, actor) : db.insertTable('workspace_google_connections', { ...values, id: crypto.randomUUID(), workspace_id: workspace, revision: 1, provider: 'google' }, actor)[0];
    db.setServerRecords('google_oauth_states', [...db.getServerRecords('google_oauth_states').filter(item => Number(item.expires_at) > Date.now() && item.workspace_id !== workspace), { hash: digest(state), workspace_id: workspace, actor_id: actor, session_id: session, connection_id: row.id, revision: row.revision, expires_at: Date.now() + 600000 }]);
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state })}` };
}
export async function finishGoogleOAuth(store: PersistentHaloXStore, actor: string, session: string, state: string, code: string, denied: boolean, client = createGoogleClient(), config: GoogleConfig = googleConfig()) {
  if (!/^[\w-]{43}$/.test(state)) throw new Error('Google 연결 요청이 올바르지 않습니다.');
  const saved = await store.write(db => {
    assertActiveSession(db, actor, session); const states = db.getServerRecords('google_oauth_states'), item = states.find(row => row.hash === digest(state));
    if (!item || item.actor_id !== actor || item.session_id !== session || Number(item.expires_at) <= Date.now()) throw new Error('Google 연결 요청이 만료되었거나 다른 세션에서 시작되었습니다.');
    googleManager(db, String(item.workspace_id), actor); const row = googleConnection(db, String(item.workspace_id), actor);
    if (!row || row.id !== item.connection_id || row.status !== 'authorizing') throw new Error('Google 연결 요청이 취소되었습니다.'); checkContentRevision(row, item.revision);
    db.setServerRecords('google_oauth_states', states.filter(value => value !== item)); return row;
  });
  try {
    if (denied || !code || code.length > 4096) throw new Error('Google 연결 동의가 완료되지 않았습니다.');
    const tokens = await client.exchange(code, config);
    if (!tokens.refresh_token || !GOOGLE_SCOPES.slice(2).every(value => tokens.scope?.split(' ').includes(value))) throw new Error('Search Console·Analytics 읽기 권한을 모두 허용해 주세요.');
    const identity = await client.identity(tokens.access_token);
    await store.write(db => {
      assertActiveSession(db, actor, session); googleManager(db, String(saved.workspace_id), actor); const row = googleConnection(db, String(saved.workspace_id), actor);
      if (!row || row.id !== saved.id || row.status !== 'authorizing') throw new Error('Google 연결 요청이 취소되었습니다.'); checkContentRevision(row, saved.revision);
      saveGoogleTokens(db, row, tokens); googleUpdate(db, row, { status: 'connected', email: identity.email, google_subject: identity.sub, error: '', connected_at: new Date().toISOString() }, actor);
    });
    return { workspace_id: String(saved.workspace_id), ok: true };
  } catch (error) {
    await store.write(db => {
      try { googleManager(db, String(saved.workspace_id), actor); } catch { return; }
      const current = googleConnection(db, String(saved.workspace_id), actor);
      if (current && current.id === saved.id && current.revision === saved.revision && current.status === 'authorizing') googleUpdate(db, current, { status: 'disconnected', error: error instanceof Error ? error.message : 'Google 연결 실패' }, actor);
    });
    throw error;
  }
}
export function googleRange(start: unknown, end: unknown, now = Date.now()) {
  const from = googleDate(start), to = googleDate(end);
  if (from > to || Date.parse(to) - Date.parse(from) >= 31 * 86400000 || to >= new Date(now).toISOString().slice(0, 10)) throw new Error('오늘 이전 날짜로 최대 31일을 선택해 주세요.');
  return { start: from, end: to };
}
export function enqueueGoogleSync(db: HaloXDatabase, workspace: string, actor: string, input: Row) {
  googleManager(db, workspace, actor); const row = googleConnection(db, workspace, actor);
  if (!row || row.status !== 'connected' || !row.gsc_site_url && !row.ga4_property_id) throw new Error('Google 연결과 수집 대상을 먼저 설정해 주세요.');
  checkContentRevision(row, input.expected_revision);
  const range = googleRange(input.start, input.end), key = contentText(input.request_id, '요청 키', 100, true);
  if (!/^[\w-]{16,100}$/.test(key)) throw new Error('요청 키를 확인해 주세요.');
  const fingerprint = digest(JSON.stringify([row.id, row.gsc_site_url, row.ga4_property_id, range]));
  const requests = db.getServerRecords('google_sync_requests'), old = requests.find(item => item.workspace_id === workspace && item.actor_id === actor && item.key === key);
  if (old) { if (old.fingerprint !== fingerprint) throw new Error('다른 수집 요청에 같은 요청 키를 사용할 수 없습니다.'); return { job_id: old.job_id, reused: true }; }
  if (db.getServerRecords('google_sync_work').some(item => item.workspace_id === workspace)) throw new Error('진행 중인 Google 동기화를 먼저 완료하거나 취소해 주세요.');
  const job = db.insertTable('google_sync_jobs', { workspace_id: workspace, connection_id: row.id, status: 'queued', revision: 1, ...range, gsc_site_url: row.gsc_site_url, ga4_property_id: row.ga4_property_id, notes: '', error: '', rows: 0, created_by: actor }, actor)[0];
  db.setServerRecords('google_sync_work', [...db.getServerRecords('google_sync_work'), { workspace_id: workspace, job_id: job.id, actor_id: actor, connection_revision: row.revision, tables: GOOGLE_TABLES.filter(table => table === 'ga4_page_stats' ? !!row.ga4_property_id : !!row.gsc_site_url), cursor: 0, offset: 0, staged: {}, metadata: {}, lease_until: 0, attempts: 0 }]);
  db.setServerRecords('google_sync_requests', [...requests, { workspace_id: workspace, actor_id: actor, key, fingerprint, job_id: job.id }]);
  return { job_id: job.id, reused: false };
}
export async function googleCommand(store: PersistentHaloXStore, actor: string, input: Row, client = createGoogleClient()) {
  const workspace = contentText(input.workspace_id, '워크스페이스', 100, true), action = String(input.action);
  if (action === 'discover') {
    const saved = await store.read(db => { googleManager(db, workspace, actor); const row = googleConnection(db, workspace, actor); if (!row || row.status !== 'connected') throw new Error('Google 계정을 먼저 연결해 주세요.'); checkContentRevision(row, input.expected_revision); return row; });
    const resources = await client.resources(await googleAccess(store, saved, actor, client));
    return store.write(db => { googleManager(db, workspace, actor); const row = googleConnection(db, workspace, actor); if (!row || row.id !== saved.id) throw new Error('연결이 변경되었습니다.'); checkContentRevision(row, saved.revision); saveGoogleResources(db, row, resources); googleUpdate(db, row, { resources_checked_at: new Date().toISOString() }, actor); return googleView(db, workspace, actor); });
  }
  return store.write(db => {
    googleManager(db, workspace, actor); const row = googleConnection(db, workspace, actor);
    if (!row) throw new Error('Google 연결을 찾을 수 없습니다.');
    if (action === 'sync') { const result = enqueueGoogleSync(db, workspace, actor, input); return { ...googleView(db, workspace, actor), ...result }; }
    if (['job-update', 'job-delete', 'job-cancel'].includes(action)) {
      const job = db.queryTable('google_sync_jobs', { filters: googleWhere(workspace, input.job_id) }, actor).data[0]; if (!job) throw new Error('동기화 이력을 찾을 수 없습니다.'); checkContentRevision(job, input.expected_revision);
      const active = ['queued', 'running'].includes(String(job.status));
      if (action === 'job-cancel') { if (!active) throw new Error('진행 중인 작업만 취소할 수 있습니다.'); db.setServerRecords('google_sync_work', db.getServerRecords('google_sync_work').filter(item => item.job_id !== job.id)); googleJobUpdate(db, job, { status: 'cancelled', completed_at: new Date().toISOString() }, actor); }
      else if (active) throw new Error('작업이 끝난 뒤 이력을 변경해 주세요.');
      else if (action === 'job-delete') db.deleteTable('google_sync_jobs', googleWhere(workspace, job.id), actor);
      else googleJobUpdate(db, job, { notes: contentText(input.notes, '메모', 2000) }, actor);
    } else {
      checkContentRevision(row, input.expected_revision);
      if (action === 'disconnect') {
        cancelWork(db, workspace, actor); clearData(db, row, actor);
        for (const collection of ['google_credentials', 'google_resources', 'google_oauth_states'] as const) db.setServerRecords(collection, db.getServerRecords(collection).filter(item => item.workspace_id !== workspace));
        googleUpdate(db, row, { status: 'disconnected', auto_sync: false, next_sync_at: null, gsc_site_url: '', ga4_property_id: '', email: '', google_subject: '', resources: { sites: [], properties: [] }, error: '', last_synced_at: null }, actor);
      } else if (action === 'settings') {
        if (row.status !== 'connected') throw new Error('Google 계정을 먼저 연결해 주세요.');
        const resources = googleResources(db, row), site = contentText(input.gsc_site_url, '사이트', 2048), property = contentText(input.ga4_property_id, '속성', 100);
        if (site && !resources.sites.some(item => item.id === site) || property && !resources.properties.some(item => item.id === property)) throw new Error('접근 가능한 Google 사이트·속성만 선택해 주세요.');
        if (typeof input.auto_sync !== 'boolean' || input.auto_sync && !site && !property) throw new Error('자동 동기화할 대상을 선택해 주세요.');
        const changed = site !== row.gsc_site_url || property !== row.ga4_property_id;
        if (changed && (row.gsc_site_url || row.ga4_property_id) && input.confirm_replace !== true) throw new Error('대상 변경 시 이전 Google 수집값 삭제에 동의해 주세요.');
        cancelWork(db, workspace, actor); if (changed) clearData(db, row, actor);
        googleUpdate(db, row, { name: contentText(input.name, '연결 이름', 100, true), gsc_site_url: site, ga4_property_id: property, auto_sync: input.auto_sync, sync_actor: actor, next_sync_at: input.auto_sync ? Date.now() : null, ...(changed ? { last_synced_at: null } : {}) }, actor);
      } else throw new Error('지원하지 않는 Google 작업입니다.');
    }
    return googleView(db, workspace, actor);
  });
}
