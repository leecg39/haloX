'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KNOWLEDGE_TYPES, MAX_LIBRARY_FILE_BYTES, type LibraryRow as Row } from '@/lib/api/library';
import { EmptyState, LiveModal } from './LiveUI';
import { GenerateFromLibrary, LibraryContentHistory, LibraryWorkspace, safeUrl, text, useLibrary, type LibraryEdit } from './LibraryShared';

const names: Record<string, string> = { knowledge_entities: '자료', knowledge_entity_sources: '출처', evidence_contexts: '근거 메모', keyword_knowledge_entities: '키워드 연결' };
export function KnowledgePage({ entityId }: { entityId?: string }) {
  return <LibraryWorkspace>{(id, name) => <KnowledgeWorkspace key={id} workspaceId={id} workspaceName={name} entityId={entityId} />}</LibraryWorkspace>;
}

function KnowledgeWorkspace({ workspaceId, workspaceName, entityId }: { workspaceId: string; workspaceName: string; entityId?: string }) {
  const router = useRouter(), api = useLibrary(workspaceId);
  const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [edit, setEdit] = useState<LibraryEdit | null>(null), [deleting, setDeleting] = useState<LibraryEdit | null>(null), [upload, setUpload] = useState(false), [generate, setGenerate] = useState(false);
  const detail = api.data.knowledge_entities.find(row => row.id === entityId);
  const sources = api.data.knowledge_entity_sources.filter(row => row.knowledge_entity_id === entityId);
  const contexts = api.data.evidence_contexts.filter(row => row.knowledge_entity_id === entityId);
  const links = api.data.keyword_knowledge_entities.filter(row => row.knowledge_entity_id === entityId);
  const jobs = api.data.content_jobs.filter(job => Array.isArray(job.knowledge_entity_ids) && job.knowledge_entity_ids.includes(entityId));
  const filtered = api.data.knowledge_entities.filter(row => (!kind || row.knowledge_type === kind) && `${row.name} ${row.description || ''} ${row.body || ''}`.toLowerCase().includes(query.toLowerCase()));
  const actions = (table: LibraryEdit['table'], row: Row) => <div className="live-actions"><button disabled={api.busy} onClick={() => setEdit({ table, row })}>편집</button><button disabled={api.busy} className="danger" onClick={() => setDeleting({ table, row })}>삭제</button></div>;
  const add = (table: LibraryEdit['table']) => setEdit({ table, parentId: entityId });
  return <div className="live" aria-busy={api.busy || api.loading}>
    <div className="live-head"><div>{entityId && <Link href="/app/knowledgehub" className="muted">← 자료실 목록</Link>}<h1>{entityId ? '자료 상세' : '자료실'}</h1><p>{workspaceName} · 콘텐츠에 사용할 사실, 원문과 출처를 보관합니다.</p></div><div className="live-actions"><button disabled={api.loading || api.busy} onClick={() => void api.reload()}>새로고침</button>{!entityId && <button disabled={api.loading} className="primary" onClick={() => add('knowledge_entities')}>자료 추가</button>}</div></div>
    {api.notices}
    {api.loaded && (entityId ? detail ? <>
      <section className="live-card live-library-detail"><div className="live-head"><h2>{text(detail.name)} <span className="live-badge">{KNOWLEDGE_TYPES[text(detail.knowledge_type) as keyof typeof KNOWLEDGE_TYPES] || '기타'}</span></h2>{actions('knowledge_entities', detail)}</div>
        <p className="live-preserve">{text(detail.description) || '설명 없음'}</p>{safeUrl(detail.base_url) && <p><a href={safeUrl(detail.base_url)} target="_blank" rel="noopener noreferrer">대표 URL ↗</a></p>}
        <pre className="live-answer">{text(detail.body) || '등록된 본문이 없습니다.'}</pre><button className="primary" onClick={() => setGenerate(true)}>이 자료로 초안 생성</button>
      </section>
      <section className="live-section"><div className="live-head"><h2>출처와 파일</h2><div className="live-actions"><button onClick={() => add('knowledge_entity_sources')}>출처 추가</button><button onClick={() => setUpload(true)}>파일 업로드</button></div></div>
        <p className="muted">URL은 출처 링크로 저장합니다. TXT·MD 본문은 읽어 저장하며 PDF는 원본 보관 후 요약을 직접 입력할 수 있습니다.</p>
        {sources.length ? <div className="live-history">{sources.map(row => <article className="live-card" key={row.id}><div className="live-head"><h3>{text(row.title)} <span className="live-badge">{row.source_type === 'file' ? '파일' : row.source_type === 'url' ? 'URL' : '텍스트'}</span></h3>{actions('knowledge_entity_sources', row)}</div>
          {safeUrl(row.url) && <p><a href={safeUrl(row.url)} target="_blank" rel="noopener noreferrer">{text(row.url)} ↗</a></p>}
          {row.source_type === 'file' && <p><a href={`/api/v1/library/files/${row.id}`}>원본 다운로드: {text(row.filename)}</a> <small>{Number(row.byte_size).toLocaleString()}바이트</small></p>}
          <pre className="live-answer">{text(row.content) || '본문 또는 요약이 아직 없습니다.'}</pre>
        </article>)}</div> : <EmptyState>등록된 출처가 없습니다.</EmptyState>}
      </section>
      <section className="live-section"><div className="live-head"><h2>근거 메모</h2><button onClick={() => add('evidence_contexts')}>근거 메모 추가</button></div>
        {contexts.length ? <div className="live-grid">{contexts.map(row => <article className="live-card" key={row.id}><h3>{text(row.title)}</h3><p className="muted">출처: {text(sources.find(source => source.id === row.source_id)?.title) || '연결 없음'}</p><pre className="live-answer">{text(row.content)}</pre>{actions('evidence_contexts', row)}</article>)}</div> : <EmptyState>등록된 근거 메모가 없습니다.</EmptyState>}
      </section>
      <section className="live-section"><div className="live-head"><h2>연결된 키워드</h2><button onClick={() => add('keyword_knowledge_entities')}>키워드 연결</button></div>
        {links.length ? <div className="live-grid">{links.map(row => <article className="live-card" key={row.id}><p><Link href={`/app/keywords/${row.keyword_id}`}>{text(api.data.keywords.find(keyword => keyword.id === row.keyword_id)?.keyword)}</Link></p>{actions('keyword_knowledge_entities', row)}</article>)}</div> : <EmptyState>연결된 키워드가 없습니다.</EmptyState>}
      </section>
      <LibraryContentHistory data={api.data} jobs={jobs} />
    </> : <EmptyState>자료를 찾을 수 없습니다. 삭제되었거나 현재 워크스페이스에 속하지 않습니다.</EmptyState> : <>
      <div className="live-toolbar"><input aria-label="자료 검색" placeholder="이름·본문 검색…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="자료 유형 필터" value={kind} onChange={event => setKind(event.target.value)}><option value="">전체 유형</option>{Object.entries(KNOWLEDGE_TYPES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><span className="muted">총 {filtered.length}개</span></div>
      {filtered.length ? <div className="live-grid">{filtered.map(row => <article className="live-card" key={row.id}><span className="live-badge">{KNOWLEDGE_TYPES[text(row.knowledge_type) as keyof typeof KNOWLEDGE_TYPES] || '기타'}</span><h2><Link href={`/app/knowledgehub/${row.id}`}>{text(row.name)}</Link></h2><p className="live-preserve">{text(row.description) || '설명 없음'}</p><p className="muted">출처 {api.data.knowledge_entity_sources.filter(source => source.knowledge_entity_id === row.id).length}개 · 근거 {api.data.evidence_contexts.filter(context => context.knowledge_entity_id === row.id).length}개</p><div className="live-toolbar">{actions('knowledge_entities', row)}</div></article>)}</div> : <EmptyState>{query || kind ? '검색 결과가 없습니다.' : '등록된 자료가 없습니다. 새 자료를 추가해 주세요.'}</EmptyState>}
    </>)}
    {edit && <LiveModal title={`${names[edit.table]} ${edit.row ? '편집' : '추가'}`} onClose={() => setEdit(null)} onSave={async form => {
      const values: Record<string, unknown> = Object.fromEntries(form);
      if (edit.table !== 'knowledge_entities') values.knowledge_entity_id = edit.row?.knowledge_entity_id || edit.parentId;
      if (edit.table === 'evidence_contexts') values.source_id ||= null;
      await api.action(() => api.save(edit.table, values, edit.row));
    }}>
      {edit.table === 'knowledge_entities' ? <>
        <label>이름<input name="name" aria-label="이름" required maxLength={100} defaultValue={text(edit.row?.name)} /></label>
        <label>자료 유형<select name="knowledge_type" aria-label="자료 유형" defaultValue={text(edit.row?.knowledge_type || 'other')}>{Object.entries(KNOWLEDGE_TYPES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label>설명<textarea name="description" aria-label="설명" maxLength={2000} defaultValue={text(edit.row?.description)} /></label>
        <label>본문<textarea name="body" aria-label="본문" maxLength={100000} defaultValue={text(edit.row?.body)} /></label>
        <label>대표 URL (선택)<input name="base_url" aria-label="대표 URL" type="url" maxLength={2000} defaultValue={text(edit.row?.base_url)} /></label>
      </> : edit.table === 'keyword_knowledge_entities' ? <label>키워드<select required name="keyword_id" aria-label="키워드" defaultValue={text(edit.row?.keyword_id)}><option value="">선택</option>{api.data.keywords.map(row => <option key={row.id} value={row.id}>{text(row.keyword)}</option>)}</select></label> : <>
        <label>제목<input name="title" aria-label="제목" required maxLength={200} defaultValue={text(edit.row?.title)} /></label>
        {edit.table === 'knowledge_entity_sources' ? <>
          {edit.row ? <input type="hidden" name="source_type" value={text(edit.row.source_type)} /> : <label>출처 유형<select name="source_type" aria-label="출처 유형" defaultValue="text"><option value="text">텍스트</option><option value="url">URL</option></select></label>}
          <label>출처 URL<input name="url" aria-label="출처 URL" type="url" maxLength={2000} defaultValue={text(edit.row?.url)} /></label>
        </> : <label>연결 출처<select name="source_id" aria-label="연결 출처" defaultValue={text(edit.row?.source_id)}><option value="">연결 없음</option>{sources.map(row => <option key={row.id} value={row.id}>{text(row.title)}</option>)}</select></label>}
        <label>본문 / 요약<textarea name="content" aria-label="본문 / 요약" maxLength={edit.table === 'evidence_contexts' ? 20000 : 100000} required={edit.table === 'evidence_contexts'} defaultValue={text(edit.row?.content)} /></label>
      </>}
    </LiveModal>}
    {upload && <LiveModal title="파일 업로드" submit="업로드" description="PDF·TXT·MD, 파일당 5MB / 워크스페이스당 50MB. 텍스트는 UTF-8 10만 자 이하입니다." onClose={() => setUpload(false)} onSave={async form => {
      const file = form.get('file');
      if (!(file instanceof File) || !file.size) throw new Error('파일을 선택해 주세요.');
      if (file.size > MAX_LIBRARY_FILE_BYTES) throw new Error('파일 크기는 5MB 이하로 제한됩니다.');
      form.set('workspace_id', workspaceId); form.set('knowledge_entity_id', entityId!);
      await api.action(async () => { const response = await fetch('/api/v1/library/files', { method: 'POST', body: form }), result = await response.json(); if (!response.ok) throw new Error(result.error || '업로드하지 못했습니다.'); }, '파일을 저장했습니다.');
    }}><label>제목 (선택)<input name="title" aria-label="제목 (선택)" maxLength={200} /></label><label>파일<input name="file" aria-label="파일" type="file" accept=".pdf,.txt,.md" required /></label></LiveModal>}
    {deleting?.row && <LiveModal title="삭제 확인" submit="삭제" description={deleting.table === 'knowledge_entities' ? '자료와 출처·파일·근거 메모·키워드 연결을 삭제합니다. 기존 콘텐츠와 생성 당시 자료는 보존됩니다.' : deleting.table === 'knowledge_entity_sources' ? '출처와 원본 파일을 삭제합니다. 근거 메모는 출처 연결을 해제하여 보존됩니다.' : '선택한 항목을 삭제합니다.'} onClose={() => setDeleting(null)} onSave={async () => {
      await api.action(() => api.remove(deleting.table, deleting.row!), '삭제했습니다.');
      if (deleting.table === 'knowledge_entities' && entityId === deleting.row?.id) router.push('/app/knowledgehub');
    }}><p>{text(deleting.row.name || deleting.row.title || '키워드 연결')}</p></LiveModal>}
    {generate && <GenerateFromLibrary data={api.data} workspaceId={workspaceId} entityId={entityId} onClose={() => setGenerate(false)} onComplete={api.reload} />}
  </div>;
}
