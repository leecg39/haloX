'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWorkspace } from '../WorkspaceProvider';
import { invokeEdgeEndpoint } from '@/lib/api/client';
import { ErrorState, LiveModal } from './LiveUI';
export function PortalAccount({ children }: { children: (id: string, workspace: string) => ReactNode }) {
  const { user, activeWorkspace, loading, error, reload } = useWorkspace();
  if (loading) return <p role="status">계정을 불러오는 중…</p>;
  if (error) return <ErrorState message={error} retry={reload} />;
  return user ? <div key={user.id}>{children(user.id, activeWorkspace.id)}</div> : <p>로그인이 필요합니다.</p>;
}
export type PortalCommand = (name: string, values: Record<string, unknown>) => Promise<Record<string, unknown>>;
export function usePortal<T>(kind: string, query = '') {
  const [data, setData] = useState<T>(), [loading, setLoading] = useState(true), [error, setError] = useState(''), generation = useRef(0);
  const reload = useCallback(async () => { const current = ++generation.current; setLoading(true); setError(''); try { const response = await fetch(`/api/v1/portal?kind=${kind}${query}`), body = await response.json(); if (!response.ok) throw new Error(body.error || '조회 실패'); if (current === generation.current) setData(body); } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); } finally { if (current === generation.current) setLoading(false); } }, [kind, query]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const command: PortalCommand = async (name, values) => { try { return await invokeEdgeEndpoint(name, values); } finally { await reload(); } };
  return { data, loading, error, reload, command };
}
export function PortalModal({ name, command, values, onSaved, ...props }: { name: string; command: PortalCommand; values: (form: FormData) => Record<string, unknown>; onSaved?: (result: Record<string, unknown>) => void } & Omit<Parameters<typeof LiveModal>[0], 'onSave'>) {
  const request = useRef<{ signature: string; key: string } | null>(null);
  return <LiveModal {...props} description={props.description || '입력한 내용을 저장합니다.'} onSave={async form => { const payload = values(form); if (name.endsWith('-create')) { const signature = JSON.stringify(payload); if (!request.current || request.current.signature !== signature) request.current = { signature, key: crypto.randomUUID() }; payload.idempotency_key = request.current.key; } const result = await command(name, payload); onSaved?.(result); }} />;
}
export const portalDate = (value: unknown) => value ? String(value).slice(0, 16).replace('T', ' ') + ' UTC' : '—';
