'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { accountRequest, PasswordField } from './AccountSecurityForms';
import { LiveModal } from './live/LiveUI';
import './live/live.css';
type DeletionView = { email: string; revision: number; scope: string; owned_workspaces: { id: string; name: string; other_members: number }[]; unresolved_operations: number; unsettled_rewards: boolean };
const date = (value: number) => new Date(value).toLocaleString('ko-KR', { timeZoneName: 'short' });
export function AccountDeletionSection() {
  const router = useRouter();
  const [view, setView] = useState<DeletionView>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [requestId, setRequestId] = useState('');
  async function inspect() {
    setBusy(true); setError('');
    try { const response = await fetch('/api/v1/account/deletion'), body = await response.json(); if (!response.ok) throw new Error(body.error || '계정 정보를 불러오지 못했습니다.'); setView(body); setRequestId(crypto.randomUUID()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '조회 실패'); } finally { setBusy(false); }
  }
  const blocked = !!view && (view.owned_workspaces.some(row => row.other_members > 0) || view.unresolved_operations > 0 || view.unsettled_rewards);
  return <section className="live-card live-section"><h2>계정 탈퇴</h2><p>현재 계정과 소유한 모든 워크스페이스에 적용됩니다. 탈퇴 요청 후 30일 동안 복원할 수 있으며, 기간이 지나면 계정과 소유 워크스페이스 자료가 삭제됩니다.</p><button className="danger" disabled={busy} onClick={() => void inspect()}>{busy ? '계정 확인 중…' : '계정 탈퇴 안내'}</button>{error && <p role="alert" className="live-error">{error}</p>}
    {view && <LiveModal scope="account" title="계정 탈퇴 요청" submit="탈퇴 요청" description="이 작업은 현재 선택한 워크스페이스에만 적용되는 작업이 아닙니다." onClose={() => setView(undefined)} onSave={async form => {
      if (blocked) throw new Error('공유 멤버 또는 미확인 외부 작업을 먼저 정리하고 다시 확인해 주세요.');
      await accountRequest('/api/v1/account/deletion', { current_password: form.get('current_password'), confirm_email: form.get('confirm_email'), confirm_text: form.get('confirm_text'), acknowledged: form.has('acknowledged'), expected_revision: view.revision, expected_scope: view.scope, request_id: requestId });
      router.replace('/app/restore-account'); router.refresh();
    }}><p><strong>{view.email}</strong></p><h3>삭제 대상 소유 워크스페이스 ({view.owned_workspaces.length})</h3>{view.owned_workspaces.length ? <ul>{view.owned_workspaces.map(row => <li key={row.id}>{row.name} · 다른 멤버 {row.other_members}명</li>)}</ul> : <p>소유한 워크스페이스가 없습니다.</p>}
      {blocked && <p role="alert" className="live-error">다른 멤버가 있는 소유 워크스페이스는 멤버를 먼저 정리해야 합니다. 진행 중·결과 미확인 번역 또는 게시 {view.unresolved_operations}건도 먼저 확인해 주세요. {view.unsettled_rewards && '미정산 추천 보상이 있습니다. 정산을 완료해야 탈퇴할 수 있습니다.'} <Link href="/app/workspaces">워크스페이스 관리</Link> · <Link href="/app/exports">번역·게시 이력</Link></p>}
      <ul><li>모든 로그인 세션이 종료되고 자료에 접근할 수 없게 됩니다.</li><li>예약 실행·진단 작업·대기 초대를 중단하고 발급한 API 키·추천 링크를 폐기합니다. 소유 워크스페이스에 저장한 WordPress 연결 비밀번호도 삭제합니다. 원격 애플리케이션 비밀번호 폐기는 WordPress에서 직접 진행해 주세요. 소유 공간 또는 본인이 연결한 Google 토큰을 삭제하고 동기화를 중지합니다. Google 계정의 앱 권한은 Google에서 직접 관리해 주세요.</li><li>복원해도 폐기한 키·링크·외부 연결과 중단한 예약은 자동 복구하지 않습니다.</li><li>다른 사람이 소유한 워크스페이스의 업무 자료와 이미 외부에 게시한 글은 유지됩니다. 최종 삭제 시 멤버십과 계정 식별 정보는 정리합니다.</li><li>계정 피드백·연락처는 최종 삭제합니다. 추천 가입·보상 이력은 계정 식별 정보를 제거해 보존합니다.</li></ul>
      <fieldset disabled={blocked}><PasswordField label="현재 비밀번호" name="current_password" current /><label>계정 이메일 확인<input name="confirm_email" type="email" required autoComplete="off" /></label><label>확인 문구<input name="confirm_text" placeholder="계정 탈퇴" required autoComplete="off" /></label><label className="check"><input name="acknowledged" type="checkbox" required />30일 이후 복원할 수 없으며 위 데이터 처리 내용을 확인했습니다.</label></fieldset>
    </LiveModal>}
  </section>;
}
export function RestoreAccountPage() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState<{ delete_after: number; revision: number }>(), [complete, setComplete] = useState(false);
  const reset = () => { setInfo(undefined); setError(''); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return; const form = new FormData(event.currentTarget); setPending(true); setError('');
    try {
      const result = await accountRequest<{ delete_after: number; revision: number }>('/api/v1/auth/restore', { action: info ? 'restore' : 'inspect', email, password, expected_revision: info?.revision, confirm: form.has('confirm') });
      if (info) { setPassword(''); setComplete(true); } else setInfo(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '계정을 복원하지 못했습니다.'); } finally { setPending(false); }
  }
  return <main className="clone-surface live account-recovery"><Link className="account-brand" href="/ko">HaloX</Link><section className="live-card"><h1>탈퇴한 계정 복원</h1>{complete ? <><p role="status">탈퇴 요청을 취소하고 계정을 복원했습니다. 다시 로그인해 주세요. 예약 실행과 폐기한 API 키·외부 연결은 직접 다시 설정해야 합니다.</p><Link href="/app/login">로그인으로 이동</Link></> : <><p>탈퇴 요청 후 30일 이내에만 복원할 수 있습니다. 가입 이메일과 현재 비밀번호로 계정을 확인해 주세요. 확인만으로 탈퇴가 취소되지는 않습니다.</p><form className="account-form" method="post" onSubmit={submit}><fieldset disabled={pending}><label>가입 이메일<input type="email" autoComplete="username" required value={email} onChange={event => { setEmail(event.target.value); reset(); }} /></label><PasswordField label="현재 비밀번호" name="password" current value={password} onChange={value => { setPassword(value); reset(); }} />{info && <><p role="status">복원 가능 기한: {date(info.delete_after)}</p><p>기한이 지나면 계정과 소유 워크스페이스는 복원할 수 없습니다. 예약 실행과 폐기한 키·외부 연결은 자동 복구되지 않습니다.</p><label className="check"><input type="checkbox" name="confirm" required />탈퇴 요청을 취소하고 계정을 복원하겠습니다.</label></>}{error && <p role="alert" className="live-error">{error}</p>}<button className="primary">{pending ? '처리 중…' : info ? '탈퇴 취소하고 복원' : '복원 가능 여부 확인'}</button></fieldset></form><Link href="/app/reset-password">비밀번호 재설정</Link> · <Link href="/app/login">로그인으로 돌아가기</Link></>}</section></main>;
}
