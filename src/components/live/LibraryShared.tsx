'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LIBRARY_TABLES, type LibraryData, type LibraryRow as Row, type LibraryTable as Table } from '@/lib/api/library';
import { deleteTableRows, insertTableRows, invokeEdgeEndpoint, updateTableRows } from '@/lib/api/client';
import { useWorkspace } from '../WorkspaceProvider';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';

export const text = (value: unknown) => String(value ?? '');
export const safeUrl = (value: unknown) => /^https?:\/\//i.test(text(value)) ? text(value) : undefined;
export type LibraryEdit = { table: Table; row?: Row; parentId?: string };

export function LibraryWorkspace({ children }: { children: (id: string, name: string) => ReactNode }) {
  const workspace = useWorkspace();
  if (workspace.loading) return <div className="live" role="status">워크스페이스를 불러오는 중…</div>;
  if (workspace.error) return <div className="live"><ErrorState message={workspace.error} retry={workspace.reload} /></div>;
  if (!workspace.activeWorkspace.id) return <div className="live"><EmptyState>워크스페이스가 없습니다. <Link href="/app/workspaces">워크스페이스 만들기</Link></EmptyState></div>;
  return children(workspace.activeWorkspace.id, workspace.activeWorkspace.name);
}

export function useLibrary(workspaceId: string) {
  const [data, setData] = useState<LibraryData>(() => Object.fromEntries(LIBRARY_TABLES.map(table => [table, []])) as unknown as LibraryData);
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const response = await fetch(`/api/v1/library?${new URLSearchParams({ workspace_id: workspaceId })}`), body = await response.json();
      if (!response.ok) throw new Error(body.error || '자료를 불러오지 못했습니다.');
      if (generation.current === request) { setData(body); setLoaded(true); }
    } catch (cause) { if (generation.current === request) setError(cause instanceof Error ? cause.message : '조회하지 못했습니다.'); }
    finally { if (generation.current === request) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  async function action(work: () => Promise<unknown>, success = '저장했습니다.') {
    setBusy(true); setMessage('');
    try { await work(); await reload(); setMessage(success); } finally { setBusy(false); }
  }
  const run = (work: () => Promise<unknown>, success?: string) => { void action(work, success).catch(cause => setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.')); };
  const where = (row?: Row) => ({ workspace_id: `eq.${workspaceId}`, ...(row ? { id: `eq.${row.id}`, ...(row.updated_at ? { updated_at: `eq.${row.updated_at}` } : {}) } : {}) });
  async function save(table: Table, values: Record<string, unknown>, row?: Row) {
    const rows = row ? await updateTableRows<Row>(table, values, where(row)) : await insertTableRows<Row>(table, { ...values, workspace_id: workspaceId });
    if (!rows.length) throw new Error('다른 곳에서 변경되거나 삭제된 항목입니다. 다시 불러온 뒤 시도해 주세요.');
    return rows;
  }
  async function remove(table: Table, row: Row) {
    const rows = await deleteTableRows<Row>(table, where(row));
    if (!rows.length) throw new Error('다른 곳에서 변경되거나 삭제된 항목입니다.');
  }
  const notices = <>{error && <ErrorState message={error} retry={reload} />}{message && <p className="live-status" role="status">{message}</p>}{loading && <p role="status">데이터를 불러오는 중…</p>}</>;
  return { data, loading, loaded, busy, error, reload, action, run, save, remove, notices };
}

export function GenerateFromLibrary({ data, workspaceId, personaId, entityId, onClose, onComplete }: { data: LibraryData; workspaceId: string; personaId?: string; entityId?: string; onClose: () => void; onComplete: () => Promise<void> }) {
  return <LiveModal title="자료를 활용한 초안 생성" submit="초안 생성" description="데모 생성기가 선택한 문체와 자료를 초안에 포함합니다. 외부 AI 호출이나 자동 게시 없이 서버에 저장됩니다." onClose={onClose} onSave={async form => {
    await invokeEdgeEndpoint('content-draft', { workspace_id: workspaceId, target_keyword: form.get('target_keyword'), title: form.get('title'), writing_style_profile_id: form.get('writing_style_profile_id') || null, knowledge_entity_ids: form.getAll('knowledge_entity_ids'), idempotency_key: crypto.randomUUID() });
    await onComplete();
  }}>
    <label>주제<input name="target_keyword" aria-label="주제" required maxLength={200} /></label>
    <label>제목 (선택)<input name="title" aria-label="제목 (선택)" maxLength={200} /></label>
    <label>페르소나<select name="writing_style_profile_id" aria-label="페르소나" defaultValue={personaId || data.writing_style_profiles.find(row => row.is_default)?.id || ''}><option value="">사용 안 함</option>{data.writing_style_profiles.map(row => <option key={row.id} value={row.id}>{text(row.name)}</option>)}</select></label>
    <div><p>참조 자료</p><div className="live-checks">{data.knowledge_entities.map(row => <label className="check" key={row.id}><input type="checkbox" name="knowledge_entity_ids" value={row.id} defaultChecked={entityId === row.id} />{text(row.name)}</label>)}</div></div>
  </LiveModal>;
}

export function LibraryContentHistory({ data, jobs }: { data: LibraryData; jobs: Row[] }) {
  return <section className="live-section"><h2>이 항목으로 생성한 콘텐츠</h2>{!jobs.length ? <EmptyState>아직 생성한 콘텐츠가 없습니다.</EmptyState> : <div className="live-history">{jobs.map(job => <details key={job.id} className="live-card"><summary>{text(job.title)}</summary><Link href={`/app/factory/${job.id}`}>제작소에서 편집</Link><p className="muted">생성 당시의 문체와 자료를 보존한 데모 초안입니다.</p><pre className="live-answer">{text(data.content_drafts.find(draft => draft.content_job_id === job.id && draft.is_selected)?.content_md)}</pre></details>)}</div>}</section>;
}
