'use client';

import { useEffect, useRef, useState } from 'react';

interface Challenge { challengeId: string; expiresAt: number; phone: string }
const normalized = (value: string) => value.replace(/[\s()-]/g, '').replace(/^\+?82/, '0');

export function PhoneVerificationButton({ className }: { className?: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const phoneRef = useRef('');
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [verifiedUntil, setVerifiedUntil] = useState(0);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    const row = buttonRef.current?.parentElement;
    const input = row?.querySelector<HTMLInputElement>('input[type="tel"]');
    if (!row || !input) return;
    const previousWrap = row.style.flexWrap;
    row.style.flexWrap = 'wrap';
    const sync = () => {
      const next = normalized(input.value);
      if (next !== phoneRef.current) {
        phoneRef.current = next;
        setPhone(next);
        setChallenge(null);
        setCode('');
        setToken('');
        setVerifiedUntil(0);
        setMessage('');
        setError(false);
        input.dataset.phoneVerified = 'false';
      }
    };
    sync();
    input.addEventListener('input', sync);
    return () => { input.removeEventListener('input', sync); row.style.flexWrap = previousWrap; };
  }, []);

  useEffect(() => {
    const input = buttonRef.current?.parentElement?.querySelector<HTMLInputElement>('input[type="tel"]');
    if (input) { input.readOnly = !!busy; input.dataset.phoneVerified = String(!!token); }
    return () => { if (input) input.readOnly = false; };
  }, [busy, token]);

  useEffect(() => {
    if (!retryAt && !challenge && !verifiedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt, challenge, verifiedUntil]);

  useEffect(() => {
    if (token && now >= verifiedUntil) {
      setToken('');
      setMessage('휴대폰 인증이 만료되었습니다. 다시 인증해 주세요.');
      setError(true);
    }
  }, [now, token, verifiedUntil]);

  async function request(action: 'send' | 'verify') {
    if (busy) return;
    const requestedPhone = phoneRef.current;
    setBusy(action);
    setError(false);
    setMessage('');
    try {
      const response = await fetch('/api/v1/auth/phone', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, phone: requestedPhone, challengeId: challenge?.challengeId, code }),
      });
      const result = await response.json();
      if (requestedPhone !== phoneRef.current) return;
      const retryAfter = Number(response.headers.get('Retry-After') || result.retryAfter || 0);
      if (retryAfter > 0) setRetryAt(Date.now() + retryAfter * 1000);
      if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다. 다시 시도해 주세요.');
      if (action === 'send') {
        setChallenge({ challengeId: result.challengeId, expiresAt: result.expiresAt, phone: requestedPhone });
        setToken('');
        setCode('');
        setMessage('문자 발송을 요청했습니다. 수신한 인증번호를 5분 내에 입력해 주세요.');
      } else {
        setToken(result.verificationToken);
        setVerifiedUntil(result.expiresAt);
        setMessage('휴대폰 인증이 완료되었습니다.');
      }
    } catch (err) {
      if (requestedPhone !== phoneRef.current) return;
      setMessage(err instanceof Error ? err.message : '네트워크 상태를 확인해 주세요.');
      setError(true);
    } finally {
      setBusy(null);
      setNow(Date.now());
    }
  }

  return <>
    <button ref={buttonRef} type="button" className={className} data-clone-phone-verification="true"
      disabled={!/^010\d{8}$/.test(phone) || !!busy || cooldown > 0 || !!token} onClick={() => void request('send')}>
      {busy === 'send' ? '발송 중…' : cooldown > 0 ? `${cooldown}초 후` : challenge ? '재발송' : '인증번호 발송'}
    </button>
    <input type="hidden" name="phoneVerificationToken" value={token} />
    {(challenge || message) && <div data-clone-phone-verification="true" style={{ flexBasis: '100%' }} className="flex w-full flex-col gap-2 pt-1">
      {challenge && <div className="flex gap-2">
        <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="휴대폰 인증번호" placeholder="인증번호 6자리" value={code} disabled={!!token || !!busy}
          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        <button type="button" data-clone-phone-verification="true"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          disabled={code.length !== 6 || !!token || !!busy || now >= challenge.expiresAt} onClick={() => void request('verify')}>
          {token ? '인증 완료' : busy === 'verify' ? '확인 중…' : '인증 확인'}
        </button>
      </div>}
      <p role={error ? 'alert' : 'status'} aria-live="polite" className={`text-xs ${error ? 'text-red-600' : token ? 'text-green-700' : 'text-muted-foreground'}`}>
        {challenge && !token && now >= challenge.expiresAt ? '인증번호가 만료되었습니다. 다시 발송해 주세요.' : message}
      </p>
    </div>}
  </>;
}
