'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DELIVERY_STATUS, NOTIFICATION_EVENTS, type NotificationsView } from '@/lib/api/notifications';
import type { LibraryRow as Row } from '@/lib/api/library';
import { accountRequest } from '../AccountSecurityForms';
import { LibraryWorkspace, text } from './LibraryShared';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';
import { SettingsNav } from './WorkspaceSettingsPage';
export function NotificationsPage() { return <LibraryWorkspace>{(id, name) => <NotificationsPanel key={id} workspaceId={id} name={name} />}</LibraryWorkspace>; }
function NotificationsPanel({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [data, setData] = useState<NotificationsView>(), [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ action: string; row: Row }>(), [inboxPage, setInboxPage] = useState(1), [deliveryPage, setDeliveryPage] = useState(1), generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try { const response = await fetch(`/api/v1/notifications?${new URLSearchParams({ workspace_id: workspaceId })}`, { cache: 'no-store' }), body = await response.json(); if (!response.ok) throw new Error(body.error || '알림을 불러오지 못했습니다.'); if (request === generation.current) setData(body); }
    catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const open = (action: string, row: Row = { id: '' }) => setEdit({ action, row });
  async function command(action: string, fields: Row = { id: '' }) {
    const result = await accountRequest<NotificationsView>('/api/v1/notifications', { workspace_id: workspaceId, action, ...fields }); ++generation.current; setData(result); setNotice(action === 'email-send' ? '계정 이메일로 인증번호를 보냈습니다. 10분 안에 입력해 주세요.' : '변경 내용을 저장했습니다.');
  }
  async function immediate(action: string, fields: Row) { setBusy(true); setNotice(''); try { await command(action, fields); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '처리 실패'); } finally { setBusy(false); } }
  const titles: Record<string, string> = { 'preferences-save': '내 알림 설정', 'preferences-delete': '내 알림 설정 삭제', 'email-send': '계정 이메일 인증번호 발송', 'email-confirm': '이메일 인증번호 확인', 'inbox-delete': '알림 삭제', 'delivery-delete': '발송 이력 삭제', 'delivery-cancel': '발송 취소', 'delivery-retry': '실패한 발송 다시 시도' };
  const prefs = data?.preferences;
  function pager(page: number, count: number, setPage: (value: number) => void, label: string) { const current = Math.min(page, Math.max(1, Math.ceil(count / 10))); return count > 10 ? <nav className="live-actions" aria-label={label}><button disabled={current === 1} onClick={() => setPage(current - 1)}>이전</button><span>{current} / {Math.ceil(count / 10)}</span><button disabled={current * 10 >= count} onClick={() => setPage(current + 1)}>다음</button></nav> : null; }
  const pageRows = (rows: Row[], page: number) => rows.slice((Math.min(page, Math.max(1, Math.ceil(rows.length / 10))) - 1) * 10, Math.min(page, Math.max(1, Math.ceil(rows.length / 10))) * 10);
  return <div className="live live-settings-page"><header className="live-head"><div><h1>알림</h1><p>{name} · 내 수신 설정과 알림함</p></div><button disabled={loading || busy || !!edit} onClick={() => void reload()}>새로고침</button></header><SettingsNav current="notifications" />
    {error && <ErrorState message={error} retry={reload} />}{loading && <p role="status">알림을 불러오는 중…</p>}{notice && <p className="live-status" role="status">{notice}</p>}
    {data && prefs && !error && <><section className="live-card live-section"><h2>내 알림 설정</h2><p>이 워크스페이스에서 앞으로 발생하는 알림에 적용됩니다. 다른 멤버의 수신 설정에는 영향을 주지 않습니다.</p>
      {!data.can_monitor && <p>알림을 받으려면 모니터링 메뉴 접근 권한이 필요합니다.</p>}
      <dl className="account-details"><dt>알림함</dt><dd>{prefs.inbox ? '켜짐' : '꺼짐'}</dd><dt>이메일</dt><dd>{prefs.email ? '켜짐' : '꺼짐'} · {data.contact.email} · {data.contact.email_verified ? '인증 완료' : '인증 필요'}</dd><dt>문자</dt><dd>{prefs.sms ? '켜짐' : '꺼짐'} · {data.contact.phone || '휴대전화 없음'} · {data.contact.phone_verified ? '인증 완료' : '인증 필요'}</dd><dt>알림 유형</dt><dd>{prefs.events.map(key => NOTIFICATION_EVENTS[key]).join(', ') || '선택 안 함'}</dd><dt>감시 규칙</dt><dd>{prefs.rule_ids.length ? `${prefs.rule_ids.length}개 선택` : '접근 가능한 모든 규칙'}</dd></dl>
      <p className="muted">이메일: {data.configured.email ? 'SMTP 사용 가능' : 'SMTP 설정 대기'} · 문자: {data.configured.sms ? 'SOLAPI 사용 가능' : 'SOLAPI 설정 대기'}</p><p>서버 설정이 없으면 외부 발송은 대기합니다. 24시간 지난 대기는 자동 취소됩니다. 문자 알림은 장문 문자(LMS)로 발송됩니다. 외부 알림은 사용자·워크스페이스별 최근 24시간에 최대 100건 접수합니다.</p>
      <div className="live-actions"><button className="primary" onClick={() => open('preferences-save', prefs as unknown as Row)}>수신 설정 수정</button>{prefs.saved && <button className="danger" onClick={() => open('preferences-delete', prefs as unknown as Row)}>수신 설정 삭제</button>}{!data.contact.email_verified && <><button disabled={!data.configured.email || busy} onClick={() => open('email-send')}>이메일 인증번호 받기</button><button onClick={() => open('email-confirm')}>이메일 인증번호 입력</button></>}<a href="/app/settings?tab=profile">휴대전화 관리</a></div>
    </section><section className="live-section"><h2>내 알림함 · 읽지 않음 {data.unread}개</h2><p>최근 30일, 최대 500개의 알림을 보관합니다. 원본이 삭제되거나 접근 권한이 사라지면 표시하지 않습니다.</p>
      {!data.inbox.length ? <EmptyState>아직 받은 알림이 없습니다. 알림함을 켜면 새로 발생한 알림이 쌓입니다.</EmptyState> : <div className="live-history">{pageRows(data.inbox, inboxPage).map(row => <article className="live-card" key={row.id}><h3>{text(row.title)}</h3><p>{text(row.created_at)} · {row.is_read ? '읽음' : '읽지 않음'}</p><div className="live-actions"><button disabled={busy} onClick={() => void immediate('inbox-read', { id: row.id, expected_revision: row.revision, is_read: !row.is_read })}>{row.is_read ? '읽지 않음으로 표시' : '읽음으로 표시'}</button><a href={row.event_type === 'report.ready' ? '/app/reports' : '/app/monitoring'}>관련 화면</a><button className="danger" onClick={() => open('inbox-delete', row)}>알림 삭제</button></div></article>)}</div>}{pager(inboxPage, data.inbox.length, setInboxPage, '알림함 페이지')}
    </section><section className="live-section"><h2>외부 발송 이력</h2><p>발송 이력도 최근 30일, 최대 500개를 보관합니다. 이메일의 “제공사 접수”는 SMTP 서버가 메시지를 받아들였다는 뜻입니다. 실제 수신함 도착 여부는 확인하지 않습니다. 문자는 SOLAPI의 전달 결과를 최대 24시간 조회합니다. 결과가 불명확한 요청은 중복 방지를 위해 재발송하지 않습니다.</p>
      {!data.deliveries.length ? <EmptyState>외부 발송 이력이 없습니다.</EmptyState> : <div className="live-history">{pageRows(data.deliveries, deliveryPage).map(row => <article className="live-card" key={row.id}><h3>{text(row.title)}</h3><p>{row.channel === 'email' ? '이메일 · SMTP' : '문자 · SOLAPI'} · {DELIVERY_STATUS[text(row.status)]} · {text(row.created_at)}</p>{row.error ? <p className="live-error">{text(row.error)}</p> : null}{row.provider_id ? <p className="live-url muted">발송 식별자: {text(row.provider_id)}</p> : null}<div className="live-actions">{['queued', 'blocked'].includes(text(row.status)) && <button onClick={() => open('delivery-cancel', row)}>발송 취소</button>}{row.status === 'failed' && !row.provider_id && Number(row.attempts) < 3 && <button onClick={() => open('delivery-retry', row)}>다시 시도</button>}{row.status !== 'sending' && (row.status !== 'accepted' || row.next_at === null) && <button className="danger" onClick={() => open('delivery-delete', row)}>이력 삭제</button>}</div></article>)}</div>}{pager(deliveryPage, data.deliveries.length, setDeliveryPage, '발송 이력 페이지')}
    </section></>}
    {edit && data && <LiveModal scope="account" title={titles[edit.action]} description="현재 계정의 알림 설정에만 적용됩니다." submit={edit.action.endsWith('delete') ? '삭제' : edit.action === 'email-send' ? '인증번호 발송' : edit.action === 'email-confirm' ? '인증 확인' : edit.action === 'delivery-cancel' ? '발송 취소' : edit.action === 'delivery-retry' ? '다시 시도' : '저장'} onClose={() => setEdit(undefined)} onSave={async form => {
      await command(edit.action, { id: edit.row.id, expected_revision: edit.row.revision, inbox: form.has('inbox'), email: form.has('email'), sms: form.has('sms'), events: form.getAll('events'), rule_ids: form.getAll('rule_ids'), code: form.get('code') });
    }}>
      {edit.action === 'preferences-save' && <><h3>수신 채널</h3>{[['inbox', '알림함'], ['email', '이메일 알림'], ['sms', '문자 알림']].map(([key, label]) => <label className="check" key={key}><input type="checkbox" name={key} defaultChecked={!!edit.row[key]} />{label}</label>)}<p>이메일·문자를 켜면 인증한 계정 연락처로 자동 발송됩니다. 외부 발송을 끄면 대기 중인 요청도 취소됩니다.</p><h3>알림 유형</h3>{Object.entries(NOTIFICATION_EVENTS).map(([key, label]) => <label className="check" key={key}><input type="checkbox" name="events" value={key} defaultChecked={(edit.row.events as string[]).includes(key)} />{label}</label>)}<h3>감시 규칙 선택</h3><p>아무것도 선택하지 않으면 앞으로 추가될 규칙을 포함해 접근 가능한 모든 규칙을 받습니다. 보고서 알림에는 이 선택이 적용되지 않습니다.</p>{(edit.row.rule_ids as string[]).filter(id => !data.rules.some(row => row.id === id)).map(id => <label className="check" key={id}><input type="checkbox" name="rule_ids" value={id} defaultChecked />사용할 수 없는 선택 규칙 · {id.slice(0, 8)} (선택을 해제해 주세요)</label>)}{data.rules.map(row => <label className="check" key={row.id}><input type="checkbox" name="rule_ids" value={row.id} defaultChecked={(edit.row.rule_ids as string[]).includes(row.id)} />{text(row.name)}</label>)}</>}
      {edit.action === 'preferences-delete' && <p>내 수신 설정을 삭제하고 모든 알림 수신을 끕니다. 아직 발송하지 않은 요청은 취소합니다. 기존 알림과 발송 이력은 유지됩니다.</p>}
      {edit.action === 'email-send' && <p>{data.contact.email} 주소로 인증 메일을 보냅니다. 1분 간격, 시간당 최대 3회 요청할 수 있습니다.</p>}
      {edit.action === 'email-confirm' && <label>8자리 인증번호<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength={8} maxLength={8} /></label>}
      {edit.action === 'inbox-delete' && <p>이 알림을 내 알림함에서 삭제합니다. 감시 규칙·보고서 원본은 유지됩니다.</p>}
      {edit.action === 'delivery-delete' && <p>내 발송 이력을 삭제합니다. 이미 접수되거나 전달된 이메일·문자는 회수할 수 없습니다.</p>}
      {edit.action === 'delivery-cancel' && <p>아직 발송하지 않은 이 요청을 취소합니다.</p>}
      {edit.action === 'delivery-retry' && <p>제공사가 접수를 거절한 요청을 다시 시도합니다. 서버 관리자가 발송 설정을 확인한 후 실행해 주세요. 24시간 내 최대 3회 시도할 수 있습니다.</p>}
    </LiveModal>}
  </div>;
}
