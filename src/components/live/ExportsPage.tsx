'use client';

import Link from 'next/link';
import { WordPressPanel } from './WordPressPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentRow as Row } from '@/lib/api/content';
import { EXPORT_FORMATS, EXPORT_TABLES, TRANSLATION_LOCALES, TRANSLATION_STATUS, type ExportData } from '@/lib/api/exports';
import { invokeEdgeEndpoint } from '@/lib/api/client';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';
import { LibraryWorkspace, text } from './LibraryShared';
import { DestinationForm, NewExport, TranslationForm, type ExportCommand } from './ExportForms';

type Tab = 'history' | 'translations' | 'settings' | 'connections' | 'publications';
type Edit = { kind: 'export' | 'translation' | 'destination' | 'history'; row?: Row };
export function ExportsPage({ initialTab = 'history', initialJobId }: { initialTab?: Tab; initialJobId?: string }) {
  return <LibraryWorkspace>{(id, name) => <ExportWorkspace key={id} workspaceId={id} workspaceName={name} initialTab={initialTab} initialJobId={initialJobId} />}</LibraryWorkspace>;
}

function ExportWorkspace({ workspaceId, workspaceName, initialTab, initialJobId }: { workspaceId: string; workspaceName: string; initialTab: Tab; initialJobId?: string }) {
  const [data, setData] = useState<ExportData>(() => Object.fromEntries(EXPORT_TABLES.map(table => [table, []])) as unknown as ExportData);
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [tab, setTab] = useState<Tab>(initialTab), [edit, setEdit] = useState<Edit | undefined>(initialJobId ? { kind: 'export' } : undefined), [deleting, setDeleting] = useState<Edit>();
  const [query, setQuery] = useState(''), [format, setFormat] = useState(''), [page, setPage] = useState(1);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const response = await fetch(`/api/v1/exports?${new URLSearchParams({ workspace_id: workspaceId })}`), body = await response.json();
      if (!response.ok) throw new Error(body.error || ' 내보내기를 불러오지 못했습니다.');
      if (request === generation.current) { setData(body); setLoaded(true); }
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '조회하지 못했습니다.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const command: ExportCommand = async (name, values) => { try { return await invokeEdgeEndpoint<Record<string, Row>>(name, { ...values, workspace_id: workspaceId }); } finally { await reload(); } };
  async function download(row: Row) {
    setBusy(row.id); setError('');
    try {
      const response = await fetch(`/api/v1/exports/files/${encodeURIComponent(row.id)}`);
      if (!response.ok) throw new Error((await response.json()).error || '다운로드하지 못했습니다.');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = text(row.filename); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '다운로드하지 못했습니다.'); }
    finally { setBusy(''); }
  }
  const candidates = tab === 'history' ? data.export_history : tab === 'translations' ? data.article_translations : tab === 'publications' ? data.export_publications : data.export_destinations.filter(row => row.kind === (tab === 'connections' ? 'wordpress' : 'download'));
  const rows = candidates.filter(row => `${text(row.title || row.name)} ${text(row.notes)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (tab !== 'history' || !format || row.format === format));
  const pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages);
  const close = () => setEdit(undefined);
  return <div className="live"><header className="live-head"><div><h1>콘텐츠 내보내기</h1><p>{workspaceName} · 원문과 번역문을 파일로 보관하고 내려받습니다.</p></div><div className="live-actions"><button disabled={loading} onClick={() => void reload()}>새로고침</button><button className="primary" disabled={!loaded} onClick={() => setEdit({ kind: 'export' })}>파일 만들기</button></div></header>
    <nav className="live-actions" aria-label="내보내기 메뉴">{([['history', '파일 이력'], ['translations', '번역문 관리'], ['settings', '파일 설정'], ['connections', 'WordPress 연결'], ['publications', '게시 이력']] as const).map(([key, label]) => <button key={key} aria-pressed={tab === key} className={tab === key ? 'primary' : ''} onClick={() => { setTab(key); setPage(1); setQuery(''); }}>{label}</button>)}<Link href="/app/factory">콘텐츠 제작소</Link>{initialTab === 'settings' && <Link href="/app/settings">전체 설정</Link>}</nav>
    {error && <ErrorState message={error} retry={reload} />}{loading && <p role="status">내보내기를 불러오는 중…</p>}
    <div className="live-toolbar"><input aria-label="내보내기 검색" placeholder="이름·메모 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />{tab === 'history' && <select aria-label="파일 형식 필터" value={format} onChange={event => { setFormat(event.target.value); setPage(1); }}><option value="">모든 형식</option>{Object.entries(EXPORT_FORMATS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}<small>{rows.length}개</small>{(tab === 'translations' || tab === 'settings') && <button disabled={!loaded} onClick={() => setEdit({ kind: tab === 'translations' ? 'translation' : 'destination' })}>{tab === 'translations' ? '번역문 등록' : '파일 설정 추가'}</button>}</div>
    {tab === 'settings' && <p className="muted">형식·파일명 접두어·검색 메타 정보 포함 여부를 저장해 파일 생성에 사용합니다.</p>}
    {loaded && !rows.length && tab !== 'connections' && tab !== 'publications' && <EmptyState>{query || format && tab === 'history' ? '검색 결과가 없습니다.' : tab === 'history' ? '보관한 파일이 없습니다. 제작소 콘텐츠로 파일을 만들어 주세요.' : tab === 'translations' ? '직접 번역한 내용을 등록하면 원문 버전과 함께 보관됩니다.' : '자주 사용하는 파일 설정을 추가해 주세요.'}</EmptyState>}
    {tab === 'history' && rows.length > 0 && <div className="live-table"><table><thead><tr><th>파일 / 원문</th><th>형식 / 크기</th><th>생성일</th><th>작업</th></tr></thead><tbody>{rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => <tr key={row.id}><td className="live-prompt-cell"><strong>{text(row.title)}</strong><small>{text(row.filename)} · 원문 v{text(row.source_version)}{row.translation_revision ? ` · 번역 ${text(row.locale)} r${text(row.translation_revision)}` : ''}</small><small>{text(row.notes)}</small>{row.content_job_id ? <Link href={`/app/factory/${row.content_job_id}`}>원문 보기</Link> : <small>원문 연결 해제됨</small>}</td><td>{text(EXPORT_FORMATS[row.format as keyof typeof EXPORT_FORMATS] || row.format)}<small>{row.byte_size ? `${Number(row.byte_size).toLocaleString()} B` : '파일 없음'}</small></td><td>{text(row.created_at).slice(0, 10)}</td><td><div className="live-actions"><button disabled={Boolean(busy) || !row.sha256} onClick={() => void download(row)}>{busy === row.id ? '내려받는 중…' : '다운로드'}</button><button onClick={() => setEdit({ kind: 'history', row })}>메모 수정</button><button className="danger" onClick={() => setDeleting({ kind: 'history', row })}>삭제</button></div></td></tr>)}</tbody></table></div>}
    {tab === 'translations' && <div className="live-history">{rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => <article className="live-card" key={row.id}><h2>{text(row.title)}</h2><p>{text(TRANSLATION_LOCALES[row.locale as keyof typeof TRANSLATION_LOCALES] || row.locale)} · {row.origin === 'manual' ? text(TRANSLATION_STATUS[row.status as keyof typeof TRANSLATION_STATUS]) : '이전 데모 (내보내기 불가)'} · r{Number(row.revision || 0)}</p><small>{text(row.notes)}</small><details><summary>번역문과 원문 보기</summary><h3>번역문</h3><pre className="live-answer">{text(row.content_md)}</pre><h3>참조 원문 v{text((row.source_snapshot as Row)?.version)}</h3><pre className="live-answer">{text((row.source_snapshot as Row)?.content_md)}</pre></details><div className="live-actions"><button disabled={row.origin !== 'manual'} onClick={() => setEdit({ kind: 'translation', row })}>번역문 편집</button><button className="danger" onClick={() => setDeleting({ kind: 'translation', row })}>삭제</button></div></article>)}</div>}
    {tab === 'settings' && <div className="live-grid">{rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => <article className="live-card" key={row.id}><h2>{text(row.name)}</h2><p>{text(EXPORT_FORMATS[row.format as keyof typeof EXPORT_FORMATS])} · 검색 메타 정보 {row.include_metadata ? '포함' : '제외'}</p><p>파일명 접두어: {text(row.file_prefix) || '없음'}</p><div className="live-actions"><button onClick={() => setEdit({ kind: 'destination', row })}>설정 수정</button><button className="danger" onClick={() => setDeleting({ kind: 'destination', row })}>삭제</button></div></article>)}</div>}
    {(tab === 'connections' || tab === 'publications') && <WordPressPanel key={tab} mode={tab} data={data} rows={rows.slice((currentPage - 1) * 10, currentPage * 10)} command={command} />}
    {pages > 1 && <div className="live-pagination"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {pages}</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</button></div>}
    {edit?.kind === 'export' && loaded && <NewExport data={data} initialJobId={initialJobId} command={command} onClose={close} />}
    {edit?.kind === 'translation' && <TranslationForm row={edit.row} data={data} command={command} onClose={close} />}
    {edit?.kind === 'destination' && <DestinationForm row={edit.row} command={command} onClose={close} />}
    {edit?.kind === 'history' && edit.row && <LiveModal title="내보내기 메모 수정" description="이력 이름과 메모를 변경합니다. 저장된 파일 내용과 파일명은 유지됩니다." onClose={close} onSave={async form => { await command('export-update', { ...Object.fromEntries(form.entries()), export_id: edit.row!.id, expected_revision: Number(edit.row!.revision || 0) }); }}><label>이력 이름<input aria-label="이력 이름" name="title" required maxLength={200} defaultValue={text(edit.row.title)} /></label><label>메모<textarea aria-label="메모" name="notes" maxLength={5000} defaultValue={text(edit.row.notes)} rows={3} /></label></LiveModal>}
    {deleting?.row && <LiveModal title={deleting.kind === 'history' ? '보관 파일 삭제' : deleting.kind === 'translation' ? '번역문 삭제' : '파일 설정 삭제'} submit="삭제" description={deleting.kind === 'history' ? '이력과 보관 파일을 삭제합니다. 원문과 번역문은 유지됩니다.' : '선택한 항목을 삭제합니다. 이미 보관한 내보내기 파일은 유지됩니다.'} onClose={() => setDeleting(undefined)} onSave={async () => {
      const type = deleting.kind === 'history' ? 'export' : deleting.kind === 'translation' ? 'translation' : 'export-destination';
      const field = deleting.kind === 'history' ? 'export_id' : deleting.kind === 'translation' ? 'translation_id' : 'destination_id';
      await command(`${type}-delete`, { [field]: deleting.row!.id, expected_revision: Number(deleting.row!.revision || 0) });
    }} />}
  </div>;
}
