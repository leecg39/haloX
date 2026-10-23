'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LibraryWorkspace, text } from './LibraryShared';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';
import { SettingsNav } from './WorkspaceSettingsPage';
import { accountRequest } from '../AccountSecurityForms';
import type { ContentRow as Row } from '@/lib/api/content';

type Tag = Row & { keyword_ids: string[]; prompt_ids: string[]; keyword_count: number | null; prompt_count: number | null; links_stamp: string | null };
type Data = { editable: boolean; can_assign: boolean; can_read_assignments: boolean; groups: Row[]; tags: Tag[]; keywords: Row[]; prompts: Row[] };
type Edit = { kind: 'group' | 'tag' | 'group-delete' | 'tag-delete' | 'assign'; row?: Row; groupId?: string };

export function TagSettingsPage() { return <LibraryWorkspace>{(id, name) => <TagPanel key={id} workspaceId={id} workspaceName={name} />}</LibraryWorkspace>; }
function TagPanel({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [data, setData] = useState<Data>(), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''), [groupFilter, setGroupFilter] = useState('all'), [edit, setEdit] = useState<Edit>();
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current; setLoading(true); setError('');
    try {
      const response = await fetch(`/api/v1/tag-settings?workspace_id=${encodeURIComponent(workspaceId)}`), body = await response.json();
      if (!response.ok) throw new Error(body.error || '태그를 불러오지 못했습니다.');
      if (current === generation.current) setData(body);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); }
    finally { if (current === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  useEffect(() => { if (data && groupFilter !== 'all' && groupFilter !== '' && !data.groups.some(group => group.id === groupFilter)) setGroupFilter('all'); }, [data, groupFilter]);
  async function command(values: Record<string, unknown>) {
    await accountRequest('/api/v1/tag-settings', { ...values, workspace_id: workspaceId });
    await reload(); setNotice('변경 사항을 저장했습니다. 키워드·프롬프트 화면에도 같은 태그가 적용됩니다.');
  }
  const close = () => setEdit(undefined), row = edit?.row;
  const clean = (value: unknown) => text(value).normalize('NFKC').toLocaleLowerCase();
  const groups = data ? [...data.groups, { id: '', name: '그룹 없음' }] : [];
  const matching = (group: Row) => (data?.tags || []).filter(tag => text(tag.group_id) === group.id && (!query.trim() || clean(tag.name).includes(clean(query.trim())) || clean(group.name).includes(clean(query.trim()))));
  const visibleGroups = groups.filter(group => (groupFilter === 'all' || group.id === groupFilter) && (!query.trim() || matching(group).length > 0 || clean(group.name).includes(clean(query.trim()))));
  return <div className="live live-settings-page live-tag-settings">
    <header className="live-head"><div><h1>태그 관리</h1><p>{workspaceName} · 키워드와 프롬프트에서 함께 사용하는 태그</p></div><button disabled={loading || !!edit} onClick={() => void reload()}>새로고침</button></header>
    <SettingsNav current="tags" />
    <p>그룹으로 태그를 정리하고, 같은 태그로 키워드와 프롬프트를 분류하세요. 그룹을 삭제하면 소속 태그는 ‘그룹 없음’으로 이동합니다.</p>
    {notice && <p role="status" className="live-status">{notice}</p>}{loading && <p role="status">태그를 불러오는 중…</p>}{error && <ErrorState message={error} retry={reload} />}
    {data && !error && <>
      {!data.can_read_assignments && <p className="muted">연결된 항목 조회·변경과 태그 삭제에는 분석 메뉴 권한이 필요합니다.</p>}
      {!data.editable && <p className="muted">읽기 전용 멤버는 태그와 그룹을 조회할 수 있습니다.</p>}
      <div className="live-toolbar"><input aria-label="태그·그룹 검색" placeholder="태그 또는 그룹 검색" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="태그 그룹 필터" value={groupFilter} onChange={event => setGroupFilter(event.target.value)}><option value="all">모든 그룹</option>{groups.map(group => <option key={group.id} value={group.id}>{text(group.name)}</option>)}</select>{data.editable && <><button onClick={() => setEdit({ kind: 'group' })}>새 그룹</button><button className="primary" onClick={() => setEdit({ kind: 'tag', groupId: groupFilter === 'all' ? '' : groupFilter })}>새 태그</button></>}</div>
      <p className="muted">총 {data.groups.length}개 그룹 · {data.tags.length}개 태그</p>
      {!visibleGroups.length && <EmptyState>검색 결과가 없습니다.</EmptyState>}
      <div className="tag-groups">{visibleGroups.map(group => <section className="live-card tag-group" aria-label={text(group.name)} key={group.id}>
        <div className="live-head"><h2>{text(group.name)} <small>({(data.tags.filter(tag => text(tag.group_id) === group.id)).length})</small></h2>{data.editable && <div className="live-actions"><button onClick={() => setEdit({ kind: 'tag', groupId: group.id })}>태그 추가</button>{group.id && <><button onClick={() => setEdit({ kind: 'group', row: group })}>그룹 수정</button><button onClick={() => setEdit({ kind: 'group-delete', row: group })}>그룹 삭제</button></>}</div>}</div>
        {!matching(group).length && <EmptyState>{query ? '일치하는 태그가 없습니다.' : '등록한 태그가 없습니다.'}</EmptyState>}
        <div className="tag-settings-list">{matching(group).map(tag => <article className="tag-settings-row" aria-label={text(tag.name)} key={tag.id}>
          <div><h3><span className="tag-color" style={{ backgroundColor: text(tag.color) }} aria-hidden="true" />{text(tag.name)}</h3><p className="muted">{data.can_read_assignments ? `키워드 ${tag.keyword_count}개 · 프롬프트 ${tag.prompt_count}개` : '연결 정보 조회 권한 없음'}</p></div>
          <div className="live-actions">{data.can_read_assignments && <button onClick={() => setEdit({ kind: 'assign', row: tag })}>{data.can_assign ? '연결 관리' : '연결 보기'}</button>}{data.editable && <button onClick={() => setEdit({ kind: 'tag', row: tag })}>태그 수정</button>}{data.can_assign && <button onClick={() => setEdit({ kind: 'tag-delete', row: tag })}>태그 삭제</button>}</div>
        </article>)}</div>
      </section>)}</div>
      {data.can_read_assignments && <div className="live-actions"><Link href="/app/keywords">키워드 관리</Link><Link href="/app/geo/prompts">프롬프트 관리</Link></div>}
      {edit?.kind === 'group' && <LiveModal title={row ? '그룹 수정' : '새 그룹'} onClose={close} onSave={async form => { await command({ action: row ? 'group-update' : 'group-create', id: row?.id, expected_revision: Number(row?.revision || 0), name: form.get('name') }); }}><label>그룹 이름<input name="name" required maxLength={60} defaultValue={text(row?.name)} /></label></LiveModal>}
      {edit?.kind === 'tag' && <LiveModal title={row ? '태그 수정' : '새 태그'} onClose={close} onSave={async form => { await command({ action: row ? 'tag-update' : 'tag-create', id: row?.id, expected_revision: Number(row?.revision || 0), ...Object.fromEntries(form.entries()) }); }}><label>태그 이름<input name="name" required maxLength={60} defaultValue={text(row?.name)} /></label><label>태그 색상<input name="color" type="color" defaultValue={text(row?.color) || '#64748b'} /></label><label>소속 그룹<select name="group_id" defaultValue={text(row?.group_id) || edit.groupId || ''}><option value="">그룹 없음</option>{data.groups.map(group => <option key={group.id} value={group.id}>{text(group.name)}</option>)}</select></label></LiveModal>}
      {edit?.kind === 'group-delete' && <LiveModal title="그룹 삭제" submit="삭제" description="그룹만 삭제합니다. 소속 태그와 키워드·프롬프트 연결은 유지됩니다." onClose={close} onSave={async () => { await command({ action: 'group-delete', id: row!.id, expected_revision: Number(row!.revision || 0), contents_stamp: row!.contents_stamp }); setGroupFilter('all'); }}><p>{text(row?.name)} · 소속 태그 {data.tags.filter(tag => tag.group_id === row?.id).length}개</p></LiveModal>}
      {edit?.kind === 'tag-delete' && <LiveModal title="태그 삭제" submit="삭제" description="태그와 모든 연결을 삭제합니다. 키워드와 프롬프트 본문·측정 이력은 유지됩니다." onClose={close} onSave={async () => { await command({ action: 'tag-delete', id: row!.id, expected_revision: Number(row!.revision || 0), links_stamp: row!.links_stamp }); }}><p>{text(row?.name)} · 키워드 {text(row?.keyword_count)}개 · 프롬프트 {text(row?.prompt_count)}개</p></LiveModal>}
      {edit?.kind === 'assign' && <AssignmentForm tag={row as Tag} data={data} onClose={close} onSave={command} />}
    </>}
  </div>;
}

function AssignmentForm({ tag, data, onClose, onSave }: { tag: Tag; data: Data; onClose: () => void; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const [keywordIds, setKeywordIds] = useState(tag.keyword_ids), [promptIds, setPromptIds] = useState(tag.prompt_ids), [query, setQuery] = useState('');
  const filter = (row: Row) => `${text(row.keyword || row.prompt_text)} ${text(row.language || row.language_code)} ${text(row.country || row.location_code)}`.normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase());
  return <LiveModal title={`${text(tag.name)} · 연결 ${data.can_assign ? '관리' : '보기'}`} description="선택한 항목에 이 태그를 연결합니다. 다른 태그는 유지되며, 검색해도 기존 선택은 유지됩니다. 각 종류별 최대 2,000개까지 연결할 수 있습니다." onClose={onClose} onSave={async () => { await onSave({ action: 'tag-assign', id: tag.id, expected_revision: Number(tag.revision || 0), links_stamp: tag.links_stamp, keyword_ids: keywordIds, prompt_ids: promptIds }); }}>
    <label>연결 항목 검색<input value={query} onChange={event => setQuery(event.target.value)} placeholder="질문·키워드 또는 언어·국가" /></label>
    {([{ title: '키워드', rows: data.keywords, ids: keywordIds, set: setKeywordIds }, { title: '프롬프트', rows: data.prompts, ids: promptIds, set: setPromptIds }]).map(({ title, rows, ids, set }) => {
      const visible = rows.filter(filter);
      return <section className="tag-assignment" key={title}><h3>{title} · 선택 {ids.length}개 / 전체 {rows.length}개</h3>{data.can_assign && <div className="live-actions"><button type="button" onClick={() => set(previous => Array.from(new Set([...previous, ...visible.map(item => item.id)])))}>검색 결과 선택</button><button type="button" onClick={() => set(previous => previous.filter(id => !visible.some(item => item.id === id)))}>검색 결과 해제</button></div>}
        <div className="tag-assignment-list">{visible.map(item => <label className="check" key={item.id}><input type="checkbox" checked={ids.includes(item.id)} disabled={!data.can_assign} onChange={event => set(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} /><span>{text(item.keyword || item.prompt_text)} <small>{text(item.language || item.language_code)} · {text(item.country || item.location_code)}</small></span></label>)}{!visible.length && <EmptyState>일치하는 {title}가 없습니다.</EmptyState>}</div>
      </section>;
    })}
  </LiveModal>;
}
