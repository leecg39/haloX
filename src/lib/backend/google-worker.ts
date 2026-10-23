import crypto from 'node:crypto';
import { haloxStore, type PersistentHaloXStore } from './store.ts';
import { type HaloXDatabase, type Row } from './database.ts';
import { createGoogleClient, type GoogleClient, type GoogleTable } from './google-client.ts';
import { enqueueGoogleSync, googleAccess, googleConnection, googleJobUpdate, googleManager, googleUpdate, googleWhere } from './google-service.ts';
import { ExternalServiceError } from './public-json.ts';
type Work = Row & { job_id: string; workspace_id: string; actor_id: string; connection_revision: number; tables: GoogleTable[]; cursor: number; offset: number; staged: Partial<Record<GoogleTable, Row[]>>; metadata: Partial<Record<GoogleTable, Row>>; lease_until: number; attempts: number; lease_token?: string };
function stop(db: HaloXDatabase, item: Work, message: string) {
  db.setServerRecords('google_sync_work', db.getServerRecords('google_sync_work').filter(row => row.job_id !== item.job_id));
  // This only records a failure, never collects with another user's permissions.
  const owner = db.exportState().tables.workspaces?.find(row => row.id === item.workspace_id)?.owner_id;
  if (!owner || !db.isAccountActive(String(owner))) return;
  const job = db.queryTable('google_sync_jobs', { filters: googleWhere(item.workspace_id, item.job_id) }, String(owner)).data[0];
  if (job && ['queued', 'running'].includes(String(job.status))) googleJobUpdate(db, job, { status: 'failed', error: message, completed_at: new Date().toISOString() }, String(owner));
}
export async function scheduleGoogleSync(store: PersistentHaloXStore = haloxStore, now = Date.now()) {
  return store.write(db => {
    let queued = 0;
    for (const row of db.exportState().tables.workspace_google_connections || []) {
      if (!row.auto_sync || row.status !== 'connected' || Number(row.next_sync_at) > now) continue;
      const workspace = String(row.workspace_id), actor = String(row.sync_actor);
      try { googleManager(db, workspace, actor); } catch {
        const owner = db.exportState().tables.workspaces?.find(item => item.id === workspace)?.owner_id;
        if (owner && db.isAccountActive(String(owner))) googleUpdate(db, row, { auto_sync: false, next_sync_at: null, error: '예약한 관리자의 권한이 변경되어 자동 동기화를 중지했습니다.' }, String(owner));
        continue;
      }
      if (db.getServerRecords('google_sync_work').some(item => item.workspace_id === workspace)) continue;
      const end = new Date(now - 2 * 86400000).toISOString().slice(0, 10), start = new Date(now - 8 * 86400000).toISOString().slice(0, 10);
      // Updating only the cursor does not invalidate an in-flight credential revision.
      db.updateTable('workspace_google_connections', { next_sync_at: now + 86400000 }, googleWhere(workspace, row.id), actor);
      enqueueGoogleSync(db, workspace, actor, { start, end, expected_revision: row.revision, request_id: `daily-${row.id}-${row.revision}-${new Date(now).toISOString().slice(0, 10)}` }); queued++;
    }
    return queued;
  });
}
export async function processGoogleTick(store: PersistentHaloXStore = haloxStore, client: GoogleClient = createGoogleClient(), now = Date.now): Promise<boolean> {
  if (!await store.read(db => db.getServerRecords('google_sync_work').some(row => Number(row.lease_until) <= now()))) return false;
  const claim = await store.write(db => {
    const work = db.getServerRecords('google_sync_work') as Work[], item = work.find(row => row.lease_until <= now()); if (!item) return null;
    try { googleManager(db, item.workspace_id, item.actor_id); } catch { stop(db, item, '관리자의 접근 권한이 변경되어 수집을 중지했습니다.'); return null; }
    const connection = googleConnection(db, item.workspace_id, item.actor_id), job = db.queryTable('google_sync_jobs', { filters: googleWhere(item.workspace_id, item.job_id) }, item.actor_id).data[0];
    if (!job || !connection || connection.status !== 'connected' || connection.revision !== item.connection_revision || !['queued', 'running'].includes(String(job.status))) { stop(db, item, '연결 또는 작업 상태가 변경되었습니다.'); return null; }
    if (item.attempts >= 3) { stop(db, item, '서버 작업이 반복 중단되어 수집을 종료했습니다. 다시 동기화해 주세요.'); return null; }
    item.lease_token = crypto.randomUUID(); item.lease_until = now() + 45000; item.attempts++;
    db.setServerRecords('google_sync_work', work); googleJobUpdate(db, job, { status: 'running', started_at: job.started_at || new Date(now()).toISOString() }, item.actor_id);
    return { item, connection, job };
  });
  if (!claim) return false;
  const { item, connection, job } = claim; let result: Awaited<ReturnType<GoogleClient['report']>> | undefined, failure: unknown;
  try { const access = await googleAccess(store, connection, item.actor_id, client), table = item.tables[item.cursor]; result = await client.report(access, table, String(table === 'ga4_page_stats' ? connection.ga4_property_id : connection.gsc_site_url), String(job.start), String(job.end), item.offset); }
  catch (error) { failure = error; }
  await store.write(db => {
    const work = db.getServerRecords('google_sync_work') as Work[], current = work.find(row => row.job_id === item.job_id); if (!current || current.lease_token !== item.lease_token) return;
    try { googleManager(db, item.workspace_id, item.actor_id); } catch { stop(db, current, '관리자의 접근 권한이 변경되어 수집 결과를 반영하지 않았습니다.'); return; }
    const latest = googleConnection(db, item.workspace_id, item.actor_id), saved = db.queryTable('google_sync_jobs', { filters: googleWhere(item.workspace_id, item.job_id) }, item.actor_id).data[0];
    if (!saved || !latest || latest.revision !== current.connection_revision || latest.status !== 'connected') { stop(db, current, '연결 설정이 변경되어 수집 결과를 반영하지 않았습니다.'); return; }
    if (failure || !result) {
      stop(db, current, failure instanceof ExternalServiceError ? failure.message : 'Google 수집을 완료하지 못했습니다. 다시 시도해 주세요.');
      if (failure instanceof ExternalServiceError && failure.code === 'GOOGLE_REAUTHORIZE') googleUpdate(db, latest, { status: 'reauthorize', auto_sync: false, next_sync_at: null, error: failure.message }, item.actor_id);
      return;
    }
    const table = item.tables[item.cursor], staged = [...current.staged[table] || [], ...result.rows];
    const keys = staged.map(row => JSON.stringify([row.date, row.keyword, row.page_url, row.page_path, row.session_source, row.channel_group]));
    if (new Set(keys).size !== keys.length) { stop(db, current, '수집 중 Google 결과가 변경되어 중복 행을 발견했습니다. 기간을 줄여 다시 시도해 주세요.'); return; }
    if (staged.length > 20000 || staged.length >= 20000 && result.more) { stop(db, current, '한 표의 수집 한도 20,000행에 도달했습니다. 기간을 줄여 다시 동기화해 주세요.'); return; }
    current.staged[table] = staged; current.metadata[table] = result.metadata;
    current.offset += result.rows.length; current.lease_until = 0; current.attempts = 0;
    if (!result.more) { current.cursor++; current.offset = 0; }
    if (current.cursor < current.tables.length) { db.setServerRecords('google_sync_work', work); googleJobUpdate(db, saved, { rows: Object.values(current.staged).reduce((sum, rows) => sum + rows.length, 0) }, item.actor_id); return; }
    // Replace exactly this connection and interval. Failed or cancelled pages never reach published tables.
    let count = 0; const collected = new Date(now()).toISOString();
    for (const name of current.tables) {
      const old = db.queryTable(name, { filters: { ...googleWhere(item.workspace_id), connection_id: `eq.${latest.id}`, provider: 'eq.google' } }, item.actor_id).data.filter(row => String(row.date) >= String(saved.start) && String(row.date) <= String(saved.end));
      if (old.length) db.deleteTable(name, { ...googleWhere(item.workspace_id), id: `in.(${old.map(row => row.id).join(',')})` }, item.actor_id);
      const rows = current.staged[name] || [];
      if (rows.length) db.insertTable(name, rows.map(row => ({ ...row, workspace_id: item.workspace_id, provider: 'google', connection_id: latest.id, sync_job_id: saved.id, resource: name === 'ga4_page_stats' ? latest.ga4_property_id : latest.gsc_site_url, collected_at: collected, source_metadata: current.metadata[name] })), item.actor_id);
      count += rows.length;
    }
    googleJobUpdate(db, saved, { status: 'completed', rows: count, metadata: current.metadata, completed_at: collected }, item.actor_id);
    db.updateTable('workspace_google_connections', { last_synced_at: collected, error: '' }, googleWhere(item.workspace_id, latest.id), item.actor_id);
    db.setServerRecords('google_sync_work', work.filter(row => row !== current));
  });
  return true;
}
export function startGoogleWorker(store = haloxStore, interval = 5000) {
  let busy = false, stopped = false, lastSchedule = 0;
  const tick = async () => { if (busy || stopped) return; busy = true; try { if (Date.now() - lastSchedule >= 60000) { await scheduleGoogleSync(store); lastSchedule = Date.now(); } await processGoogleTick(store); } catch { console.error('Google 동기화 작업을 완료하지 못했습니다. 다음 실행에서 재시도합니다.'); } finally { busy = false; } };
  const timer = setInterval(() => void tick(), interval); timer.unref?.(); void tick(); return () => { stopped = true; clearInterval(timer); };
}
