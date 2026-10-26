'use client';

import { ProviderNotice } from './ProviderNotice';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { insertTableRows, updateTableRows, deleteTableRows, invokeEdgeEndpoint } from '@/lib/api/client';
import { KEYWORD_PAGE_TABLES as TABLES, type KeywordPageTable as Table, type KeywordPageRow as Row, type KeywordPageData as Data } from '@/lib/api/keywords';
import { useWorkspace } from '../WorkspaceProvider';
import { downloadCsv, EmptyState, ErrorState, LiveModal } from './LiveUI';

const empty = () => Object.fromEntries(TABLES.map(table => [table, [] as Row[]])) as Record<Table, Row[]>;
const str = (value: unknown) => String(value ?? '');
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR') : '—';
const date = (value: unknown) => value && Number.isFinite(Date.parse(str(value))) ? new Date(str(value)).toLocaleString('ko-KR') : '—';
const intents: Record<string, string> = { informational: '정보 탐색', commercial: '비교 검토', transactional: '구매', navigational: '사이트 탐색' };
const titles: Partial<Record<Table, string>> = { keywords: '키워드', keyword_sets: '세트', workspace_tags: '태그', workspace_tag_groups: '태그 그룹', keyword_prompt_links: '프롬프트 연결', keyword_ideas: '아이디어' };
type Edit = { table: Table; row?: Row };
type Delete = { table: Table; rows: Row[] };
const safeUrl = (value: unknown) => /^https?:\/\//i.test(str(value)) ? str(value) : undefined;

export function KeywordsPage({ keywordId }: { keywordId?: string }) {
  const { activeWorkspace, loading, error, reload } = useWorkspace();
  if (loading) return <div className="live" role="status">워크스페이스를 불러오는 중…</div>;
  if (error) return <div className="live"><ErrorState message={error} retry={reload} /></div>;
  if (!activeWorkspace.id) return <div className="live"><EmptyState>워크스페이스가 없습니다. <Link href="/app/workspaces">워크스페이스 만들기</Link></EmptyState></div>;
  return <KeywordWorkspace key={activeWorkspace.id} workspaceId={activeWorkspace.id} workspaceName={activeWorkspace.name} workspaceDomain={activeWorkspace.domain || ''} keywordId={keywordId} />;
}

