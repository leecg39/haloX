export async function submitSignup(form: HTMLFormElement, navigate: (url: string) => void, notify: (message: string) => void) {
  const value = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value || '';
  const verificationToken = value('phoneVerificationToken');
  if (!verificationToken) { notify('휴대폰 인증을 먼저 완료해 주세요.'); return; }
  if (value('password') !== value('passwordConfirm')) { notify('비밀번호 확인이 일치하지 않습니다.'); return; }
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.textContent = '가입 중…'; }
  try {
    const response = await fetch('/api/v1/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: value('name'), email: value('email'), password: value('password'), phone: form.querySelector<HTMLInputElement>('input[type="tel"]')?.value, verificationToken, referralCode: value('referralCode') }),
    });
    const result = await response.json();
    if (!response.ok) { notify(result.error || '가입하지 못했습니다. 다시 시도해 주세요.'); return; }
    navigate('/app/login?registered=1');
  } catch { notify('네트워크 상태를 확인하고 다시 시도해 주세요.'); }
  finally { if (button?.isConnected) { button.disabled = false; button.textContent = '가입하기'; } }
}
