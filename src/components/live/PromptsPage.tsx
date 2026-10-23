'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteTableRows, insertTableRows, invokeEdgeEndpoint, updateTableRows } from '@/lib/api/client';
import { GEO_CATEGORIES, GEO_ENGINES, PROMPT_PAGE_TABLES, type PromptData, type PromptRow as Row, type PromptTable as Table } from '@/lib/api/prompts';
import { useWorkspace } from '../WorkspaceProvider';
import { downloadCsv, EmptyState, ErrorState, LiveModal } from './LiveUI';

type Data = PromptData & { scheduler_enabled?: boolean };
type Edit = { table: Table; row?: Row };
const str = (value: unknown) => String(value ?? '');
const date = (value: unknown) => value && Number.isFinite(Date.parse(str(value))) ? new Date(str(value)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';
const engineName = (value: unknown) => GEO_ENGINES[str(value) as keyof typeof GEO_ENGINES] || str(value);
const title: Partial<Record<Table, string>> = { geo_prompts: '프롬프트', geo_prompt_sets: '프롬프트 세트', geo_prompt_runs: '실행 이력', workspace_tags: '태그', workspace_tag_groups: '태그 그룹' };
const safeUrl = (value: unknown) => /^https?:\/\//i.test(str(value)) ? str(value) : undefined;

export function PromptsPage({ promptId, overview = false }: { promptId?: string; overview?: boolean }) {
  const workspace = useWorkspace();
  if (workspace.loading) return <div className="live" role="status">워크스페이스를 불러오는 중…</div>;
  if (workspace.error) return <div className="live"><ErrorState message={workspace.error} retry={workspace.reload} /></div>;
  if (!workspace.activeWorkspace.id) return <div className="live"><EmptyState>워크스페이스가 없습니다. <Link href="/app/workspaces">워크스페이스 만들기</Link></EmptyState></div>;
  return <PromptWorkspace key={workspace.activeWorkspace.id} workspaceId={workspace.activeWorkspace.id} workspaceName={workspace.activeWorkspace.name} promptId={promptId} overview={overview} />;
}

function PromptWorkspace({ workspaceId, workspaceName, promptId, overview }: { workspaceId: string; workspaceName: string; promptId?: string; overview: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Data>(() => Object.fromEntries(PROMPT_PAGE_TABLES.map(table => [table, [] as Row[]])) as PromptData);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('list');
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState('');
  const [engineFilter, setEngineFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [remove, setRemove] = useState<{ table: Table; rows: Row[] } | null>(null);
  const generation = useRef(0);
  const where = { workspace_id: `eq.${workspaceId}` };
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/v1/prompts?${new URLSearchParams({ workspace_id: workspaceId })}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '프롬프트를 불러오지 못했습니다.');
      if (request === generation.current) { setData(result); setLoaded(true); }
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  useEffect(() => { setPage(1); setSelected([]); }, [query, setFilter, engineFilter, statusFilter]);

  const runs = [...data.geo_prompt_runs].sort((a, b) => str(b.requested_at).localeCompare(str(a.requested_at)));
  const latest = new Map<string, Row>();
  for (const run of runs) {
    const prompt = data.geo_prompts.find(row => row.id === run.prompt_id);
    if (prompt && (!run.prompt_text || run.prompt_text === prompt.prompt_text) && (!run.language_code || run.language_code === prompt.language_code) && (!run.location_code || run.location_code === prompt.location_code) && (!engineFilter || run.engine === engineFilter) && !latest.has(`${run.prompt_id}:${run.engine}`)) latest.set(`${run.prompt_id}:${run.engine}`, run);
  }
  const metrics = (run?: Row) => data.geo_run_metrics.find(row => row.run_id === run?.id);
  const completed = [...latest.values()].filter(run => run.status === 'completed');
  const percent = (predicate: (row: Row) => boolean) => completed.length ? `${(100 * completed.filter(predicate).length / completed.length).toFixed(1)}%` : '—';
  const tags = (prompt: Row) => data.workspace_tags.filter(tag => data.geo_prompt_tag_assignments.some(link => link.prompt_id === prompt.id && link.tag_id === tag.id));
  const setName = (id: unknown) => str(data.geo_prompt_sets.find(set => set.id === id)?.name || '미분류');
  const configuredEngines = (row: Row) => Array.isArray(row.engines) && row.engines.length ? row.engines : [data.geo_prompt_sets.find(set => set.id === row.prompt_set_id)?.default_engine || 'openai'];
  const engineStatus = (prompt: Row, engine: string) => {
    const run = latest.get(`${prompt.id}:${engine}`);
    return !run ? '미실행' : run.status === 'failed' ? '실패' : run.status === 'running' ? '실행 중' : metrics(run)?.is_cited ? '자사 인용' : metrics(run)?.brand_mentioned ? '자사 언급' : '미노출';
  };
  const filtered = data.geo_prompts.filter(row => str(row.prompt_text).toLowerCase().includes(query.toLowerCase()) && (!setFilter || row.prompt_set_id === setFilter || (setFilter === 'none' && !row.prompt_set_id)) && (!statusFilter || (statusFilter === 'paused' ? row.is_paused : !row.is_paused)) && (!engineFilter || configuredEngines(row).includes(engineFilter))).sort((a, b) => sort === 'name' ? str(a.prompt_text).localeCompare(str(b.prompt_text), 'ko') : str(b.created_at).localeCompare(str(a.created_at)));
  const pages = Math.max(1, Math.ceil(filtered.length / 12)), current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * 12, current * 12);
  const detail = data.geo_prompts.find(row => row.id === promptId);

  async function action(work: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage('');
    try {
      const result = await work(); await reload();
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) throw new Error('일부 엔진 실행에 실패했습니다. 실행 이력에서 확인하고 다시 실행해 주세요.');
      setMessage(success);
    } finally { setBusy(false); }
  }
  const run = (work: () => Promise<unknown>, success: string) => { void action(work, success).catch(cause => setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.')); };
  async function patch(table: Table, row: Row, values: Record<string, unknown>) {
    const updated = await updateTableRows(table, values, { ...where, id: `eq.${row.id}`, ...(row.updated_at ? { updated_at: `eq.${row.updated_at}` } : {}) });
    if (!updated.length) throw new Error('다른 곳에서 변경되거나 삭제된 항목입니다. 새로고침 후 다시 시도해 주세요.');
  }
  async function save(form: FormData) {
    if (!edit) return;
    const { table, row } = edit;
    const values: Record<string, unknown> = Object.fromEntries([...form].filter(([key]) => !['tag_ids', 'engines'].includes(key)));
    if (table === 'geo_prompts') { values.prompt_set_id ||= null; values.engines = form.getAll('engines'); }
    if (table === 'geo_prompt_sets') { values.schedule_enabled = form.has('schedule_enabled'); values.is_active = form.has('is_active'); values.is_default = form.has('is_default'); values.schedule_hour = Number(form.get('schedule_hour')); }
    if (table === 'workspace_tags') values.group_id ||= null;
    await action(async () => {
      if (table === 'geo_prompts') {
        if (row) return invokeEdgeEndpoint('geo-save', { workspace_id: workspaceId, prompt_id: row.id, updated_at: row.updated_at, patch: values, tag_ids: form.getAll('tag_ids') });
        return invokeEdgeEndpoint('geo-run', { ...values, workspace_id: workspaceId, idempotency_key: crypto.randomUUID() });
      }
      if (row) return patch(table, row, values);
      return insertTableRows(table, { ...values, workspace_id: workspaceId });
    }, `${title[table]} 저장을 완료했습니다.`);
  }
  const execute = (row: Row, engine?: string) => run(() => invokeEdgeEndpoint('geo-run', { workspace_id: workspaceId, prompt_id: row.id, ...(engine ? { engine } : {}) }), '프롬프트 실행을 완료했습니다.');
  const pause = (row: Row) => run(() => patch('geo_prompts', row, { is_paused: !row.is_paused }), row.is_paused ? '예약 추적을 재개했습니다.' : '예약 추적을 일시정지했습니다.');
  const actions = (table: Table, row: Row) => <div className="live-actions">{table !== 'geo_prompt_runs' && <button disabled={busy} onClick={() => setEdit({ table, row })}>편집</button>}<button className="danger" disabled={busy} onClick={() => setRemove({ table, rows: [row] })}>삭제</button></div>;

  function history(items: Row[]) {
    return items.length ? <div className="live-history">{items.map(item => <details className="live-card" key={item.id}>
      <summary>{engineName(item.engine)} · {date(item.requested_at)} · {item.status === 'completed' ? '완료' : item.status === 'failed' ? '실패' : '실행 중'}{item.scheduled_for ? ' · 예약 실행' : ''}</summary>
      <p className="muted">질문: {str(item.prompt_text || data.geo_prompts.find(row => row.id === item.prompt_id)?.prompt_text)}</p>
      <p className="muted">{str(item.provider || 'deterministic')} · {str(item.model_name)} · 한국시간</p>
      {item.status === 'failed' ? <p className="live-error">{str(item.error_message)}</p> : <pre className="live-answer">{str(data.geo_answers_raw.find(answer => answer.run_id === item.id)?.answer_text || item.answer_text)}</pre>}
      <ul>{data.geo_citations.filter(citation => citation.run_id === item.id).map(citation => <li key={citation.id}><a href={safeUrl(citation.cited_url)} target="_blank" rel="noopener noreferrer">{str(citation.cited_url)}</a> <span className="live-badge">{citation.is_ours ? '자사' : citation.is_competitor ? '경쟁사' : '기타'}</span></li>)}</ul>
      <div className="live-toolbar">{actions('geo_prompt_runs', item)}{detail && <button disabled={busy} onClick={() => execute(detail, str(item.engine))}>이 엔진 다시 실행</button>}{!detail && <Link href={`/app/geo/prompts/${item.prompt_id}`}>프롬프트 상세 →</Link>}</div>
    </details>)}</div> : <EmptyState>실행 이력이 없습니다.</EmptyState>;
  }

  return <div className="live" aria-busy={busy || loading}>
    <div className="live-head"><div>{promptId && <Link className="muted" href="/app/geo/prompts">← 프롬프트 현황</Link>}<h1>{overview ? 'AI 대화 개요' : promptId ? '프롬프트 상세' : '프롬프트 현황'}</h1><p>{workspaceName} · AI 답변과 인용 근거를 관리합니다.</p></div><div className="live-actions"><button disabled={busy || loading} onClick={() => void reload()}>새로고침</button>{overview ? <Link href="/app/geo/prompts">프롬프트 관리 →</Link> : !promptId && <><button disabled={!loaded} onClick={() => downloadCsv('halox-prompts.csv', [['프롬프트', '세트', '국가', '언어', ...Object.values(GEO_ENGINES)], ...filtered.map(row => [row.prompt_text, setName(row.prompt_set_id), row.location_code, row.language_code, ...Object.keys(GEO_ENGINES).map(engine => engineStatus(row, engine))])])}>CSV 내보내기</button><button className="primary" disabled={busy || loading} onClick={() => setEdit({ table: 'geo_prompts' })}>프롬프트 추가</button></>}</div></div>
    <p className="muted">앱 실행기는 데모 Provider로 모의 답변과 인용을 생성합니다. 가져온 자료는 이력의 출처로 구분합니다. 예약은 서버 실행 중에 처리하며 시간은 한국시간 기준입니다.</p>
    {error && <ErrorState message={error} retry={reload} />}{message && <p className="live-status" role="status">{message}</p>}{loading && <p role="status">데이터를 불러오는 중…</p>}
    {loaded && (promptId ? detail ? <>
      <section className="live-card live-prompt-heading"><h2>{str(detail.prompt_text)}</h2><p className="muted">{setName(detail.prompt_set_id)} · {str(detail.location_code)} / {str(detail.language_code)} · {GEO_CATEGORIES[str(detail.prompt_category) as keyof typeof GEO_CATEGORIES]}</p><div>{tags(detail).map(tag => <span className="live-badge" key={tag.id} style={{ borderLeft: `3px solid ${tag.color}` }}>{str(tag.name)}</span>)}</div><div className="live-toolbar">{actions('geo_prompts', detail)}<button disabled={busy} onClick={() => pause(detail)}>{detail.is_paused ? '예약 추적 재개' : '예약 추적 일시정지'}</button><button disabled={busy} onClick={() => execute(detail)}>선택 엔진 실행</button></div></section>
      <div className="live-kpis">{Object.entries(GEO_ENGINES).map(([engine, name]) => <section className="live-card" key={engine}><small>{name}</small><strong>{engineStatus(detail, engine)}</strong><button disabled={busy} onClick={() => execute(detail, engine)}>실행</button></section>)}</div>
      <h2>답변·인용·실행 이력</h2>{history(runs.filter(row => row.prompt_id === promptId))}
    </> : <EmptyState>이 워크스페이스에서 프롬프트를 찾을 수 없습니다. <Link href="/app/geo/prompts">목록으로 이동</Link></EmptyState> : <>
      <div className="live-kpis">{[['전체 프롬프트', data.geo_prompts.length], ['누적 실행', runs.length], ['자사 언급률', percent(row => !!metrics(row)?.brand_mentioned)], ['자사 인용률', percent(row => !!metrics(row)?.is_cited)]].map(([name, value]) => <section className="live-card" key={name}><small>{name}</small><strong>{value}</strong></section>)}</div>
      {overview ? <><h2>최근 실행</h2>{history(runs.slice(0, 10))}</> : <>
        <nav className="live-tabs" aria-label="프롬프트 보기">{[['list', '리스트'], ['sets', '세트'], ['tags', '태그']].map(([value, name]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{name}</button>)}</nav>
        {tab === 'list' && <>
          <div className="live-toolbar"><input aria-label="프롬프트 검색" placeholder="프롬프트 검색…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="세트 필터" value={setFilter} onChange={event => setSetFilter(event.target.value)}><option value="">전체 세트</option><option value="none">미분류</option>{data.geo_prompt_sets.map(row => <option key={row.id} value={row.id}>{str(row.name)}</option>)}</select><select aria-label="엔진 필터" value={engineFilter} onChange={event => setEngineFilter(event.target.value)}><option value="">전체 엔진</option>{Object.entries(GEO_ENGINES).map(([engine, name]) => <option key={engine} value={engine}>{name}</option>)}</select><select aria-label="상태 필터" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">전체 상태</option><option value="active">추적 중</option><option value="paused">일시정지</option></select><select aria-label="정렬" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">최신순</option><option value="name">이름순</option></select></div>
          {!!selected.length && <div className="live-toolbar"><span>{selected.length}개 선택</span><button disabled={busy} onClick={() => setRemove({ table: 'geo_prompts', rows: data.geo_prompts.filter(row => selected.includes(row.id)) })}>선택 삭제</button></div>}
          {filtered.length ? <div className="live-table"><table><thead><tr><th><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={visible.length > 0 && visible.every(row => selected.includes(row.id))} onChange={event => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map(row => row.id)])] : selected.filter(id => !visible.some(row => row.id === id)))} /></th><th>프롬프트 / 세트</th><th>태그</th>{Object.entries(GEO_ENGINES).filter(([engine]) => !engineFilter || engine === engineFilter).map(([engine, name]) => <th key={engine}>{name}</th>)}<th>상태</th><th>작업</th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td><input type="checkbox" aria-label={`${row.prompt_text} 선택`} checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} /></td><td className="live-prompt-cell"><Link href={`/app/geo/prompts/${row.id}`}>{str(row.prompt_text)}</Link><small>{setName(row.prompt_set_id)} · {str(row.location_code)}</small></td><td>{tags(row).map(tag => <span key={tag.id} className="live-badge">{str(tag.name)}</span>)}</td>{Object.keys(GEO_ENGINES).filter(engine => !engineFilter || engine === engineFilter).map(engine => <td key={engine}>{engineStatus(row, engine)}</td>)}<td>{row.is_paused ? '일시정지' : '추적 중'}</td><td><div className="live-actions">{actions('geo_prompts', row)}<button disabled={busy} onClick={() => pause(row)}>{row.is_paused ? '재개' : '일시정지'}</button><button disabled={busy} onClick={() => execute(row)}>실행</button></div></td></tr>)}</tbody></table></div> : <EmptyState>{data.geo_prompts.length ? '조건에 맞는 프롬프트가 없습니다.' : '등록된 프롬프트가 없습니다. 질문을 추가해 주세요.'}</EmptyState>}
          <div className="live-pagination"><small>총 {filtered.length}개</small><button disabled={current === 1} onClick={() => setPage(current - 1)}>이전</button><span>{current} / {pages}</span><button disabled={current === pages} onClick={() => setPage(current + 1)}>다음</button></div>
        </>}
        {tab === 'sets' && <><div className="live-toolbar"><button onClick={() => setEdit({ table: 'geo_prompt_sets' })}>세트 추가</button><small>{data.scheduler_enabled ? '예약 처리: 서버 실행 중 · 최대 30초 간격으로 확인' : '예약 처리기가 꺼져 있습니다. 서버 설정을 확인해 주세요.'}</small></div><div className="live-grid">{data.geo_prompt_sets.map(row => <section className="live-card" key={row.id}><h2>{str(row.name)} {row.is_default === true && <span className="live-badge">기본</span>}</h2><p>{str(row.description) || '설명 없음'}</p><p className="muted">{str(row.brand_domain) || '워크스페이스 도메인 사용'} · 기본 엔진 {engineName(row.default_engine)}</p><p>{data.geo_prompts.filter(prompt => prompt.prompt_set_id === row.id).length}개 프롬프트</p><p className="muted">{row.schedule_enabled && row.is_active !== false ? `매일 ${row.schedule_hour}시 · 다음 실행 ${date(row.next_run_at)}` : '예약 꺼짐'}</p><div className="live-toolbar">{actions('geo_prompt_sets', row)}<button disabled={busy} onClick={() => run(() => patch('geo_prompt_sets', row, { schedule_enabled: !row.schedule_enabled }), row.schedule_enabled ? '예약을 껐습니다.' : '예약을 켰습니다.')}>{row.schedule_enabled ? '예약 끄기' : '예약 켜기'}</button></div></section>)}</div>{!data.geo_prompt_sets.length && <EmptyState>등록된 프롬프트 세트가 없습니다.</EmptyState>}</>}
        {tab === 'tags' && <><div className="live-toolbar"><button onClick={() => setEdit({ table: 'workspace_tags' })}>태그 추가</button><button onClick={() => setEdit({ table: 'workspace_tag_groups' })}>그룹 추가</button><small>키워드 메뉴와 공유하는 태그입니다. 삭제하면 양쪽 연결이 정리됩니다.</small></div><div className="live-grid">{data.workspace_tags.map(row => <section className="live-card" key={row.id}><h2><span style={{ color: str(row.color) }}>●</span> {str(row.name)}</h2><p className="muted">{str(data.workspace_tag_groups.find(group => group.id === row.group_id)?.name || '그룹 없음')} · {data.geo_prompt_tag_assignments.filter(link => link.tag_id === row.id).length}개 프롬프트 연결</p>{actions('workspace_tags', row)}</section>)}</div>{!data.workspace_tags.length && <EmptyState>태그를 추가하고 프롬프트 편집에서 연결하세요.</EmptyState>}<h2>태그 그룹</h2><div className="live-grid">{data.workspace_tag_groups.map(row => <section className="live-card" key={row.id}><h2>{str(row.name)}</h2>{actions('workspace_tag_groups', row)}</section>)}</div></>}
      </>}
    </>)}
    {edit && <LiveModal key={`${edit.table}:${edit.row?.id || 'new'}`} title={`${title[edit.table]} ${edit.row ? '편집' : '추가'}`} submit={edit.table === 'geo_prompts' && !edit.row ? '추가하고 실행' : '저장'} onClose={() => setEdit(null)} onSave={save}><PromptFields edit={edit} data={data} /></LiveModal>}
    {remove && <LiveModal title={`${title[remove.table]} 삭제`} submit="삭제" description={remove.table === 'geo_prompt_sets' ? '세트를 삭제하면 예약이 해제됩니다. 프롬프트와 실행 이력은 미분류로 보존됩니다.' : remove.table === 'geo_prompts' ? '질문과 모든 답변·인용·실행 이력, 태그·키워드 연결을 삭제합니다.' : '선택한 항목과 연결된 데이터를 삭제합니다.'} onClose={() => setRemove(null)} onSave={async () => {
      await action(async () => {
        const deleted = await deleteTableRows<Row>(remove.table, { ...where, id: `in.(${remove.rows.map(row => row.id).join(',')})` });
        if (!deleted.length) throw new Error('이미 삭제되었거나 접근할 수 없는 항목입니다.');
        setSelected([]);
        if (remove.table === 'geo_prompts' && promptId && deleted.some(row => row.id === promptId)) router.push('/app/geo/prompts');
      }, '삭제했습니다.');
    }}><p>{remove.rows.map(row => str(row.prompt_text || row.name || `${engineName(row.engine)} 실행 이력`)).join(', ')}</p></LiveModal>}
  </div>;
}

