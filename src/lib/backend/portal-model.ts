import crypto from 'node:crypto';
import { ADMIN_USER_ID, RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { contentText } from './content-model.ts';
import { ObservationConflictError } from './monitor-service.ts';
import type { PortalCollection } from '../api/portal.ts';
export const portalTime = (now: number) => new Date(now).toISOString();
export function portalActor(db: HaloXDatabase, actor: string) { const row = db.queryTable('profiles', { filters: { id: `eq.${actor}` } }, actor).data[0]; if (!row) throw new RlsAccessDeniedError('등록된 계정으로 로그인해 주세요.'); return row; }
// The existing seeded administrator is the local service operator, independent of workspace roles.
export const portalAdmin = (db: HaloXDatabase, actor: string) => { portalActor(db, actor); return actor === ADMIN_USER_ID; };
type PortalRow = Row & { id: string };
export const portalRows = (db: HaloXDatabase, table: PortalCollection) => db.getServerRecords(table) as PortalRow[];
export function portalInsert(db: HaloXDatabase, table: PortalCollection, values: Row, now: number) { const row = { ...values, id: crypto.randomUUID(), revision: 1, created_at: portalTime(now), updated_at: portalTime(now) }; db.setServerRecords(table, [...portalRows(db, table), row]); return row; }
export function portalUpdate(db: HaloXDatabase, table: PortalCollection, current: Row, values: Row, now: number) { const row: PortalRow = { ...current, ...values, id: String(current.id), revision: Number(current.revision) + 1, updated_at: portalTime(now) }; db.setServerRecords(table, portalRows(db, table).map(item => item.id === row.id ? row : item)); return row; }
export function portalFind(db: HaloXDatabase, table: PortalCollection, id: unknown) { const row = typeof id === 'string' && portalRows(db, table).find(row => row.id === id); if (!row) throw new RlsAccessDeniedError('항목을 찾을 수 없거나 접근 권한이 없습니다.'); return row; }
export function portalOwn(row: Row, actor: string) { if (row.owner_id !== actor) throw new RlsAccessDeniedError('본인의 항목만 변경할 수 있습니다.'); }
export function portalDelete(db: HaloXDatabase, table: PortalCollection, id: unknown) { db.setServerRecords(table, portalRows(db, table).filter(row => row.id !== id)); }
export function portalEmail(value: unknown) { const email = contentText(value, '이메일', 254, true).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('올바른 이메일 주소를 입력해 주세요.'); return email; }
export function portalRequest(db: HaloXDatabase, actor: string, command: string, payload: Row, table: PortalCollection, run: () => Row) {
  const key = contentText(payload.idempotency_key, '요청 키', 200, true), signature = crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'idempotency_key').sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
  const receipt = portalRows(db, 'portal_requests').find(row => row.actor === actor && row.key === key);
  if (receipt) { if (receipt.command !== command || receipt.signature !== signature) throw new ObservationConflictError(); if (!portalRows(db, table).some(row => row.id === receipt.result_id)) throw new Error('이미 처리 후 삭제한 요청입니다. 새 요청으로 다시 작성해 주세요.'); return { ok: true, id: receipt.result_id, replayed: true }; }
  const result = run(); portalInsert(db, 'portal_requests', { actor, key, command, signature, result_id: result.id }, Date.now()); return { ok: true, id: result.id };
}