function KeywordWorkspace({ workspaceId, workspaceName, workspaceDomain, keywordId }: { workspaceId: string; workspaceName: string; workspaceDomain: string; keywordId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Data>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('list');
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [intentFilter, setIntentFilter] = useState('');
  const [sort, setSort] = useState('created_at');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [remove, setRemove] = useState<Delete | null>(null);
  const generation = useRef(0);
  const where = { workspace_id: `eq.${workspaceId}` };
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/v1/keywords?${new URLSearchParams({ workspace_id: workspaceId })}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '데이터를 불러오지 못했습니다.');
      if (request === generation.current) setData(result as Data);
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  useEffect(() => { setPage(1); setSelected([]); }, [query, setFilter, statusFilter, intentFilter, tab]);
  const latest = new Map<string, Row>();
  for (const snapshot of [...data.serp_snapshots].sort((a, b) => str(b.captured_at).localeCompare(str(a.captured_at)))) {
    const keyword = data.keywords.find(row => row.id === snapshot.keyword_id);
    if (keyword && (!snapshot.keyword_text || snapshot.keyword_text === keyword.keyword) && snapshot.language === keyword.language && snapshot.country === keyword.country && !latest.has(keyword.id)) latest.set(keyword.id, snapshot);
  }
  const rank = (keyword: Row): number | null => {
    const classified = latest.get(keyword.id)?.brand_classification as Record<string, unknown> | undefined;
    if (classified) return typeof classified.rank === 'number' && classified.rank > 0 ? classified.rank : null;
    const domain = str(data.keyword_sets.find(set => set.id === keyword.keyword_set_id)?.target_domain || workspaceDomain).toLowerCase();
    const results = latest.get(keyword.id)?.top_results_json;
    if (!domain || !Array.isArray(results)) return null;
    const result = results.find(result => { try { const host = new URL(result.url).hostname.toLowerCase(); return host === domain || host.endsWith(`.${domain}`); } catch { return false; } });
    return typeof result?.rank === 'number' && result.rank > 0 ? result.rank : null;
  };
  const ranks = data.keywords.map(rank).filter((value): value is number => value !== null);
  const label = (table: Table, id: unknown, fallback = '미분류') => str(data[table].find(row => row.id === id)?.name || fallback);
  const tagsFor = (keyword: Row) => data.workspace_tags.filter(tag => data.keyword_tag_assignments.some(link => link.keyword_id === keyword.id && link.tag_id === tag.id));
  const filtered = data.keywords.filter(row => str(row.keyword).toLowerCase().includes(query.toLowerCase()) && (!setFilter || row.keyword_set_id === setFilter || (setFilter === 'none' && !row.keyword_set_id)) && (!statusFilter || (statusFilter === 'paused' ? row.is_paused : !row.is_paused)) && (!intentFilter || row.intent === intentFilter)).sort((a, b) => sort === 'keyword' ? str(a.keyword).localeCompare(str(b.keyword), 'ko') : sort === 'rank' ? (rank(a) ?? Infinity) - (rank(b) ?? Infinity) : sort === 'search_volume' ? Number(b.search_volume || 0) - Number(a.search_volume || 0) : str(b.created_at).localeCompare(str(a.created_at)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  const detail = keywordId ? data.keywords.find(row => row.id === keywordId) : undefined;

  async function action(work: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage('');
    try { await work(); setMessage(success); await reload(); }
    finally { setBusy(false); }
  }
  function run(work: () => Promise<unknown>, success: string) { void action(work, success).catch(cause => setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.')); }
  async function patch(table: Table, row: Row, values: Record<string, unknown>) {
    const updated = await updateTableRows(table, values, { ...where, id: `eq.${row.id}`, ...(row.updated_at ? { updated_at: `eq.${row.updated_at}` } : {}) });
    if (!updated.length) throw new Error('다른 곳에서 변경되거나 삭제된 항목입니다. 새로고침 후 다시 시도해 주세요.');
  }
  async function save(form: FormData) {
    if (!edit) return;
    const { table, row } = edit;
    const values: Record<string, unknown> = {};
    for (const [key, value] of form) if (key !== 'tag_ids') values[key] = value;
    if (['keywords', 'keyword_ideas'].includes(table)) values.keyword_set_id ||= null;
    if (table === 'keyword_sets') { values.is_default = form.has('is_default'); values.is_active = true; }
    if (table === 'workspace_tags') values.group_id ||= null;
    await action(async () => {
      if (table === 'keywords') {
        if (row) await invokeEdgeEndpoint('keywords-save', { workspace_id: workspaceId, keyword_id: row.id, updated_at: row.updated_at, patch: values, tag_ids: form.getAll('tag_ids') });
        else await invokeEdgeEndpoint('keywords-collect', { ...values, workspace_id: workspaceId, keywords: str(values.keyword).split('\n').map(text => text.trim()).filter(Boolean), idempotency_key: crypto.randomUUID() });
      } else if (row) await patch(table, row, values);
      else await insertTableRows(table, { ...values, workspace_id: workspaceId });
    }, `${titles[table]} 저장을 완료했습니다.`);
  }
  const pause = (row: Row) => run(() => patch('keywords', row, { is_paused: !row.is_paused }), row.is_paused ? '추적을 재개했습니다.' : '추적을 일시정지했습니다.');
  const collect = (row: Row) => run(() => invokeEdgeEndpoint('keywords-refresh', { workspace_id: workspaceId, keyword_id: row.id }), '수집 이력을 갱신했습니다.');
  const actions = (table: Table, row: Row) => <div className="live-actions"><button disabled={busy} onClick={() => setEdit({ table, row })}>편집</button><button disabled={busy} className="danger" onClick={() => setRemove({ table, rows: [row] })}>삭제</button></div>;

  return <div className="live" aria-busy={loading || busy}>
    <div className="live-head"><div>{keywordId && <Link href="/app/keywords" className="muted">← 키워드 현황</Link>}<h1>{keywordId ? str(detail?.keyword || '키워드 상세') : '키워드 현황'}</h1><p>{workspaceName} · 검색 성과와 키워드 자산을 관리합니다.</p></div><div className="live-actions"><button disabled={loading || busy} onClick={() => void reload()}>새로고침</button>{!keywordId && <><button onClick={() => downloadCsv('halox-keywords.csv', [['키워드', '세트', '국가', '언어', '검색량', '순위', '상태'], ...filtered.map(row => [row.keyword, label('keyword_sets', row.keyword_set_id), row.country, row.language, row.search_volume, rank(row), row.is_paused ? '일시정지' : '추적 중'])])}>CSV 내보내기</button><button className="primary" disabled={loading || busy} onClick={() => setEdit({ table: 'keywords' })}>키워드 추가</button></>}</div></div>
    <ProviderNotice service="dataforseo" />
    <p className="muted">Google 검색 결과를 DataForSEO에서 수집합니다. 검색량·난이도는 별도 측정 자료가 있을 때 표시합니다. 이전 데모 자료와 실제 수집은 이력의 출처로 구분합니다.</p>
    {error && <ErrorState message={error} retry={reload} />}
    {message && <p className="live-status" role="status">{message}</p>}
    {loading && <p role="status">데이터를 불러오는 중…</p>}
    {keywordId ? detail ? <>
      <div className="live-toolbar"><span className="live-badge">{label('keyword_sets', detail.keyword_set_id)}</span><span>{str(detail.country)} · {str(detail.language)}</span><span>{detail.is_paused ? '일시정지' : '추적 중'}</span>{actions('keywords', detail)}<button disabled={busy} onClick={() => pause(detail)}>{detail.is_paused ? '재개' : '일시정지'}</button><button disabled={busy} onClick={() => collect(detail)}>다시 수집</button></div>
      <div className="live-kpis">{[['검색량', number(detail.search_volume)], ['난이도', number(detail.keyword_difficulty)], ['자사 순위', rank(detail) ? `${rank(detail)}위` : '미노출'], ['검색 의도', intents[str(detail.intent)] || '미수집']].map(([title, value]) => <div className="live-card" key={title}><small>{title}</small><strong>{value}</strong></div>)}</div>
      <div>{tagsFor(detail).map(tag => <span className="live-badge" key={tag.id} style={{ borderLeft: `3px solid ${tag.color}` }}>{str(tag.name)}</span>)}</div>
      <div className="live-grid"><section className="live-card"><h2>연관 검색어</h2>{Array.isArray(latest.get(detail.id)?.related_searches_json) ? <ul>{(latest.get(detail.id)!.related_searches_json as string[]).map((text, i) => <li key={`${text}:${i}`}>{text}</li>)}</ul> : <p>수집 이력이 없습니다.</p>}</section><section className="live-card"><h2>함께 묻는 질문</h2>{Array.isArray(latest.get(detail.id)?.paa_questions_json) ? <ul>{(latest.get(detail.id)!.paa_questions_json as string[]).map((text, i) => <li key={`${text}:${i}`}>{text}</li>)}</ul> : <p>수집 이력이 없습니다.</p>}</section></div>
      <h2>수집 이력</h2>{data.serp_snapshots.filter(row => row.keyword_id === detail.id).map(snapshot => <details className="live-card" key={snapshot.id}><summary>{date(snapshot.captured_at)} · {str(snapshot.engine)} · {str(snapshot.provider)}</summary><ol>{Array.isArray(snapshot.top_results_json) && (snapshot.top_results_json as Array<{ title: string; url: string; rank: number }>).map((result, i) => <li key={`${result.url}:${i}`}><a href={safeUrl(result.url)} target="_blank" rel="noopener noreferrer">{result.rank}위 · {result.title}</a><small> {result.url}</small></li>)}</ol></details>)}
      {!latest.has(detail.id) && <EmptyState>아직 수집 이력이 없습니다.</EmptyState>}
    </> : !loading && <EmptyState>이 워크스페이스에서 키워드를 찾을 수 없습니다. <Link href="/app/keywords">목록으로 이동</Link></EmptyState> : <>
      <div className="live-kpis">{[['전체 키워드', data.keywords.length], ['Top 10', ranks.filter(value => value <= 10).length], ['평균 순위', ranks.length ? `${(ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1)}위` : '—'], ['추적 중', data.keywords.filter(row => !row.is_paused && row.is_active).length]].map(([title, value]) => <div className="live-card" key={title}><small>{title}</small><strong>{value}</strong></div>)}</div>
      <nav className="live-tabs" aria-label="키워드 보기">{[['list', '리스트'], ['sets', '세트'], ['tags', '태그'], ['network', '네트워크'], ['ideas', '아이디어']].map(([value, title]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{title}</button>)}</nav>
      {tab === 'list' && <>
        <div className="live-toolbar"><input aria-label="키워드 검색" placeholder="키워드 검색…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="세트 필터" value={setFilter} onChange={event => setSetFilter(event.target.value)}><option value="">전체 세트</option><option value="none">미분류</option>{data.keyword_sets.map(row => <option key={row.id} value={row.id}>{str(row.name)}</option>)}</select><select aria-label="상태 필터" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">전체 상태</option><option value="active">추적 중</option><option value="paused">일시정지</option></select><select aria-label="검색 의도 필터" value={intentFilter} onChange={event => setIntentFilter(event.target.value)}><option value="">모든 검색 의도</option>{Object.entries(intents).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select><select aria-label="정렬" value={sort} onChange={event => setSort(event.target.value)}><option value="created_at">최신순</option><option value="keyword">이름순</option><option value="search_volume">검색량순</option><option value="rank">순위순</option></select></div>
        {!!selected.length && <div className="live-toolbar"><span>{selected.length}개 선택</span><button disabled={busy} onClick={() => setRemove({ table: 'keywords', rows: data.keywords.filter(row => selected.includes(row.id)) })}>선택 삭제</button></div>}
        {!!filtered.length ? <div className="live-table"><table><thead><tr><th><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={visible.length > 0 && visible.every(row => selected.includes(row.id))} onChange={event => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map(row => row.id)])] : selected.filter(id => !visible.some(row => row.id === id)))} /></th><th>키워드 / 세트</th><th>태그</th><th>순위</th><th>검색량</th><th>의도</th><th>상태</th><th>작업</th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td><input type="checkbox" aria-label={`${row.keyword} 선택`} checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} /></td><td><Link href={`/app/keywords/${row.id}`}>{str(row.keyword)}</Link><small>{label('keyword_sets', row.keyword_set_id)} · {str(row.country)} / {str(row.language)}</small></td><td>{tagsFor(row).map(tag => <span className="live-badge" key={tag.id} style={{ borderLeft: `3px solid ${tag.color}` }}>{str(tag.name)}</span>)}</td><td>{rank(row) ? `${rank(row)}위` : '—'}</td><td>{number(row.search_volume)}</td><td>{intents[str(row.intent)] || '미수집'}</td><td>{row.is_paused ? '일시정지' : '추적 중'}</td><td><div className="live-actions">{actions('keywords', row)}<button disabled={busy} onClick={() => pause(row)}>{row.is_paused ? '재개' : '일시정지'}</button></div></td></tr>)}</tbody></table></div> : !loading && <EmptyState>{data.keywords.length ? '조건에 맞는 키워드가 없습니다.' : '아직 키워드가 없습니다. 키워드를 추가해 검색 성과를 관리하세요.'}</EmptyState>}
        <div className="live-pagination"><small>총 {filtered.length}개</small><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {totalPages}</span><button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>다음</button></div>
      </>}
      {tab === 'sets' && <><div className="live-toolbar"><button onClick={() => setEdit({ table: 'keyword_sets' })}>세트 추가</button></div><div className="live-grid">{data.keyword_sets.map(row => <section className="live-card" key={row.id}><h2>{str(row.name)} {row.is_default === true && <span className="live-badge">기본</span>}</h2><p>{str(row.description) || '설명 없음'}</p><p className="muted">{str(row.target_domain) || '자사 도메인 미설정'} · {data.keywords.filter(keyword => keyword.keyword_set_id === row.id).length}개 키워드</p><div className="live-toolbar">{actions('keyword_sets', row)}{!row.is_default && <button disabled={busy} onClick={() => run(() => patch('keyword_sets', row, { is_default: true }), '기본 세트를 변경했습니다.')}>기본으로 설정</button>}</div></section>)}</div>{!data.keyword_sets.length && <EmptyState>등록된 세트가 없습니다.</EmptyState>}</>}
      {tab === 'tags' && <><div className="live-toolbar"><button onClick={() => setEdit({ table: 'workspace_tags' })}>태그 추가</button><button onClick={() => setEdit({ table: 'workspace_tag_groups' })}>그룹 추가</button></div><div className="live-grid">{data.workspace_tags.map(row => <section className="live-card" key={row.id}><h2><span style={{ color: str(row.color) }}>●</span> {str(row.name)}</h2><p className="muted">{label('workspace_tag_groups', row.group_id, '그룹 없음')} · {data.keyword_tag_assignments.filter(link => link.tag_id === row.id).length}개 연결</p>{actions('workspace_tags', row)}</section>)}</div>{!data.workspace_tags.length && <EmptyState>태그를 추가한 후 키워드 편집에서 연결하세요.</EmptyState>}<h2>태그 그룹</h2><div className="live-grid">{data.workspace_tag_groups.map(row => <section className="live-card" key={row.id}><h2>{str(row.name)}</h2>{actions('workspace_tag_groups', row)}</section>)}</div></>}
      {tab === 'network' && <><div className="live-toolbar"><button onClick={() => setEdit({ table: 'keyword_prompt_links' })} disabled={!data.keywords.length || !data.geo_prompts.length}>프롬프트 연결</button><small>키워드와 실제 등록된 프롬프트의 관계입니다.</small></div>{data.keyword_prompt_links.length ? <div className="live-table"><table><thead><tr><th>키워드</th><th>프롬프트</th><th>작업</th></tr></thead><tbody>{data.keyword_prompt_links.map(row => <tr key={row.id}><td>{str(data.keywords.find(keyword => keyword.id === row.keyword_id)?.keyword)}</td><td>{str(data.geo_prompts.find(prompt => prompt.id === row.prompt_id)?.prompt_text)}</td><td>{actions('keyword_prompt_links', row)}</td></tr>)}</tbody></table></div> : <EmptyState>연결이 없습니다. 키워드와 프롬프트를 등록한 후 연결하세요.</EmptyState>}</>}
      {tab === 'ideas' && <><div className="live-toolbar"><button onClick={() => setEdit({ table: 'keyword_ideas' })}>아이디어 추가</button><small>채택하면 키워드와 첫 수집 이력이 생성되고 아이디어 목록에서 제거됩니다.</small></div><div className="live-grid">{data.keyword_ideas.map(row => <section className="live-card" key={row.id}><h2>{str(row.keyword)}</h2><p>{str(row.notes)}</p><p className="muted">{label('keyword_sets', row.keyword_set_id)}</p><div className="live-toolbar">{actions('keyword_ideas', row)}<button disabled={busy} onClick={() => run(() => invokeEdgeEndpoint('keywords-adopt-idea', { workspace_id: workspaceId, idea_id: row.id }), '아이디어를 키워드로 채택했습니다.')}>채택</button></div></section>)}</div>{!data.keyword_ideas.length && <EmptyState>아직 저장된 아이디어가 없습니다.</EmptyState>}</>}
    </>}
    {edit && <LiveModal key={`${edit.table}:${edit.row?.id || 'new'}`} title={`${titles[edit.table]} ${edit.row ? '편집' : '추가'}`} submit={edit.table === 'keywords' && !edit.row ? '키워드 추가' : '저장'} onClose={() => setEdit(null)} onSave={save}>
      <KeywordFields edit={edit} data={data} />
    </LiveModal>}
    {remove && <LiveModal title={`${titles[remove.table]} 삭제`} submit="삭제" description={remove.table === 'keywords' ? '선택한 키워드와 수집 이력, 태그·프롬프트 연결을 삭제합니다.' : remove.table === 'keyword_sets' ? '세트를 삭제합니다. 소속 키워드는 미분류로 보존됩니다.' : '선택한 항목과 연결 관계를 삭제합니다.'} onClose={() => setRemove(null)} onSave={async () => {
      await action(async () => {
        const removed = await deleteTableRows<Row>(remove.table, { ...where, id: `in.(${remove.rows.map(row => row.id).join(',')})` });
        if (!removed.length) throw new Error('이미 삭제되었거나 접근할 수 없는 항목입니다.');
        setSelected([]);
        if (keywordId && removed.some(row => row.id === keywordId)) router.push('/app/keywords');
      }, '삭제했습니다.');
    }}><p>{remove.rows.map(row => str(row.keyword || row.name || '연결')).join(', ')}</p></LiveModal>}
  </div>;
}

