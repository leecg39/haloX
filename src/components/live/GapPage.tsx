'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultAnalysisFilters } from '@/lib/api/analyses';
import { CANDIDATE_STATUS, GAP_STATES, type GapData } from '@/lib/api/gaps';
import type { ContentRow as Row } from '@/lib/api/content';
import { invokeEdgeEndpoint } from '@/lib/api/client';
import { LibraryWorkspace, text } from './LibraryShared';
import { EmptyState, ErrorState, downloadCsv } from './LiveUI';
import { AnalysisDomains, AnalysisFilterFields, AnalysisPager, AnalysisSampleList, AnalysisTrend, analysisNumber } from './AnalysisViews';
import { GapForms, type GapEdit } from './GapForms';

export function GapPage() { return <LibraryWorkspace>{(id, name) => <GapWorkspace key={id} workspaceId={id} workspaceName={name} />}</LibraryWorkspace>; }
function GapWorkspace({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [filters, setFilters] = useState(defaultAnalysisFilters), [draft, setDraft] = useState(defaultAnalysisFilters), [data, setData] = useState<GapData>();
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [message, setMessage] = useState(''), [edit, setEdit] = useState<GapEdit>(), [tab, setTab] = useState('overview'), generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try { const response = await fetch(`/api/v1/gaps?${new URLSearchParams({ workspace_id: workspaceId, filters: JSON.stringify(filters) })}`), body = await response.json(); if (!response.ok) throw new Error(body.error || '기회 분석을 불러오지 못했습니다.'); if (request === generation.current) setData(body); }
    catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId, filters]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const command = async (name: string, values: Record<string, unknown>) => {
    setMessage('');
    try { const result = await invokeEdgeEndpoint<Record<string, unknown>>(name, { ...values, workspace_id: workspaceId }); if (name === 'candidate-generate') setMessage(`후보 ${result.created_count}개를 저장했습니다. 이미 있는 후보 ${result.existing_count}개는 유지했습니다.`); return result; }
    finally { await reload(); }
  };
  return <div className="live live-analysis-page"><header className="live-head"><div><h1>기회 분석</h1><p>{workspaceName} · 검색과 연결 질문의 노출 차이를 검토합니다.</p></div><div className="live-actions"><button disabled={loading} onClick={() => void reload()}>새로고침</button><button disabled={!data} onClick={() => setEdit({ kind: 'generate' })}>수집 자료에서 후보 생성</button><button disabled={!data} className="primary" onClick={() => setEdit({ kind: 'candidate' })}>후보 추가</button></div></header>
    <p className="muted">검색/AI 수집에는 데모 Provider가 포함됩니다. 근거가 없는 항목은 측정 자료 부족으로 표시하며 예상 성과 점수를 만들지 않습니다.</p>
    <details className="live-card live-section"><summary>분석 조건 · {filters.start} ~ {filters.end}</summary><p className="muted">세트·태그·검색어·추적 상태는 키워드를 선택합니다. 연결 질문은 같은 언어·국가·기간의 수집 자료를 사용합니다. 후보/판단 기록은 별도 목록 필터를 사용합니다.</p><form onSubmit={e => { e.preventDefault(); setFilters({ ...draft }); }}><AnalysisFilterFields kind="seo" value={draft} onChange={setDraft} sets={data?.seo.sets || []} tags={data?.seo.tags || []} /><div className="live-actions"><button type="submit" className="primary">조건 적용</button><button type="button" onClick={() => { const next = defaultAnalysisFilters(); setDraft(next); setFilters(next); }}>조건 초기화</button></div></form></details>
    {error && <ErrorState message={error} retry={() => void reload()} />}{loading && <p role="status">기회 자료를 불러오는 중…</p>}{message && <p role="status" className="live-status">{message}</p>}
    <nav className="live-tabs" aria-label="기회 분석 보기">{[['overview', '개요'], ['matrix', '매트릭스'], ['keywords', '키워드'], ['prompts', '프롬프트'], ['competitors', '경쟁사'], ['content', '콘텐츠'], ['trend', '트렌드'], ['candidates', '검토 후보'], ['history', '판단 기록']].map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {data && !loading && !error && <>
      {tab === 'overview' && <><div className="live-kpis">{Object.entries(GAP_STATES).map(([key, label]) => <div className="live-card" key={key}>{label}<strong>{data.matrix.filter(row => row.state === key).length}개</strong></div>)}</div><p className="muted">검색 노출: 수집 엔진 중 자사 Top 10이 하나 이상. AI 노출: 연결 질문·엔진별 최신 표본 중 자사 인용이 하나 이상. 양쪽에 측정 자료가 있어야 미노출을 판정합니다.</p><GapMatrix data={data} /></>}
      {tab === 'matrix' && <GapMatrix data={data} />}{tab === 'keywords' && <AnalysisSampleList data={data.seo} rows={data.seo.latest} />}{tab === 'prompts' && <AnalysisSampleList data={data.geo} rows={data.geo.latest} />}
      {tab === 'competitors' && <><AnalysisDomains data={data.seo} competitors /><AnalysisDomains data={data.geo} competitors /></>}
      {tab === 'content' && <section><h2>키워드와 같은 주제의 콘텐츠</h2><p className="muted">현재 제작소 작업의 대상 키워드 문구가 같은 항목을 표시합니다. 언어·품질·게시 여부가 일치한다는 의미는 아닙니다.</p><AnalysisPager rows={data.matrix}>{rows => <div className="live-history">{rows.map(row => <article className="live-card" key={row.id}><Link href={`/app/keywords/${row.id}`}>{row.text}</Link>{row.content_ids.length ? <ul>{row.content_ids.map(id => <li key={id}><Link href={`/app/factory/${id}`}>{text(data.content_jobs.find(job => job.id === id)?.title) || '콘텐츠 작업'}</Link></li>)}</ul> : <p>동일한 주제의 콘텐츠 작업이 없습니다.</p>}</article>)}</div>}</AnalysisPager>{!data.matrix.length && <EmptyState>분석할 키워드가 없습니다.</EmptyState>}</section>}
      {tab === 'trend' && <><h2>검색 추이</h2><AnalysisTrend data={data.seo} /><h2 className="live-section">AI 질문 추이</h2><AnalysisTrend data={data.geo} /></>}
      {tab === 'candidates' && <CandidateList data={data} edit={setEdit} />}
      {tab === 'history' && <section><h2>후보 판단 기록</h2>{!data.decisions.length ? <EmptyState>저장한 판단 기록이 없습니다.</EmptyState> : <AnalysisPager rows={data.decisions}>{rows => <div className="live-history">{rows.map(row => <article className="live-card" key={row.id}><h3>{text((row.candidate_snapshot as Row)?.text)}</h3><p>{CANDIDATE_STATUS[text(row.action) as keyof typeof CANDIDATE_STATUS]} · {text(row.created_at).slice(0, 19).replace('T', ' ')} UTC</p><p className="live-preserve">{text(row.notes) || '메모 없음'}</p><div className="live-actions"><button onClick={() => setEdit({ kind: 'decision', row })}>판단 메모 수정</button><button className="danger" onClick={() => setEdit({ kind: 'delete-decision', row })}>판단 기록 삭제</button></div></article>)}</div>}</AnalysisPager>}</section>}
    </>}
    {edit && data && <GapForms edit={edit} data={data} command={command} onClose={() => setEdit(undefined)} />}
  </div>;
}
function GapMatrix({ data }: { data: GapData }) {
  const [state, setState] = useState(''), rows = data.matrix.filter(row => !state || row.state === state);
  return <section className="live-section"><div className="live-head"><h2>키워드별 검색·AI 노출</h2><div className="live-actions"><select aria-label="갭 유형" value={state} onChange={e => setState(e.target.value)}><option value="">모든 유형</option>{Object.entries(GAP_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button disabled={!rows.length} onClick={() => downloadCsv('gap-matrix.csv', [['키워드', '언어', '국가', '유형', '최상위 자사 순위', '검색 측정', '연결 질문', '인용 질문·엔진', '측정 질문·엔진'], ...rows.map(row => [row.text, row.language, row.country, GAP_STATES[row.state], row.rank, row.search_measured, row.prompt_count, row.cited, row.measured])])}>갭 CSV</button></div></div>{!rows.length ? <EmptyState>해당 유형의 키워드가 없습니다.</EmptyState> : <AnalysisPager rows={rows}>{visible => <div className="live-table"><table><thead><tr><th>키워드</th><th>유형</th><th>최상위 자사 순위</th><th>연결 질문</th><th>인용 / 측정 질문·엔진</th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td className="live-prompt-cell"><Link href={`/app/keywords/${row.id}`}>{row.text}</Link><small>{row.language}/{row.country}</small></td><td>{GAP_STATES[row.state]}</td><td>{row.rank === null && row.search_measured ? '수집 범위 내 없음' : analysisNumber(row.rank, '위')}</td><td>{row.prompt_count}</td><td>{row.measured ? `${row.cited} / ${row.measured}` : '미측정'}</td></tr>)}</tbody></table></div>}</AnalysisPager>}</section>;
}
function CandidateList({ data, edit }: { data: GapData; edit: (value: GapEdit) => void }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [kind, setKind] = useState('');
  const rows = data.candidates.filter(row => (!status || row.status === status) && (!kind || row.kind === kind) && `${row.text} ${row.notes}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => ['high', 'normal', 'low'].indexOf(text(a.priority)) - ['high', 'normal', 'low'].indexOf(text(b.priority)));
  return <section><div className="live-toolbar"><input aria-label="후보 검색" placeholder="후보 문구·메모 검색" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="후보 상태" value={status} onChange={e => setStatus(e.target.value)}><option value="">모든 상태</option>{Object.entries(CANDIDATE_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="후보 유형 필터" value={kind} onChange={e => setKind(e.target.value)}><option value="">모든 유형</option><option value="keyword">키워드</option><option value="prompt">질문</option></select><small>{rows.length}개</small></div>{!rows.length ? <EmptyState>조건에 맞는 후보가 없습니다. 직접 추가하거나 수집 자료에서 생성해 주세요.</EmptyState> : <AnalysisPager key={`${status}:${kind}:${query}`} rows={rows}>{visible => <div className="live-history">{visible.map(row => {
    const destination = (row.kind === 'keyword' ? data.keywords : data.prompts).find(item => item.id === row.destination_id);
    return <article className="live-card" key={row.id}><h3>{text(row.text)}</h3><p>{row.kind === 'keyword' ? '키워드' : '질문'} · {text(row.language)}/{text(row.country)} · {CANDIDATE_STATUS[text(row.status) as keyof typeof CANDIDATE_STATUS]} · 우선순위 {{ high: '높음', normal: '보통', low: '낮음' }[text(row.priority)]}</p><p className="live-preserve">{text(row.notes)}</p><details><summary>후보 근거</summary><p>{row.origin === 'serp-related' ? '저장한 연관 검색어' : row.origin === 'serp-paa' ? '저장한 추가 질문(PAA)' : '직접 등록'}</p>{row.evidence ? <p>{text((row.evidence as Row).keyword)} · {text((row.evidence as Row).captured_at)} · {text((row.evidence as Row).provider)}</p> : <p>외부 근거를 첨부하지 않았습니다.</p>}</details>
      <div className="live-actions">{row.status === 'pending' && <button onClick={() => edit({ kind: 'adopt', row })}>채택하여 등록</button>}{row.status !== 'accepted' && <button onClick={() => edit({ kind: 'status', row })}>{row.status === 'dismissed' ? '검토 재개' : '보류'}</button>}<button onClick={() => edit({ kind: 'candidate', row })}>후보 편집</button><button className="danger" onClick={() => edit({ kind: 'delete', row })}>후보 삭제</button>{row.status === 'accepted' && (destination ? <Link href={row.kind === 'keyword' ? `/app/keywords/${destination.id}` : `/app/geo/prompts/${destination.id}`}>등록 항목 보기 →</Link> : <span>등록했던 항목이 삭제되었습니다.</span>)}</div></article>;
  })}</div>}</AnalysisPager>}</section>;
}
