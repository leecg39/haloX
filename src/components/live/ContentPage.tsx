'use client';

import { ProviderNotice } from './ProviderNotice';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTENT_STATUS, CONTENT_TABLES, type ContentData, type ContentRow as Row } from '@/lib/api/content';
import { invokeEdgeEndpoint } from '@/lib/api/client';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';
import { LibraryWorkspace, text } from './LibraryShared';
import { ContentReferences, GenerationFields } from './ContentForms';
import { ContentEditor } from './ContentEditor';

export type ContentResult = { job: Row; draft: Row };
export function ContentPage({ jobId }: { jobId?: string }) {
  return <LibraryWorkspace>{(id, name) => <ContentWorkspace key={id} workspaceId={id} workspaceName={name} jobId={jobId} />}</LibraryWorkspace>;
}

function ContentWorkspace({ workspaceId, workspaceName, jobId }: { workspaceId: string; workspaceName: string; jobId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<ContentData>(() => Object.fromEntries(CONTENT_TABLES.map(name => [name, []])) as unknown as ContentData);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [sort, setSort] = useState('updated'), [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false), [deleting, setDeleting] = useState<Row>();
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const response = await fetch(`/api/v1/content?${new URLSearchParams({ workspace_id: workspaceId })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '콘텐츠를 불러오지 못했습니다.');
      if (request === generation.current) { setData(body); setLoaded(true); return body as ContentData; }
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '콘텐츠를 불러오지 못했습니다.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const command = async (name: string, payload: Record<string, unknown>) => {
    const result = await invokeEdgeEndpoint<ContentResult>(name, { ...payload, workspace_id: workspaceId });
    await reload(); return result;
  };
  const job = data.content_jobs.find(row => row.id === jobId);
  const filtered = data.content_jobs.filter(row => (!status || (row.status || 'draft') === status) && `${row.title} ${row.target_keyword}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => sort === 'title' ? text(a.title).localeCompare(text(b.title), 'ko') : text(b[sort === 'created' ? 'created_at' : 'updated_at']).localeCompare(text(a[sort === 'created' ? 'created_at' : 'updated_at'])));
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), currentPage = Math.min(page, pages);
  return <div className="live">
    <header className="live-head"><div><h1>콘텐츠 제작소</h1><p>{workspaceName} · 본문과 검색 메타 정보를 버전으로 보관합니다.</p></div><div className="live-actions"><button onClick={() => void reload()} disabled={loading}>새로고침</button>{!jobId && <button className="primary" onClick={() => setCreating(true)} disabled={!loaded}>새 콘텐츠 만들기</button>}</div></header>
    <ProviderNotice service="openai" />
    {error && <ErrorState message={error} retry={reload} />}{loading && <p role="status">콘텐츠를 불러오는 중…</p>}
    {jobId ? <>
      <Link href="/app/factory">← 콘텐츠 목록</Link>
      {job ? <ContentEditor key={job.id} job={job} data={data} command={command} onLoadLatest={async () => {
        const fresh = await reload(), freshJob = fresh?.content_jobs.find(row => row.id === jobId), freshDraft = fresh?.content_drafts.find(row => row.content_job_id === jobId && row.is_selected);
        if (!freshJob || !freshDraft) throw new Error('최신 콘텐츠를 불러오지 못했습니다. 다시 시도해 주세요.');
        return { job: freshJob, draft: freshDraft };
      }} onDelete={() => setDeleting(job)} /> : loaded && <EmptyState>콘텐츠를 찾을 수 없습니다. 현재 워크스페이스를 확인해 주세요.</EmptyState>}
    </> : <>
      <div className="live-kpis"><div className="live-card"><small>전체 콘텐츠</small><strong>{data.content_jobs.length}</strong></div>{Object.entries(CONTENT_STATUS).map(([value, label]) => <div className="live-card" key={value}><small>{label}</small><strong>{data.content_jobs.filter(row => (row.status || 'draft') === value).length}</strong></div>)}</div>
      <div className="live-toolbar"><input aria-label="콘텐츠 검색" placeholder="제목 또는 주제 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /><select aria-label="작업 상태 필터" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">모든 상태</option>{Object.entries(CONTENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="콘텐츠 정렬" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="updated">최근 수정순</option><option value="created">최근 생성순</option><option value="title">제목순</option></select><small>{filtered.length}개</small></div>
      {loaded && !filtered.length ? <EmptyState>{data.content_jobs.length ? '검색 결과가 없습니다.' : '첫 콘텐츠를 만들어 보세요. 직접 작성하거나 AI 초안을 생성할 수 있습니다.'}</EmptyState> : <div className="live-table"><table><thead><tr><th>콘텐츠 / 주제</th><th>상태</th><th>현재 버전</th><th>수정일</th><th>작업</th></tr></thead><tbody>{filtered.slice((currentPage - 1) * 10, currentPage * 10).map(row => {
        const draft = data.content_drafts.find(item => item.content_job_id === row.id && item.is_selected);
        return <tr key={row.id}><td className="live-prompt-cell"><Link href={`/app/factory/${row.id}`}>{text(row.title)}</Link><small>{text(row.target_keyword)}</small></td><td>{CONTENT_STATUS[(row.status || 'draft') as keyof typeof CONTENT_STATUS]}</td><td>{draft ? `v${draft.version}` : '없음'}</td><td>{text(row.updated_at).slice(0, 10)}</td><td><button className="danger" onClick={() => setDeleting(row)}>삭제</button></td></tr>;
      })}</tbody></table></div>}
      {pages > 1 && <div className="live-pagination"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {pages}</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</button></div>}
    </>}
    {creating && <NewContent data={data} onClose={() => setCreating(false)} onSave={async (name, values) => { const result = await command(name, values); router.push(`/app/factory/${result.job.id}`); }} />}
    {deleting && <LiveModal title="콘텐츠 삭제" submit="삭제" description={`“${text(deleting.title)}”의 모든 본문 버전과 구성, 연결된 최적화 이력을 삭제합니다. 이 작업은 되돌릴 수 없습니다.`} onClose={() => setDeleting(undefined)} onSave={async () => { await command('content-delete', { job_id: deleting.id, expected_revision: Number(deleting.revision || 0) }); if (jobId) router.push('/app/factory'); }} />}
  </div>;
}

function NewContent({ data, onSave, onClose }: { data: ContentData; onSave: (name: string, values: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const [mode, setMode] = useState('manual');
  const requestId = useRef(crypto.randomUUID());
  return <LiveModal title="새 콘텐츠 만들기" submit={mode === 'manual' ? '만들기' : '초안 생성'} description={mode === 'manual' ? '작성한 본문을 첫 버전으로 저장합니다. 생성 사용량을 차감하지 않습니다.' : '선택한 문체와 자료를 OpenAI로 전송하여 초안을 만듭니다. 생성 사용량 1회와 외부 API 비용이 발생합니다.'} onClose={onClose} onSave={async form => {
    const values = Object.fromEntries(form.entries());
    await onSave(mode === 'manual' ? 'content-create' : 'content-draft', { ...values, keyword_id: form.get('keyword_id') || null, geo_prompt_id: form.get('geo_prompt_id') || null, writing_style_profile_id: form.get('writing_style_profile_id') || null, knowledge_entity_ids: form.getAll('knowledge_entity_ids'), idempotency_key: requestId.current });
  }}>
    <label>작성 방법<select aria-label="작성 방법" value={mode} onChange={event => setMode(event.target.value)}><option value="manual">직접 작성</option><option value="generated">AI 초안 생성</option></select></label>
    <label>주제<input aria-label="주제" name="target_keyword" required maxLength={200} /></label><label>제목<input aria-label="제목" name="title" required={mode === 'manual'} maxLength={200} /></label>
    {mode === 'manual' ? <><label>본문 (Markdown)<textarea aria-label="본문 (Markdown)" name="content_md" required maxLength={100000} rows={8} /></label><label>원문 URL (선택)<input aria-label="원문 URL (선택)" type="url" name="source_url" maxLength={2000} /></label></> : <GenerationFields data={data} />}
    <ContentReferences data={data} />
  </LiveModal>;
}
