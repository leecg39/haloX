'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GOOGLE_STATUS, type GoogleView } from '@/lib/api/google';
import type { LibraryRow as Row } from '@/lib/api/library';
import { accountRequest } from '../AccountSecurityForms';
import { LibraryWorkspace, text } from './LibraryShared';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';
import { SettingsNav } from './WorkspaceSettingsPage';
export function IntegrationsPage() { return <LibraryWorkspace>{(id, name) => <GooglePanel key={id} workspaceId={id} name={name} />}</LibraryWorkspace>; }
const active = (row: Row) => ['queued', 'running'].includes(text(row.status));
const date = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
function GooglePanel({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [data, setData] = useState<GoogleView>(), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ action: string; row: Row; request: string }>(), generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try { const response = await fetch(`/api/v1/google?${new URLSearchParams({ workspace_id: workspaceId })}`, { cache: 'no-store' }), body = await response.json(); if (!response.ok) throw new Error(body.error || 'Google 연동을 불러오지 못했습니다.'); if (request === generation.current) setData(body); }
    catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); const result = new URLSearchParams(window.location.search).get('google'); if (result) setNotice(result === 'connected' ? 'Google 계정을 연결했습니다. 연결을 시작했던 워크스페이스에서 사이트·속성 목록을 불러오세요.' : 'Google 연결을 완료하지 못했습니다. 연결 시도를 취소한 뒤 다시 시작해 주세요.'); return () => { ++generation.current; }; }, [reload]);
  const running = data?.jobs.some(active);
  useEffect(() => { if (!running || edit || busy) return; const timer = setInterval(() => void reload(), 5000); return () => clearInterval(timer); }, [running, edit, busy, reload]);
  const connection = data?.connection, connected = connection?.status === 'connected', open = (action: string, row: Row = connection || { id: '' }) => setEdit({ action, row, request: crypto.randomUUID() });
  const resources = (connection?.resources || { sites: [], properties: [] }) as { sites: Row[]; properties: Row[] };
  const titles: Record<string, string> = { connect: 'Google 계정 연결', settings: '연결 설정 수정', disconnect: 'Google 연결 해제', sync: 'Google 데이터 동기화', 'job-update': '동기화 메모 수정', 'job-delete': '동기화 이력 삭제', 'job-cancel': '동기화 취소' };
  return <div className="live live-settings-page"><header className="live-head"><div><h1>외부 서비스 연동</h1><p>{name}</p></div><button disabled={loading || busy || !!edit} onClick={() => void reload()}>새로고침</button></header><SettingsNav current="integrations" />
    {error && <ErrorState message={error} retry={reload} />}{loading && <p role="status">연동 상태를 불러오는 중…</p>}{notice && <p className="live-status" role="status">{notice}</p>}
    {data && !error && <><section className="live-card live-section"><h2>Google 통합 계정</h2><p>Search Console과 Analytics 4에서 검색·방문 데이터를 수집합니다. 연결한 Google 계정의 읽기 권한만 요청합니다.</p>
      {!data.configured && <p role="status">Google 연동 준비 중입니다. 서버 관리자가 OAuth 설정을 완료하면 연결할 수 있습니다.</p>}
      <dl className="account-details"><dt>상태</dt><dd>{GOOGLE_STATUS[text(connection?.status)] || '연결 안 됨'}</dd>{connection?.email ? <><dt>Google 계정</dt><dd className="live-url">{text(connection.email)}</dd></> : null}<dt>연결 이름</dt><dd>{text(connection?.name) || '미설정'}</dd><dt>Search Console</dt><dd className="live-url">{text(connection?.gsc_site_url) || '선택 안 함'}</dd><dt>GA4 속성</dt><dd>{text(connection?.ga4_property_id) || '선택 안 함'}</dd><dt>자동 동기화</dt><dd>{connection?.auto_sync ? '매일 · 2일 전까지 최근 7일' : '꺼짐'}</dd><dt>마지막 반영</dt><dd>{text(connection?.last_synced_at) || '아직 없음'}</dd></dl>
      {connection?.error ? <p className="live-error" role="alert">{text(connection.error)}</p> : null}
      {data.editable ? <div className="live-actions">{!connection || connection.status === 'disconnected' ? <button className="primary" disabled={!data.configured || busy} onClick={() => open('connect')}>Google 계정 연결</button> : <>
        {connected && <><button disabled={busy || !!running} onClick={async () => { setBusy(true); setNotice(''); try { setData(await accountRequest<GoogleView>('/api/v1/google', { action: 'discover', workspace_id: workspaceId, expected_revision: connection.revision })); setNotice('접근 가능한 사이트·속성 목록을 불러왔습니다. 연결 설정에서 선택하세요.'); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '목록 조회 실패'); } finally { setBusy(false); } }}>사이트·속성 목록 불러오기</button><button disabled={busy || !!running} onClick={() => open('settings')}>연결 설정 수정</button><button disabled={busy || !!running || !connection.gsc_site_url && !connection.ga4_property_id} className="primary" onClick={() => open('sync')}>지금 동기화</button></>}
        <button className="danger" disabled={busy} onClick={() => open('disconnect')}>{connection.status === 'authorizing' ? '연결 시도 취소' : '연결 해제'}</button></>}
      </div> : <p>연결과 동기화는 분석·설정 메뉴 권한이 있는 소유자 또는 관리자가 할 수 있습니다.</p>}
      <p className="muted">Search Console은 미국 태평양 날짜 기준의 최종 데이터와 API가 제공하는 상위 행을 수집합니다. GA4는 속성 시간대의 방문 시작 페이지·세션 출처를 저장합니다. 두 서비스의 날짜 기준과 측정 범위가 다를 수 있습니다.</p><p className="muted">AI 유입은 ChatGPT·Perplexity·Claude·Gemini·Copilot의 알려진 도메인을 출처로 가진 세션입니다. 전체 AI 유입을 의미하지 않습니다. GA4 전환 필드는 주요 이벤트 수입니다.</p><a href="/app/raw-data">수집된 Raw 데이터 보기</a>
    </section><section className="live-section"><h2>동기화 이력</h2><p>최근 50개 실행입니다. 실패·취소 시 이전 측정값을 유지합니다. 완료된 같은 기간을 다시 수집하면 해당 기간의 값을 교체합니다.</p>
      {!data.jobs.length ? <EmptyState>동기화 이력이 없습니다.</EmptyState> : <div className="live-history">{data.jobs.map(job => <article className="live-card" key={job.id}><h3>{text(job.start)} ~ {text(job.end)} · {GOOGLE_STATUS[text(job.status)] || text(job.status)}</h3><p>{text(job.rows || 0)}행 · {text(job.created_at)}</p><p className="live-url">{text(job.gsc_site_url)} {text(job.ga4_property_id)}</p>{job.error ? <p className="live-error">{text(job.error)}</p> : null}<p className="live-preserve">{text(job.notes)}</p>{job.metadata ? <details><summary>수집 범위·시간대·제한 확인</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(job.metadata, null, 2)}</pre></details> : null}{data.editable && <div className="live-actions">{active(job) ? <button onClick={() => open('job-cancel', job)}>동기화 취소</button> : <><button onClick={() => open('job-update', job)}>메모 수정</button><button className="danger" onClick={() => open('job-delete', job)}>이력 삭제</button></>}</div>}</article>)}</div>}
    </section><section className="live-card live-section"><h2>추가 서비스</h2><p>네이버 서치어드바이저·Bing 웹마스터 도구·Slack 연동은 준비 중입니다.</p></section></>}
    {edit && <LiveModal title={titles[edit.action]} submit={edit.action === 'connect' ? 'Google에서 계속' : edit.action === 'sync' ? '동기화 시작' : edit.action === 'disconnect' ? '연결 해제' : edit.action === 'job-delete' ? '삭제' : edit.action === 'job-cancel' ? '동기화 취소' : '저장'} onClose={() => setEdit(undefined)} onSave={async form => {
      const result = await accountRequest<GoogleView & { url?: string }>('/api/v1/google', { workspace_id: workspaceId, action: edit.action, expected_revision: edit.row.revision, job_id: edit.row.id, request_id: edit.request, name: form.get('name'), gsc_site_url: form.get('gsc_site_url'), ga4_property_id: form.get('ga4_property_id'), auto_sync: form.has('auto_sync'), confirm_replace: form.has('confirm_replace'), start: form.get('start'), end: form.get('end'), notes: form.get('notes') });
      ++generation.current; if (result.url) { window.location.assign(result.url); return; } setData(result); setNotice(edit.action === 'sync' ? '동기화를 대기열에 등록했습니다.' : '변경 내용을 저장했습니다.');
    }}>
      {edit.action === 'connect' && <p>Google에서 Search Console·Analytics 읽기 권한을 허용한 뒤 이 화면으로 돌아옵니다. 계정 연결 후 수집할 사이트·속성을 직접 선택하세요. 재연결하면 이전 연결의 Google 측정값은 삭제합니다.</p>}
      {edit.action === 'disconnect' && <><p>서버에 저장한 Google 토큰과 이 연결로 수집한 측정값을 삭제하고 진행 중인 수집을 취소합니다. 이력은 남습니다. Google 계정 자체의 앱 권한은 별도로 관리할 수 있습니다.</p><a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google 계정의 앱 권한 관리</a></>}
      {edit.action === 'settings' && <><label>연결 이름<input name="name" required maxLength={100} defaultValue={text(edit.row.name)} /></label><label>Search Console 사이트<select name="gsc_site_url" defaultValue={text(edit.row.gsc_site_url)}><option value="">수집 안 함</option>{resources.sites.map(item => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select></label><label>GA4 속성<select name="ga4_property_id" defaultValue={text(edit.row.ga4_property_id)}><option value="">수집 안 함</option>{resources.properties.map(item => <option key={text(item.id)} value={text(item.id)}>{text(item.name)} · {text(item.id)}</option>)}</select></label><label className="check"><input name="auto_sync" type="checkbox" defaultChecked={!!edit.row.auto_sync} />매일 자동 동기화</label><p>설정을 저장하면 진행 중인 수집을 취소합니다. 수집 대상을 바꾸면 이전 Google 측정값을 삭제합니다.</p><label className="check"><input name="confirm_replace" type="checkbox" />대상이 바뀌면 이전 수집값 삭제에 동의합니다</label></>}
      {edit.action === 'sync' && <><label>시작일<input type="date" name="start" required defaultValue={date(8)} max={date(1)} /></label><label>종료일<input type="date" name="end" required defaultValue={date(2)} max={date(1)} /></label><p>최대 31일·표별 20,000행입니다. 수집 한도를 넘으면 기존 값을 유지하고 실패로 기록합니다.</p></>}
      {edit.action === 'job-update' && <label>메모<textarea name="notes" maxLength={2000} defaultValue={text(edit.row.notes)} /></label>}
      {edit.action === 'job-delete' && <p>이 실행의 이력과 메모를 삭제합니다. 이미 반영된 측정값은 유지합니다.</p>}{edit.action === 'job-cancel' && <p>진행 중인 수집을 취소하고 임시 결과를 삭제합니다. 이전 측정값은 유지합니다.</p>}
    </LiveModal>}
  </div>;
}
