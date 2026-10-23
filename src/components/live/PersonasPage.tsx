'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LibraryRow as Row } from '@/lib/api/library';
import { EmptyState, LiveModal } from './LiveUI';
import { GenerateFromLibrary, LibraryContentHistory, LibraryWorkspace, safeUrl, text, useLibrary, type LibraryEdit } from './LibraryShared';

export function PersonasPage({ personaId }: { personaId?: string }) {
  return <LibraryWorkspace>{(id, name) => <PersonasWorkspace key={id} workspaceId={id} workspaceName={name} personaId={personaId} />}</LibraryWorkspace>;
}

function PersonasWorkspace({ workspaceId, workspaceName, personaId }: { workspaceId: string; workspaceName: string; personaId?: string }) {
  const router = useRouter(), api = useLibrary(workspaceId);
  const [query, setQuery] = useState(''), [edit, setEdit] = useState<LibraryEdit | null>(null), [deleting, setDeleting] = useState<LibraryEdit | null>(null), [generate, setGenerate] = useState(false);
  const detail = api.data.writing_style_profiles.find(row => row.id === personaId);
  const filtered = api.data.writing_style_profiles.filter(row => `${row.name} ${row.description || ''} ${row.audience || ''}`.toLowerCase().includes(query.toLowerCase()));
  const actions = (table: LibraryEdit['table'], row: Row) => <div className="live-actions"><button disabled={api.busy} onClick={() => setEdit({ table, row })}>편집</button><button disabled={api.busy} className="danger" onClick={() => setDeleting({ table, row })}>삭제</button></div>;
  const jobs = api.data.content_jobs.filter(job => job.writing_style_profile_id === personaId);
  return <div className="live" aria-busy={api.busy || api.loading}>
    <div className="live-head"><div>{personaId && <Link href="/app/personas" className="muted">← 페르소나 목록</Link>}<h1>{personaId ? '페르소나 상세' : '페르소나'}</h1><p>{workspaceName} · 콘텐츠의 독자와 문체, 작성 예문을 관리합니다.</p></div><div className="live-actions"><button disabled={api.loading || api.busy} onClick={() => void api.reload()}>새로고침</button>{!personaId && <button disabled={api.loading} className="primary" onClick={() => setEdit({ table: 'writing_style_profiles' })}>페르소나 추가</button>}</div></div>
    {api.notices}
    {api.loaded && (personaId ? detail ? <>
      <section className="live-card live-library-detail"><div className="live-head"><h2>{text(detail.name)} {detail.is_default === true && <span className="live-badge">기본</span>}</h2>{actions('writing_style_profiles', detail)}</div>
        <p className="live-preserve">{text(detail.description) || '설명 없음'}</p>
        <dl className="live-definition"><dt>대상 독자</dt><dd>{text(detail.audience) || '미지정'}</dd><dt>문체 지침</dt><dd>{text(detail.tone) || '미지정'}</dd><dt>금지어</dt><dd>{Array.isArray(detail.forbidden_terms) && detail.forbidden_terms.length ? detail.forbidden_terms.map(String).join(', ') : '없음'}</dd></dl>
        <div className="live-actions">{!detail.is_default === true && <button disabled={api.busy} onClick={() => api.run(() => api.save('writing_style_profiles', { is_default: true }, detail), '기본 페르소나로 설정했습니다.')}>기본으로 설정</button>}<button onClick={() => setGenerate(true)} className="primary">이 페르소나로 초안 생성</button></div>
      </section>
      <section className="live-section"><div className="live-head"><h2>작성 예문</h2><button onClick={() => setEdit({ table: 'writing_style_samples', parentId: detail.id })}>예문 추가</button></div>
        {api.data.writing_style_samples.some(row => row.writing_style_profile_id === detail.id) ? <div className="live-grid">{api.data.writing_style_samples.filter(row => row.writing_style_profile_id === detail.id).map(row => <article className="live-card" key={row.id}><h3>{text(row.title)}</h3><pre className="live-answer">{text(row.content)}</pre>{safeUrl(row.source_url) && <p><a href={safeUrl(row.source_url)} target="_blank" rel="noopener noreferrer">원문 출처 ↗</a></p>}{actions('writing_style_samples', row)}</article>)}</div> : <EmptyState>등록된 예문이 없습니다.</EmptyState>}
      </section>
      <LibraryContentHistory data={api.data} jobs={jobs} />
    </> : <EmptyState>페르소나를 찾을 수 없습니다. 삭제되었거나 현재 워크스페이스에 속하지 않습니다.</EmptyState> : <>
      <div className="live-toolbar"><input aria-label="페르소나 검색" placeholder="이름·독자 검색…" value={query} onChange={event => setQuery(event.target.value)} /><span className="muted">총 {filtered.length}개</span></div>
      {filtered.length ? <div className="live-grid">{filtered.map(row => <article className="live-card" key={row.id}><h2><Link href={`/app/personas/${row.id}`}>{text(row.name)}</Link>{row.is_default === true && <span className="live-badge">기본</span>}</h2><p className="live-preserve">{text(row.description) || '설명 없음'}</p><p className="muted">예문 {api.data.writing_style_samples.filter(sample => sample.writing_style_profile_id === row.id).length}개 · 콘텐츠 {api.data.content_jobs.filter(job => job.writing_style_profile_id === row.id).length}개</p><div className="live-toolbar">{actions('writing_style_profiles', row)}{!row.is_default && <button disabled={api.busy} onClick={() => api.run(() => api.save('writing_style_profiles', { is_default: true }, row), '기본 페르소나로 설정했습니다.')}>기본으로 설정</button>}</div></article>)}</div> : <EmptyState>{query ? '검색 결과가 없습니다.' : '등록된 페르소나가 없습니다. 새 페르소나를 추가해 주세요.'}</EmptyState>}
    </>)}
    {edit && <LiveModal title={`${edit.table === 'writing_style_profiles' ? '페르소나' : '예문'} ${edit.row ? '편집' : '추가'}`} onClose={() => setEdit(null)} onSave={async form => {
      const values: Record<string, unknown> = Object.fromEntries(form);
      if (edit.table === 'writing_style_profiles') { values.is_default = form.has('is_default'); values.forbidden_terms = text(form.get('forbidden_terms')).split(/\r?\n/).map(term => term.trim()).filter(Boolean); }
      else values.writing_style_profile_id = edit.row?.writing_style_profile_id || edit.parentId;
      await api.action(() => api.save(edit.table, values, edit.row));
    }}>
      {edit.table === 'writing_style_profiles' ? <>
        <label>이름<input name="name" aria-label="이름" required maxLength={100} defaultValue={text(edit.row?.name)} /></label>
        <label>설명<textarea name="description" aria-label="설명" maxLength={2000} defaultValue={text(edit.row?.description)} /></label>
        <label>대상 독자<textarea name="audience" aria-label="대상 독자" maxLength={1000} defaultValue={text(edit.row?.audience)} /></label>
        <label>문체 지침<textarea name="tone" aria-label="문체 지침" maxLength={1000} defaultValue={text(edit.row?.tone)} placeholder="예: 짧은 문장과 객관적인 근거로 설명" /></label>
        <label>금지어 (한 줄에 하나)<textarea name="forbidden_terms" aria-label="금지어" defaultValue={Array.isArray(edit.row?.forbidden_terms) ? edit.row.forbidden_terms.join('\n') : ''} /></label>
        <label className="check"><input name="is_default" type="checkbox" defaultChecked={edit.row?.is_default === true} />기본 페르소나</label>
      </> : <>
        <label>제목<input name="title" aria-label="제목" required maxLength={100} defaultValue={text(edit.row?.title)} /></label>
        <label>예문 본문<textarea name="content" aria-label="예문 본문" required maxLength={10000} defaultValue={text(edit.row?.content)} /></label>
        <label>원문 URL (선택)<input name="source_url" aria-label="원문 URL" type="url" maxLength={2000} defaultValue={text(edit.row?.source_url)} /></label>
      </>}
    </LiveModal>}
    {deleting?.row && <LiveModal title="삭제 확인" submit="삭제" description={deleting.table === 'writing_style_profiles' ? '페르소나와 예문을 삭제하고 콘텐츠 연결을 해제합니다. 기존 콘텐츠와 생성 당시 문체는 보존됩니다.' : '이 예문을 삭제합니다. 기존 콘텐츠는 보존됩니다.'} onClose={() => setDeleting(null)} onSave={async () => {
      await api.action(() => api.remove(deleting.table, deleting.row!), '삭제했습니다.');
      if (deleting.table === 'writing_style_profiles' && personaId === deleting.row?.id) router.push('/app/personas');
    }}><p>{text(deleting.row.name || deleting.row.title)}</p></LiveModal>}
    {generate && <GenerateFromLibrary data={api.data} workspaceId={workspaceId} personaId={personaId} onClose={() => setGenerate(false)} onComplete={api.reload} />}
  </div>;
}