function PromptFields({ edit: { table, row }, data }: { edit: Edit; data: Data }) {
  const value = (key: string, fallback = '') => str(row?.[key] ?? fallback);
  if (table === 'geo_prompts') return <>
    <label>질문<textarea name="prompt_text" aria-label="질문" required maxLength={2000} defaultValue={value('prompt_text')} /></label>
    <label>세트<select name="prompt_set_id" aria-label="세트" defaultValue={value('prompt_set_id', str(data.geo_prompt_sets.find(set => set.is_default)?.id))}><option value="">미분류</option>{data.geo_prompt_sets.map(set => <option key={set.id} value={set.id}>{str(set.name)}</option>)}</select></label>
    <label>질문 유형<select name="prompt_category" aria-label="질문 유형" defaultValue={value('prompt_category', 'informational')}>{Object.entries(GEO_CATEGORIES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <div><p>실행 엔진</p><div className="live-checks">{Object.entries(GEO_ENGINES).map(([engine, name]) => <label className="check" key={engine}><input type="checkbox" name="engines" value={engine} defaultChecked={(Array.isArray(row?.engines) ? row.engines : ['openai']).includes(engine)} />{name}</label>)}</div></div>
    <label>언어<select name="language_code" aria-label="언어" defaultValue={value('language_code', 'ko')}><option value="ko">한국어</option><option value="en">영어</option><option value="ja">일본어</option><option value="zh">중국어</option></select></label><label>국가<select name="location_code" aria-label="국가" defaultValue={value('location_code', 'KR')}><option value="KR">대한민국</option><option value="US">미국</option><option value="JP">일본</option><option value="CN">중국</option></select></label>
    {row && <div><p>태그</p><div className="live-checks">{data.workspace_tags.map(tag => <label className="check" key={tag.id}><input name="tag_ids" type="checkbox" value={tag.id} defaultChecked={data.geo_prompt_tag_assignments.some(link => link.prompt_id === row.id && link.tag_id === tag.id)} />{str(tag.name)}</label>)}</div>{!data.workspace_tags.length && <small>태그 탭에서 먼저 추가하세요.</small>}</div>}
  </>;
  return <><label>이름<input name="name" required maxLength={table === 'geo_prompt_sets' ? 100 : 60} defaultValue={value('name')} /></label>
    {table === 'geo_prompt_sets' && <><label>설명<textarea name="description" maxLength={2000} defaultValue={value('description')} /></label><label>브랜드 도메인<input name="brand_domain" maxLength={253} placeholder="example.com" defaultValue={value('brand_domain')} /></label><label>기본 엔진<select name="default_engine" aria-label="기본 엔진" defaultValue={value('default_engine', 'openai')}>{Object.entries(GEO_ENGINES).map(([engine, name]) => <option key={engine} value={engine}>{name}</option>)}</select></label><label>예약 시간 (한국시간)<select name="schedule_hour" aria-label="예약 시간 (한국시간)" defaultValue={value('schedule_hour', '9')}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hour}시</option>)}</select></label><label className="check"><input name="schedule_enabled" type="checkbox" defaultChecked={row?.schedule_enabled === true} />매일 예약 실행</label><label className="check"><input name="is_active" type="checkbox" defaultChecked={row?.is_active !== false} />세트 활성화</label><label className="check"><input name="is_default" type="checkbox" defaultChecked={row?.is_default === true} />기본 세트로 사용</label></>}
    {table === 'workspace_tags' && <><label>색상<input name="color" type="color" defaultValue={value('color', '#64748b')} /></label><label>그룹<select name="group_id" aria-label="그룹" defaultValue={value('group_id')}><option value="">그룹 없음</option>{data.workspace_tag_groups.map(group => <option key={group.id} value={group.id}>{str(group.name)}</option>)}</select></label></>}
  </>;
}
