'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultAnalysisFilters, type AnalysisData, type AnalysisFilters, type AnalysisKind } from '@/lib/api/analyses';
import type { ContentRow as Row } from '@/lib/api/content';
import { invokeEdgeEndpoint } from '@/lib/api/client';
import { LibraryWorkspace, text } from './LibraryShared';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';
import { AnalysisDomains, AnalysisEngines, AnalysisFilterFields, AnalysisKpis, AnalysisMatrix, AnalysisPager, AnalysisSampleList, AnalysisTrend } from './AnalysisViews';

type Edit = { row?: Row; deleting?: boolean };
export function AnalysesPage({ kind, initialTab }: { kind: AnalysisKind; initialTab?: string }) {
  return <LibraryWorkspace>{(id, name) => <AnalysesWorkspace key={`${id}:${kind}`} workspaceId={id} workspaceName={name} kind={kind} initialTab={initialTab} />}</LibraryWorkspace>;
}
function AnalysesWorkspace({ workspaceId, workspaceName, kind, initialTab }: { workspaceId: string; workspaceName: string; kind: AnalysisKind; initialTab?: string }) {
  const [applied, setApplied] = useState(defaultAnalysisFilters), [draft, setDraft] = useState(defaultAnalysisFilters), [data, setData] = useState<AnalysisData>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [edit, setEdit] = useState<Edit>(), generation = useRef(0);
  const tabs = kind === 'seo' ? [['overview', '개요'], ['performance', '성과'], ['competitors', '경쟁 도메인'], ['opportunities', '기회'], ['aio', 'AIO'], ['matrix', 'SERP 매트릭스'], ['saved', '저장 분석']] : [['overview', '개요'], ['prompts', '프롬프트'], ['mentions', '멘션'], ['sources', '인용 소스'], ['matrix', '인용 매트릭스'], ['competitors', '경쟁사'], ['platforms', '플랫폼'], ['saved', '저장 분석']];
  const [tab, setTab] = useState(tabs.some(([key]) => key === initialTab) ? initialTab! : 'overview');
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try { const response = await fetch(`/api/v1/analyses?${new URLSearchParams({ workspace_id: workspaceId, kind, filters: JSON.stringify(applied) })}`), body = await response.json(); if (!response.ok) throw new Error(body.error || '분석을 불러오지 못했습니다.'); if (request === generation.current) setData(body); }
    catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId, kind, applied]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const apply = (value: AnalysisFilters) => { setDraft({ ...value }); setApplied({ ...value }); };
  const command = async (name: string, values: Record<string, unknown>) => { try { return await invokeEdgeEndpoint(name, { ...values, workspace_id: workspaceId }); } finally { await reload(); } };
  return <div className="live live-analysis-page"><header className="live-head"><div><h1>{kind === 'seo' ? '키워드 분석' : '프롬프트 분석'}</h1><p>{workspaceName} · 수집 자료에서 집계한 분석</p></div><div className="live-actions"><button disabled={loading} onClick={() => void reload()}>새로고침</button><button disabled={!data || !!error || loading} className="primary" onClick={() => setEdit({})}>현재 분석 저장</button></div></header>
    <p className="muted">현재 수집에는 데모 Provider가 포함되어 실제 시장 성과를 의미하지 않습니다. 값이 없는 자료는 미측정으로 표시합니다. 날짜는 UTC 기준입니다.</p>
    <form className="live-card live-section" onSubmit={e => { e.preventDefault(); apply(draft); }}><AnalysisFilterFields kind={kind} value={draft} onChange={setDraft} sets={data?.sets || []} tags={data?.tags || []} /><div className="live-actions"><button type="submit" className="primary">조건 적용</button><button type="button" onClick={() => apply(defaultAnalysisFilters())}>조건 초기화</button></div></form>
    {error && <ErrorState message={error} retry={() => void reload()} />}{loading && <p role="status">분석을 불러오는 중…</p>}
    <nav className="live-tabs" aria-label="분석 보기">{tabs.map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === 'saved' && data ? <section><h2>저장한 분석 조건</h2><p className="muted">이름·조건·메모를 저장합니다. 불러올 때 현재 원본으로 다시 계산하며 과거 결과 스냅샷을 고정하지 않습니다.</p>{!data.saved.length ? <EmptyState>저장한 분석이 없습니다.</EmptyState> : <AnalysisPager rows={data.saved}>{rows => <div className="live-history">{rows.map(row => <article className="live-card" key={row.id}><h3>{text(row.name)}</h3><p className="live-preserve">{text(row.notes)}</p><p>{text((row.filters as AnalysisFilters).start)} ~ {text((row.filters as AnalysisFilters).end)}</p><div className="live-actions"><button onClick={() => { apply(row.filters as AnalysisFilters); setTab('overview'); }}>불러오기</button><button onClick={() => setEdit({ row })}>분석 편집</button><button className="danger" onClick={() => setEdit({ row, deleting: true })}>분석 삭제</button></div></article>)}</div>}</AnalysisPager>}</section> : !error && !loading && data && <>
      <p className="muted">적용 기간 {data.filters.start} ~ {data.filters.end}. {kind === 'seo' ? '기간 내 키워드·엔진별 최신 표본을 집계합니다. 순위는 저장한 검색 결과 범위이며 평균에는 노출된 순위만 포함합니다. 검색량·난이도는 해당 수집 시점의 값입니다.' : '기간 내 완료 실행을 모두 집계합니다. 같은 질문을 반복 실행한 경우 각 실행이 표본에 포함됩니다. 자사 분류는 실행 당시 기준입니다.'} 현재 문구·언어·국가와 다른 기록 또는 미완료/날짜 미기록 {data.excluded_records}개는 제외했습니다.</p>
      {tab === 'overview' && <><AnalysisKpis data={data} /><AnalysisEngines data={data} /><AnalysisTrend key={kind} data={data} /><AnalysisMatrix data={data} /></>}
      {['performance', 'prompts', 'mentions'].includes(tab) && <AnalysisSampleList key={tab} data={data} rows={kind === 'seo' ? data.latest : data.samples} />}
      {tab === 'opportunities' && <><h2>추가 검토할 검색 기회</h2><p className="muted">비교 도메인이 수집 결과에 없거나 10위 밖인 표본입니다. 예상 성과 점수를 만들지 않습니다. 측정 누락은 기회로 분류하지 않습니다.</p><AnalysisSampleList data={data} rows={data.latest.filter(row => row.rank_measured && (row.rank === null || row.rank > 10))} /></>}
      {tab === 'aio' && <><h2>AI 요약 수집</h2><p className="muted">AIO 감지와 자사 인용은 별개입니다. 인용 도메인 자료가 없으면 인용 여부는 미측정입니다.</p><AnalysisSampleList data={data} rows={data.latest.filter(row => row.aio_detected !== null)} /></>}
      {tab === 'matrix' && <AnalysisMatrix data={data} />}{tab === 'sources' && <AnalysisDomains data={data} />}{tab === 'competitors' && <AnalysisDomains data={data} competitors />}{tab === 'platforms' && <AnalysisEngines data={data} />}
    </>}
    {edit && <SavedAnalysisForm kind={kind} edit={edit} data={data} current={applied} command={command} onClose={() => setEdit(undefined)} />}
  </div>;
}
function SavedAnalysisForm({ kind, edit, data, current, command, onClose }: { kind: AnalysisKind; edit: Edit; data?: AnalysisData; current: AnalysisFilters; command: (name: string, values: Record<string, unknown>) => Promise<unknown>; onClose: () => void }) {
  const [filters, setFilters] = useState((edit.row?.filters as AnalysisFilters) || current), row = edit.row;
  return <LiveModal title={edit.deleting ? '저장 분석 삭제' : row ? '저장 분석 편집' : '분석 조건 저장'} description={edit.deleting ? '저장한 조건과 메모만 삭제합니다. 원본 키워드·질문·수집 결과는 유지됩니다.' : '날짜·세트·태그 등의 조건과 메모를 저장합니다. 측정값은 직접 변경하지 않습니다.'} submit={edit.deleting ? '삭제' : '저장'} onClose={onClose} onSave={async form => {
    await command(edit.deleting ? 'analysis-delete' : row ? 'analysis-update' : 'analysis-create', { kind, name: form.get('name'), notes: form.get('notes'), filters, ...(row ? { analysis_id: row.id, expected_revision: row.revision } : {}) });
  }}>{edit.deleting ? <p>{text(row?.name)}</p> : <><label>분석 이름<input name="name" aria-label="분석 이름" required maxLength={100} defaultValue={text(row?.name)} /></label><label>분석 메모<textarea name="notes" aria-label="분석 메모" maxLength={5000} defaultValue={text(row?.notes)} /></label><AnalysisFilterFields kind={kind} value={filters} onChange={setFilters} sets={data?.sets || []} tags={data?.tags || []} /></>}</LiveModal>;
}
