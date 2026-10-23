'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OPTIMIZATION_TABLES, REVIEW_STATUS, type OptimizationData } from '@/lib/api/optimization';
import type { ContentRow as Row } from '@/lib/api/content';
import { invokeEdgeEndpoint } from '@/lib/api/client';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';
import { LibraryWorkspace, text } from './LibraryShared';
import { OptimizationDetail } from './OptimizationDetail';

export type ReviewCommand = (name: string, payload: Record<string, unknown>) => Promise<{ review_run: Row }>;
export function OptimizationPage({ reviewId, initialJobId }: { reviewId?: string; initialJobId?: string }) {
  return <LibraryWorkspace>{(id, name) => <OptimizationWorkspace key={id} workspaceId={id} workspaceName={name} reviewId={reviewId} initialJobId={initialJobId} />}</LibraryWorkspace>;
}

function OptimizationWorkspace({ workspaceId, workspaceName, reviewId, initialJobId }: { workspaceId: string; workspaceName: string; reviewId?: string; initialJobId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<OptimizationData>(() => Object.fromEntries(OPTIMIZATION_TABLES.map(name => [name, []])) as unknown as OptimizationData);
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  const [creating, setCreating] = useState(Boolean(initialJobId)), [deleting, setDeleting] = useState<Row>();
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const response = await fetch(`/api/v1/optimization?${new URLSearchParams({ workspace_id: workspaceId })}`), body = await response.json();
      if (!response.ok) throw new Error(body.error || '최적화 작업을 불러오지 못했습니다.');
      if (request === generation.current) { setData(body); setLoaded(true); }
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '조회하지 못했습니다.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const command: ReviewCommand = async (name, values) => { const result = await invokeEdgeEndpoint<{ review_run: Row }>(name, { ...values, workspace_id: workspaceId }); await reload(); return result; };
  const run = data.content_review_runs.find(row => row.id === reviewId);
  const rows = data.content_review_runs.filter(row => (!status || row.status === status) && `${row.title || ''} ${row.url || ''} ${row.target_keyword || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages);
  return <div className="live"><header className="live-head"><div><h1>콘텐츠 최적화</h1><p>{workspaceName} · 원문을 보존하며 변경 제안을 검토하고 적용합니다.</p></div><div className="live-actions"><button disabled={loading} onClick={() => void reload()}>새로고침</button><button className="primary" disabled={!loaded} onClick={() => setCreating(true)}>새 최적화</button></div></header>
    <p className="muted">URL 가져오기는 실제 공개 원문을 읽습니다. 검색 참고와 제안 생성은 데모이며 실제 검색 성과를 예측하지 않습니다.</p>
    {error && <ErrorState message={error} retry={reload} />}{loading && <p role="status">최적화 작업을 불러오는 중…</p>}
    {reviewId ? <><div className="live-section"><Link href="/app/optimize">← 최적화 목록</Link></div>{run ? <OptimizationDetail key={run.id} run={run} data={data} command={command} onDelete={() => setDeleting(run)} /> : loaded && <EmptyState>최적화 작업을 찾을 수 없습니다. 현재 워크스페이스를 확인해 주세요.</EmptyState>}</> : <>
      <div className="live-toolbar"><input aria-label="최적화 검색" placeholder="제목·주제·URL 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /><select aria-label="최적화 상태 필터" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">모든 상태</option>{Object.entries(REVIEW_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>{rows.length}개</small></div>
      {loaded && !rows.length ? <EmptyState>{data.content_review_runs.length ? '검색 결과가 없습니다.' : '새 최적화에서 기존 콘텐츠, 공개 URL 또는 본문을 선택해 주세요.'}</EmptyState> : <div className="live-table"><table><thead><tr><th>최적화 / 주제</th><th>진행 단계</th><th>등록일</th><th>작업</th></tr></thead><tbody>{rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => <tr key={row.id}><td className="live-prompt-cell"><Link href={`/app/optimize/${row.id}`}>{text(row.title || row.target_keyword || '이전 데모 이력')}</Link><small>{text(row.target_keyword)}</small></td><td>{REVIEW_STATUS[text(row.status) as keyof typeof REVIEW_STATUS] || '이전 데모'}</td><td>{text(row.created_at).slice(0, 10)}</td><td><button className="danger" onClick={() => setDeleting(row)}>삭제</button></td></tr>)}</tbody></table></div>}
      {pages > 1 && <div className="live-pagination"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {pages}</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</button></div>}
    </>}
    {creating && loaded && <NewOptimization data={data} initialJobId={initialJobId} command={command} onClose={() => setCreating(false)} onCreated={id => router.push(`/app/optimize/${id}`)} />}
    {deleting && <LiveModal title="최적화 삭제" submit="삭제" description="진단과 제안 이력을 삭제합니다. 제작소의 원문과 적용·복원된 본문 버전은 유지됩니다." onClose={() => setDeleting(undefined)} onSave={async () => { await command('optimize-review-delete', { review_run_id: deleting.id, expected_revision: Number(deleting.revision || 0) }); if (reviewId) router.push('/app/optimize'); }} />}
  </div>;
}

function NewOptimization({ data, initialJobId, command, onClose, onCreated }: { data: OptimizationData; initialJobId?: string; command: ReviewCommand; onClose: () => void; onCreated: (id: string) => void }) {
  const [mode, setMode] = useState(initialJobId ? 'existing' : 'text'), [jobId, setJobId] = useState(initialJobId || data.content_jobs[0]?.id || '');
  const key = useRef(crypto.randomUUID());
  return <LiveModal title="새 최적화" submit="진단 시작" description="진단 시작 시 생성 사용량 1회를 사용합니다. URL·본문은 제작소에 원본 버전으로 보관됩니다. 제안 적용은 검토 후 직접 실행합니다." onClose={onClose} onSave={async form => {
    const job = data.content_jobs.find(row => row.id === jobId);
    const result = await command('optimize-audit-content', { ...Object.fromEntries(form.entries()), source_mode: mode, ...(mode === 'existing' ? { job_id: jobId, expected_content_revision: Number(job?.revision || 0) } : {}), idempotency_key: key.current });
    onCreated(result.review_run.id);
  }}>
    <label>원문 선택<select aria-label="원문 선택" value={mode} onChange={event => setMode(event.target.value)}><option value="text">본문 직접 입력</option><option value="url">공개 URL 가져오기</option><option value="existing">제작소 콘텐츠</option></select></label>
    {mode === 'existing' ? <label>콘텐츠<select aria-label="콘텐츠" value={jobId} onChange={event => setJobId(event.target.value)} required><option value="">선택해 주세요</option>{data.content_jobs.map(row => <option key={row.id} value={row.id}>{text(row.title)}</option>)}</select></label> : <><label>대상 주제<input aria-label="대상 주제" name="target_keyword" required maxLength={200} /></label><label>제목{mode === 'url' && ' (선택)'}<input aria-label="제목" name="title" required={mode === 'text'} maxLength={200} /></label>{mode === 'url' ? <><label>공개 URL<input aria-label="공개 URL" name="url" type="url" required maxLength={2000} /></label><small>로그인 없이 읽을 수 있는 HTML/텍스트를 최대 2MB까지 가져옵니다. JavaScript로만 표시되는 원문은 직접 입력해 주세요.</small></> : <label>원문 본문<textarea aria-label="원문 본문" name="content_md" required maxLength={100000} rows={8} /></label>}</>}
  </LiveModal>;
}
