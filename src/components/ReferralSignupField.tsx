'use client';
export function ReferralSignupField({ code }: { code: string }) {
  return <label className="hx-referral-signup">추천 코드 (선택)<input name="referralCode" data-optional="true" maxLength={18} defaultValue={code} autoComplete="off" /><small>추천 링크의 코드가 표시됩니다. 사용하지 않으려면 지워 주세요.</small></label>;
}
