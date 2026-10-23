'use client';

import { useWorkspace } from '../WorkspaceProvider';
import { canAccess, canWrite, routeSection, type Permission } from '@/lib/permissions/workspace';
import { readActiveWorkspace } from '@/lib/api/workspace';
import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactNode, type FormEvent } from 'react';
import './live.css';

export function LiveModal({ title, description, children, submit = '저장', onSave, onClose }: { title: string; description?: string; children?: ReactNode; submit?: string; onSave: (data: FormData) => Promise<void>; onClose: () => void }) {
  const { permission } = useWorkspace();
  const readOnly = typeof window !== 'undefined' && !!routeSection(window.location.pathname + window.location.search) && !canWrite(permission);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || readOnly) return;
    const data = new FormData(event.currentTarget);
    setPending(true); setError('');
    try { await onSave(data); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 다시 시도해 주세요.'); } finally { setPending(false); }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open && !pending) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="live-overlay" />
    <Dialog.Content className="live-modal live" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description || '입력한 내용은 현재 워크스페이스에 저장됩니다.'}</Dialog.Description>
      <form onSubmit={save}><fieldset disabled={pending || readOnly}>{children}</fieldset>
        {readOnly && <p role="status">읽기 전용 멤버는 저장하거나 실행할 수 없습니다.</p>}{error && <p className="live-error" role="alert">{error}</p>}
        <footer><button type="button" disabled={pending} onClick={onClose}>취소</button><button className="primary" disabled={pending || readOnly} type="submit">{pending ? '처리 중…' : submit}</button></footer>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function EmptyState({ children }: { children: ReactNode }) { return <p className="live-empty">{children}</p>; }
export function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="live-error" role="alert">{message} <button onClick={retry}>다시 불러오기</button></div>; }

export async function downloadCsv(filename: string, rows: unknown[][]) {
  try {
    const response = await fetch('/api/v1/auth');
    if (!response.ok) throw new Error('권한을 확인하지 못했습니다. 다시 로그인해 주세요.');
    const session = await response.json(), permission = session.permissions?.[readActiveWorkspace().id] as Permission | undefined;
    if (!permission || !canWrite(permission) || !canAccess(permission, routeSection(window.location.pathname + window.location.search))) throw new Error('현재 권한으로는 내려받을 수 없습니다.');
  } catch (cause) { window.alert(cause instanceof Error ? cause.message : '다운로드 권한 확인 실패'); return; }
  const csv = rows.map(row => row.map(value => {
    let text = String(value ?? '');
    // Spreadsheet formula injection protection for user-supplied values.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