function KeywordFields({ edit: { table, row }, data }: { edit: Edit; data: Data }) {
  const value = (key: string, fallback = '') => str(row?.[key] ?? fallback);
  const locale = <>{table === 'keywords' && !row && data.defaults?.auto_generate_prompts && <p>자동 생성 켜짐: 키워드마다 질문 1개를 자동 등록·연결합니다. 새 질문은 프롬프트 생성 한도 1회를 사용하며, 실행은 프롬프트 화면에서 시작합니다.</p>}<label>언어<select aria-label="언어" name="language" defaultValue={value('language', data.defaults?.language || 'ko')}><option value="ko">한국어</option><option value="en">영어</option><option value="ja">일본어</option><option value="zh">중국어</option></select></label><label>국가<select aria-label="국가" name="country" defaultValue={value('country', data.defaults?.country || 'KR')}><option value="KR">대한민국</option><option value="US">미국</option><option value="JP">일본</option><option value="CN">중국</option></select></label></>;
  if (table === 'keyword_prompt_links') return <><label>키워드<select aria-label="키워드" name="keyword_id" required defaultValue={value('keyword_id')}><option value="">선택</option>{data.keywords.map(keyword => <option key={keyword.id} value={keyword.id}>{str(keyword.keyword)}</option>)}</select></label><label>프롬프트<select aria-label="프롬프트" name="prompt_id" required defaultValue={value('prompt_id')}><option value="">선택</option>{data.geo_prompts.map(prompt => <option key={prompt.id} value={prompt.id}>{str(prompt.prompt_text)}</option>)}</select></label></>;
  if (table === 'keywords' || table === 'keyword_ideas') return <>
    <label>{!row && table === 'keywords' ? '키워드 (한 줄에 하나, 최대 20개)' : '키워드'}{!row && table === 'keywords' ? <textarea name="keyword" required maxLength={4020} placeholder="브랜드 검색 최적화" /> : <input name="keyword" required maxLength={200} defaultValue={value('keyword')} />}</label>
    <label>세트<select aria-label="세트" name="keyword_set_id" defaultValue={value('keyword_set_id', str(data.keyword_sets.find(set => set.is_default)?.id))}><option value="">미분류</option>{data.keyword_sets.map(set => <option value={set.id} key={set.id}>{str(set.name)}</option>)}</select></label>{locale}
    {table === 'keyword_ideas' && <label>메모<textarea name="notes" maxLength={2000} defaultValue={value('notes')} /></label>}
    {table === 'keywords' && row && <div><p>태그</p><div className="live-checks">{data.workspace_tags.map(tag => <label className="check" key={tag.id}><input name="tag_ids" type="checkbox" value={tag.id} defaultChecked={data.keyword_tag_assignments.some(link => link.keyword_id === row.id && link.tag_id === tag.id)} />{str(tag.name)}</label>)}</div>{!data.workspace_tags.length && <small>태그 탭에서 태그를 먼저 추가하세요.</small>}</div>}
  </>;
  return <><label>이름<input name="name" required maxLength={table === 'keyword_sets' ? 100 : 60} defaultValue={value('name')} /></label>
    {table === 'keyword_sets' && <><label>설명<textarea name="description" maxLength={2000} defaultValue={value('description')} /></label><label>자사 도메인<input name="target_domain" placeholder="example.com" maxLength={253} defaultValue={value('target_domain')} /></label>{locale}<label className="check"><input name="is_default" type="checkbox" defaultChecked={row?.is_default === true} />기본 세트로 사용</label></>}
    {table === 'workspace_tags' && <><label>색상<input name="color" type="color" defaultValue={value('color', '#64748b')} /></label><label>그룹<select aria-label="그룹" name="group_id" defaultValue={value('group_id')}><option value="">그룹 없음</option>{data.workspace_tag_groups.map(group => <option value={group.id} key={group.id}>{str(group.name)}</option>)}</select></label></>}
  </>;
}
