import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { contentText } from './content-model.ts';
import { observationRevision } from './monitor-service.ts';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, type FeedbackData } from '../api/portal.ts';
import { portalActor, portalAdmin, portalRows, portalInsert, portalUpdate, portalFind, portalOwn, portalDelete, portalRequest, portalTime } from './portal-model.ts';
export const FEEDBACK_COMMANDS = ['feedback-thread-create', 'feedback-thread-update', 'feedback-thread-delete', 'feedback-status-update', 'feedback-reply-create', 'feedback-reply-update', 'feedback-reply-delete'];
function threadAccess(db: HaloXDatabase, actor: string, id: unknown) { const row = portalFind(db, 'feedback_threads', id); if (row.owner_id !== actor && !portalAdmin(db, actor)) throw new RlsAccessDeniedError('작성자와 서비스 운영자만 열람할 수 있습니다.'); return row; }
function threadFields(payload: Row) { if (!Object.hasOwn(FEEDBACK_CATEGORIES, String(payload.category))) throw new Error('피드백 종류를 선택해 주세요.'); return { title: contentText(payload.title, '피드백 제목', 200, true), body: contentText(payload.body, '피드백 내용', 20000, true, true), category: payload.category }; }
export function readFeedback(db: HaloXDatabase, actor: string, view: string, id?: string): FeedbackData {
  const can_support = portalAdmin(db, actor); if (!['mine', 'support'].includes(view)) throw new Error('피드백 보기를 선택해 주세요.'); if (view === 'support' && !can_support) throw new RlsAccessDeniedError('서비스 운영자 권한이 필요합니다.');
  const thread = id ? threadAccess(db, actor, id) : undefined;
  const threads = portalRows(db, 'feedback_threads').filter(row => view === 'support' || row.owner_id === actor).sort((a, b) => String(b.activity_at).localeCompare(String(a.activity_at))).map(row => ({ ...row, reply_count: portalRows(db, 'feedback_replies').filter(reply => reply.thread_id === row.id).length }));
  const replies = thread ? portalRows(db, 'feedback_replies').filter(row => row.thread_id === thread.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) : [];
  const events = thread ? portalRows(db, 'feedback_events').filter(row => row.thread_id === thread.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) : [];
  return { actor, can_support, view, threads, thread, replies, events } as FeedbackData;
}
export function runFeedbackCommand(db: HaloXDatabase, command: string, payload: Row, actor: string, now = Date.now()): Row {
  const profile = portalActor(db, actor), admin = portalAdmin(db, actor);
  if (command === 'feedback-thread-create') return portalRequest(db, actor, command, payload, 'feedback_threads', () => {
    if (portalRows(db, 'feedback_threads').filter(row => row.owner_id === actor).length >= 100) throw new Error('계정당 피드백은 최대 100개입니다.');
    let workspace_name = '', workspace_id: string | null = null;
    if (payload.workspace_id) { if (typeof payload.workspace_id !== 'string') throw new Error('워크스페이스를 확인해 주세요.'); db.assertWorkspaceMember(payload.workspace_id, actor); workspace_id = payload.workspace_id; workspace_name = String(db.queryTable('workspaces', { filters: { id: `eq.${workspace_id}` } }, actor).data[0]?.name || ''); }
    return portalInsert(db, 'feedback_threads', { ...threadFields(payload), owner_id: actor, author_label: String(profile.full_name || '회원'), workspace_id, workspace_name, status: 'open', activity_at: portalTime(now) }, now);
  });
  const thread = threadAccess(db, actor, payload.thread_id);
  if (command === 'feedback-thread-delete') {
    observationRevision(thread, payload.expected_revision); portalDelete(db, 'feedback_threads', thread.id); for (const table of ['feedback_replies', 'feedback_events'] as const) db.setServerRecords(table, portalRows(db, table).filter(row => row.thread_id !== thread.id)); return { ok: true };
  }
  if (command === 'feedback-thread-update') { portalOwn(thread, actor); observationRevision(thread, payload.expected_revision); portalUpdate(db, 'feedback_threads', thread, { ...threadFields(payload), activity_at: portalTime(now) }, now); return { ok: true }; }
  if (command === 'feedback-status-update') {
    if (!admin) throw new RlsAccessDeniedError('상태 변경은 서비스 운영자만 할 수 있습니다.'); observationRevision(thread, payload.expected_revision); if (!Object.hasOwn(FEEDBACK_STATUSES, String(payload.status))) throw new Error('처리 상태를 선택해 주세요.');
    const note = contentText(payload.note, '상태 변경 사유', 2000, true); if (payload.status === thread.status) throw new Error('현재와 다른 상태를 선택해 주세요.');
    portalInsert(db, 'feedback_events', { thread_id: thread.id, actor_id: actor, before: thread.status, after: payload.status, note }, now); portalUpdate(db, 'feedback_threads', thread, { status: payload.status, activity_at: portalTime(now) }, now); return { ok: true };
  }
  const touch = () => portalUpdate(db, 'feedback_threads', thread, { activity_at: portalTime(now) }, now);
  if (command === 'feedback-reply-create') return portalRequest(db, actor, command, payload, 'feedback_replies', () => {
    if (portalRows(db, 'feedback_replies').filter(row => row.thread_id === thread.id).length >= 200) throw new Error('피드백당 답변은 최대 200개입니다.');
    const reply = portalInsert(db, 'feedback_replies', { thread_id: thread.id, owner_id: actor, author_label: admin ? '서비스 운영자' : String(profile.full_name || '작성자'), role: admin ? 'support' : 'author', body: contentText(payload.body, '답변 내용', 10000, true, true) }, now); touch(); return reply;
  });
  const reply = portalFind(db, 'feedback_replies', payload.reply_id); if (reply.thread_id !== thread.id) throw new RlsAccessDeniedError('피드백에 속한 답변만 변경할 수 있습니다.'); observationRevision(reply, payload.expected_revision);
  if (command === 'feedback-reply-delete') { if (reply.owner_id !== actor && !admin) throw new RlsAccessDeniedError('본인이 작성한 답변만 삭제할 수 있습니다.'); portalDelete(db, 'feedback_replies', reply.id); touch(); return { ok: true }; }
  portalOwn(reply, actor); portalUpdate(db, 'feedback_replies', reply, { body: contentText(payload.body, '답변 내용', 10000, true, true) }, now); touch(); return { ok: true };
}
