'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { accountRequest } from './AccountSecurityForms';
import { writeActiveWorkspace } from '@/lib/api/workspace';
import './live/live.css';
export function WorkspaceInvitePage() {
  const [token, setToken] = useState(''), [user, setUser] = useState(''), [preview, setPreview] = useState<{ workspace: { id: string; name: string }; email: string; role: string }>(), [error, setError] = useState(''), [pending, setPending] = useState(false);
  useEffect(() => { setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || ''); }, []);
  async function inspect() {
    setPending(true); setError(''); setPreview(undefined);
    try { const response = await fetch('/api/v1/auth'); if (!response.ok) throw new Error(response.status === 401 ? '초대받은 이메일 계정으로 먼저 로그인해 주세요.' : '계정 정보를 불러오지 못했습니다.'); const session = await response.json(); setUser(session.user.email); setPreview(await accountRequest<Record<string, unknown>>('/api/v1/workspace-management', { action: 'invite-preview', token }) as typeof preview); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '초대를 확인하지 못했습니다.'); } finally { setPending(false); }
  }
  async function accept() { setPending(true); setError(''); try { const result = await accountRequest<Record<string, unknown>>('/api/v1/workspace-management', { action: 'invite-accept', token }), workspace = result.workspace as { id: string; name: string; domain: string }; window.history.replaceState(null, '', '/app/invite'); writeActiveWorkspace({ ...workspace, plan: '' }); window.location.assign('/app'); } catch (cause) { setError(cause instanceof Error ? cause.message : '참여하지 못했습니다.'); } finally { setPending(false); } }
  return <main className="clone-surface live account-recovery"><section className="live-card"><h1>워크스페이스 초대</h1><p>초대받은 이메일 계정으로 로그인하고 초대 내용을 확인해 주세요.</p><p><Link href="/app/login" target="_blank" rel="noopener noreferrer">새 탭에서 로그인</Link> · <Link href="/app/signup" target="_blank" rel="noopener noreferrer">회원가입</Link></p><p className="muted">로그인을 마치면 이 탭으로 돌아와 초대 확인을 누르세요.</p>{!token && <p role="alert">초대 링크가 없습니다. 받은 링크를 다시 열어 주세요.</p>}{user && <p>현재 계정: {user}</p>}<button disabled={!token || pending} onClick={() => void inspect()}>초대 확인</button>{error && <p role="alert" className="live-error">{error}</p>}{preview && <><h2>{preview.workspace.name}</h2><p>{preview.email} · {preview.role === 'admin' ? '관리자' : '멤버'} 권한</p><button className="primary" disabled={pending} onClick={() => void accept()}>초대 수락하고 참여</button></>}</section></main>;
}
