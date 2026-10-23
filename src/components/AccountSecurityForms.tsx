'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import './live/live.css';

type Reply = { challengeId?: string; expiresAt?: number; retryAfter?: number; verificationToken?: string; reauthenticate?: boolean };
class AccountRequestError extends Error { constructor(message: string, readonly retryAfter = 0) { super(message); } }
export async function accountRequest(endpoint: string, values: Record<string, unknown>): Promise<Reply> {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  const data = await response.json();
  if (!response.ok) throw new AccountRequestError(data.error || '요청을 완료하지 못했습니다.', Number(response.headers.get('Retry-After') || 0));
  return data;
}
function usePhoneProof(endpoint: string, identity: Record<string, string>, prefix = '') {
  const signature = JSON.stringify(identity), latest = useRef(signature); latest.current = signature;
  const [challenge, setChallenge] = useState<Reply>(), [token, setToken] = useState(''), [code, setCode] = useState(''), [expires, setExpires] = useState(0), [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { setChallenge(undefined); setToken(''); setCode(''); setExpires(0); setError(''); setMessage(''); }, [signature]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (token && now >= expires) { setToken(''); setError('인증이 만료되었습니다. 다시 발송해 주세요.'); } }, [token, now, expires]);
  async function request(action: 'send' | 'verify') {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    try {
      const data = await accountRequest(endpoint, { ...identity, action: prefix + action, challengeId: challenge?.challengeId, code });
      if (latest.current !== signature) return;
      if (action === 'send') { setChallenge(data); setToken(''); setCode(''); setRetryAt(Date.now() + Number(data.retryAfter || 60) * 1000); setMessage(prefix ? '인증번호 발송을 요청했습니다. 5분 내 입력해 주세요.' : '등록된 이메일·인증된 휴대폰 번호와 일치하면 인증번호가 발송됩니다. 5분 내 입력해 주세요.'); }
      else { setToken(data.verificationToken || ''); setExpires(data.expiresAt || 0); setMessage('휴대폰 인증을 완료했습니다. 10분 내 저장해 주세요.'); }
    } catch (cause) { if (latest.current === signature) { setError(cause instanceof Error ? cause.message : '네트워크 상태를 확인해 주세요.'); if (cause instanceof AccountRequestError && cause.retryAfter) setRetryAt(Date.now() + cause.retryAfter * 1000); } }
    finally { setBusy(false); setNow(Date.now()); }
  }
  return { token, code, setCode, busy, error, message, challenge, expired: !!challenge && now >= Number(challenge.expiresAt), cooldown: Math.max(0, Math.ceil((retryAt - now) / 1000)), request };
}
function ProofControls({ proof, ready }: { proof: ReturnType<typeof usePhoneProof>; ready: boolean }) {
  return <div className="account-proof"><button type="button" disabled={!ready || proof.busy || proof.cooldown > 0 || !!proof.token} onClick={() => void proof.request('send')}>{proof.busy ? '처리 중…' : proof.cooldown ? `${proof.cooldown}초 후 재발송` : proof.challenge ? '인증번호 재발송' : '인증번호 발송'}</button>
    {proof.challenge && <div className="account-code"><label>휴대폰 인증번호<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={proof.code} disabled={proof.busy || !!proof.token} onChange={event => proof.setCode(event.target.value.replace(/\D/g, ''))} /></label><button type="button" disabled={proof.busy || proof.code.length !== 6 || proof.expired || !!proof.token} onClick={() => void proof.request('verify')}>{proof.token ? '인증 완료' : '인증 확인'}</button></div>}
    {proof.error ? <p role="alert" className="live-error">{proof.error}</p> : proof.message && <p role="status">{proof.message}</p>}{proof.expired && !proof.token && <p role="status">인증번호가 만료되었습니다. 다시 발송해 주세요.</p>}
  </div>;
}
export function PasswordField({ label, name, value, onChange, current = false }: { label: string; name: string; value?: string; onChange?: (value: string) => void; current?: boolean }) {
  const [visible, setVisible] = useState(false), id = useId();
  return <div className="account-field"><label htmlFor={id}>{label}</label><div className="account-password"><input id={id} name={name} type={visible ? 'text' : 'password'} autoComplete={current ? 'current-password' : 'new-password'} minLength={current ? 1 : 8} maxLength={current ? 512 : 128} required value={value} onChange={onChange ? event => onChange(event.target.value) : undefined} /><button type="button" aria-label={`${label} ${visible ? '숨기기' : '보기'}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? '숨기기' : '보기'}</button></div></div>;
}
export function PhoneChangeForm({ onSaved }: { onSaved: () => void }) {
  const [phone, setPhone] = useState(''), [password, setPassword] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('');
  const proof = usePhoneProof('/api/v1/account', { phone, current_password: password }, 'phone-');
  async function save(event: FormEvent) {
    event.preventDefault(); if (pending || !proof.token) return; setPending(true); setError('');
    try { await accountRequest('/api/v1/account', { action: 'phone-update', phone, current_password: password, verificationToken: proof.token }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); } finally { setPending(false); }
  }
  return <form className="account-form" method="post" onSubmit={save}><fieldset disabled={pending || proof.busy}><PasswordField name="current_password" label="현재 비밀번호" current value={password} onChange={setPassword} /><label>새 휴대폰 번호<input type="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} required maxLength={25} /></label></fieldset><fieldset disabled={pending}><ProofControls proof={proof} ready={!!phone && !!password} /></fieldset>{error && <p role="alert" className="live-error">{error}</p>}<button className="primary" disabled={pending || proof.busy || !proof.token}>인증한 번호로 변경</button><p className="muted">변경하면 다른 로그인 세션은 종료됩니다. 현재 세션은 유지됩니다.</p></form>;
}
export function PasswordRecoveryPage() {
  const [email, setEmail] = useState(''), [phone, setPhone] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState(''), [complete, setComplete] = useState(false);
  const proof = usePhoneProof('/api/v1/auth/recovery', { email: email.trim().toLowerCase(), phone });
  async function reset(event: FormEvent) {
    event.preventDefault(); if (pending || !proof.token) return; setError('');
    if (password !== confirmation) { setError('새 비밀번호가 서로 일치하지 않습니다.'); return; }
    setPending(true);
    try { await accountRequest('/api/v1/auth/recovery', { action: 'reset', email, phone, verificationToken: proof.token, password }); setPassword(''); setConfirmation(''); setComplete(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '재설정하지 못했습니다.'); } finally { setPending(false); }
  }
  return <main className="clone-surface live account-recovery"><Link className="account-brand" href="/ko">HaloX</Link><section className="live-card"><h1>비밀번호 재설정</h1>{complete ? <><p role="status">비밀번호가 변경되고 기존 로그인 세션이 모두 종료되었습니다.</p><Link href="/app/login">새 비밀번호로 로그인</Link></> : <><p>가입 이메일과 계정에 등록된 인증된 휴대폰 번호를 입력해 주세요.</p><form method="post" className="account-form" onSubmit={reset}><fieldset disabled={pending || proof.busy}><label>가입 이메일<input type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} /></label><label>등록된 휴대폰 번호<input type="tel" autoComplete="tel" maxLength={25} required value={phone} onChange={event => setPhone(event.target.value)} /></label></fieldset><fieldset disabled={pending}><ProofControls proof={proof} ready={!!email && !!phone} /></fieldset>{proof.token && <fieldset disabled={pending}><PasswordField label="새 비밀번호" name="password" value={password} onChange={setPassword} /><PasswordField label="새 비밀번호 확인" name="passwordConfirm" value={confirmation} onChange={setConfirmation} /></fieldset>}{error && <p role="alert" className="live-error">{error}</p>}<button className="primary" disabled={pending || proof.busy || !proof.token}>{pending ? '변경 중…' : '비밀번호 재설정'}</button></form><p className="muted">인증된 전화번호가 없는 계정은 로그인 후 내 프로필에서 번호를 등록해 주세요.</p><Link href="/app/login">로그인으로 돌아가기</Link></>}</section></main>;
}
