'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { CONTENT_ORIGIN, CONTENT_STATUS, type ContentData, type ContentRow as Row } from '@/lib/api/content';
import { LiveModal } from './LiveUI';
import { text, safeUrl } from './LibraryShared';
import { ContentReferences, GenerationFields } from './ContentForms';
import type { ContentResult } from './ContentPage';

type Body = { title: string; content_md: string; meta_title: string; meta_description: string };
const bodyOf = (row?: Row): Body => ({ title: text(row?.title), content_md: text(row?.content_md), meta_title: text(row?.meta_title), meta_description: text(row?.meta_description) });
type Operation = { kind: 'select' | 'restore' | 'delete-version'; draft: Row } | { kind: 'metadata' | 'generate' | 'reload' };

export function ContentEditor({ job, data, command, onLoadLatest, onDelete }: { job: Row; data: ContentData; command: (name: string, payload: Record<string, unknown>) => Promise<ContentResult>; onLoadLatest: () => Promise<ContentResult>; onDelete: () => void }) {
  const versions = data.content_drafts.filter(row => row.content_job_id === job.id).sort((a, b) => Number(b.version) - Number(a.version));
  const current = versions.find(row => row.is_selected);
  const [body, setBody] = useState(() => bodyOf(current)), [baseline, setBaseline] = useState(() => bodyOf(current));
  const [revision, setRevision] = useState(Number(job.revision || 0)), [editingId, setEditingId] = useState(current?.id);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Row>(), [operation, setOperation] = useState<Operation>();
  const dirty = JSON.stringify(body) !== JSON.stringify(baseline), stale = revision !== Number(job.revision || 0);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function adopt(result: ContentResult) {
    const next = bodyOf(result.draft); setBody(next); setBaseline(next); setRevision(Number(result.job.revision || 0)); setEditingId(result.draft?.id); setPreview(undefined); setError('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { adopt(await command('content-save', { job_id: job.id, expected_revision: revision, ...body })); setMessage('새 버전으로 저장했습니다.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  const shown = preview || current;
  const sections = data.content_compositions.filter(row => row.content_draft_id === shown?.id).sort((a, b) => Number(a.position) - Number(b.position));
  const context = shown?.generation_context as { persona?: { name: string }; knowledge?: { id: string; name: string }[] } | undefined;
  const origin = (row?: Row) => row?.origin === 'generated' && (!row.provider_receipt || (row.provider_receipt as { provider?: string }).provider === 'deterministic') ? '데모 생성' : CONTENT_ORIGIN[text(row?.origin) as keyof typeof CONTENT_ORIGIN] || '생성';
  return <>
    <section className="live-section"><div className="live-head"><div><h2>{text(job.title)}</h2><p className="muted">{text(job.target_keyword)} · {CONTENT_STATUS[(job.status || 'draft') as keyof typeof CONTENT_STATUS]} · 현재 v{text(current?.version)}</p></div><div className="live-actions"><Link href={`/app/optimize?job=${job.id}`}>최적화 시작</Link><Link href={`/app/exports?job=${job.id}`}>파일 내보내기</Link><button disabled={busy} onClick={() => setOperation({ kind: 'metadata' })}>작업 설정</button><button disabled={busy} onClick={() => setOperation({ kind: 'generate' })}>새 AI 버전 생성</button><button className="danger" disabled={busy} onClick={onDelete}>콘텐츠 삭제</button></div></div>
      {Boolean(job.notes) && <p className="live-preserve">{text(job.notes)}</p>}{safeUrl(job.source_url) && <p><a href={safeUrl(job.source_url)} target="_blank" rel="noreferrer">원문 보기</a></p>}
      <div className="live-actions">{Boolean(job.keyword_id) && <Link href={`/app/keywords/${job.keyword_id}`}>연결 키워드</Link>}{Boolean(job.geo_prompt_id) && <Link href={`/app/geo/prompts/${job.geo_prompt_id}`}>연결 프롬프트</Link>}</div>
    </section>
    {stale && <p role="alert" className="live-error">서버에 더 최신 변경이 있습니다. 입력값을 복사하거나 최신 버전을 불러온 뒤 저장해 주세요.</p>}
    {error && <p role="alert" className="live-error">{error}</p>}{message && <p role="status" className="live-status">{message}</p>}
    <div className="live-content-grid"><section className="live-card"><div className="live-head"><div><h2>본문 편집</h2><small>v{text(versions.find(row => row.id === editingId)?.version)} 기준 · {dirty ? '저장하지 않은 변경' : '저장된 내용'}</small></div><button disabled={busy} onClick={() => setOperation({ kind: 'reload' })}>최신 버전 불러오기</button></div>
      <form className="live-content-form" onSubmit={save}><fieldset disabled={busy}>
        <label>제목<input aria-label="제목" required maxLength={200} value={body.title} onChange={event => setBody({ ...body, title: event.target.value })} /></label>
        <label>본문 (Markdown)<textarea aria-label="본문 (Markdown)" required maxLength={100000} rows={18} value={body.content_md} onChange={event => setBody({ ...body, content_md: event.target.value })} /></label>
        <small>## 제목을 입력하면 저장된 버전의 본문 구성에 반영됩니다. {body.content_md.length.toLocaleString()} / 100,000자</small>
        <label>검색 제목<input aria-label="검색 제목" maxLength={200} value={body.meta_title} onChange={event => setBody({ ...body, meta_title: event.target.value })} /></label>
        <label>검색 설명<textarea aria-label="검색 설명" maxLength={1000} rows={3} value={body.meta_description} onChange={event => setBody({ ...body, meta_description: event.target.value })} /></label>
        <button type="submit" className="primary" disabled={!dirty || stale || busy}>{busy ? '저장 중…' : '새 버전 저장'}</button>
      </fieldset></form>
    </section><aside className="live-card"><h2>버전 이력</h2><p className="muted">선택은 현재 사용 버전을 바꿉니다. 복원은 기존 내용을 새 버전으로 복사합니다.</p><div className="live-version-list">{versions.map(row => <article key={row.id} className="live-version"><h3>v{text(row.version)} {row.is_selected ? <span className="live-badge">현재</span> : null}</h3><p>{text(row.title)}</p><small>{origin(row)}{row.restored_from_version ? ` · v${row.restored_from_version}에서 복원` : ''} · {text(row.created_at).replace('T', ' ').slice(0, 16)}</small><div className="live-actions"><button onClick={() => setPreview(row)}>미리보기 v{text(row.version)}</button><button disabled={busy || Boolean(row.is_selected)} onClick={() => setOperation({ kind: 'select', draft: row })}>선택 v{text(row.version)}</button><button disabled={busy} onClick={() => setOperation({ kind: 'restore', draft: row })}>복원 v{text(row.version)}</button><button className="danger" disabled={busy || Boolean(row.is_selected)} onClick={() => setOperation({ kind: 'delete-version', draft: row })}>삭제 v{text(row.version)}</button></div></article>)}</div></aside></div>
    {shown && <section className="live-section live-card"><div className="live-head"><h2>저장된 본문 · v{text(shown.version)}</h2>{preview && <button onClick={() => setPreview(undefined)}>현재 버전 보기</button>}</div><p className="muted">{origin(shown)} · {text(shown.word_count)}개 단어(공백 기준). 생성 출처: {text((shown.provider_receipt as { provider?: string } | undefined)?.provider) || (shown.origin === 'generated' ? '이전 데모 자료' : '직접 작성/편집')}. 생성만으로 SEO 성과를 측정하지 않습니다.</p><h3 className="live-section">본문 구성</h3><ol>{sections.map(section => <li key={section.id}>{text(section.heading)}</li>)}</ol><pre className="live-answer">{text(shown.content_md)}</pre><details><summary>생성 당시 참조 자료</summary><p>페르소나: {context?.persona?.name || '사용 안 함'}</p><ul>{context?.knowledge?.map(row => <li key={row.id}>{row.name}</li>)}</ul><p className="muted">원본 자료가 변경·삭제되어도 이 버전에 저장된 참조 내용은 유지됩니다.</p></details></section>}
    {operation && <LiveModal
      title={operation.kind === 'metadata' ? '작업 설정' : operation.kind === 'generate' ? '새 AI 버전 생성' : operation.kind === 'reload' ? '최신 버전 불러오기' : `버전 ${operation.kind === 'select' ? '선택' : operation.kind === 'restore' ? '복원' : '삭제'}`}
      submit={operation.kind === 'metadata' ? '저장' : operation.kind === 'generate' ? '생성' : operation.kind === 'reload' ? '불러오기' : operation.kind === 'delete-version' ? '삭제' : '적용'}
      description={operation.kind === 'generate' ? '선택한 문체와 자료를 OpenAI로 전송하고 새 버전을 저장합니다. 생성 사용량 1회와 외부 API 비용이 발생합니다. 저장하지 않은 편집 내용은 사라집니다.' : operation.kind === 'delete-version' ? '이 버전을 영구 삭제합니다. 현재 버전과 최적화가 참조하는 버전은 삭제할 수 없습니다. 저장하지 않은 편집 내용도 사라집니다.' : operation.kind === 'metadata' ? '주제, 상태, 메모와 연결을 변경합니다. 저장하지 않은 본문 편집은 유지됩니다.' : '선택한 버전을 불러옵니다. 저장하지 않은 편집 내용은 사라집니다.'}
      onClose={() => setOperation(undefined)} onSave={async form => {
        if (operation.kind === 'reload') { adopt(await onLoadLatest()); return; }
        const values = operation.kind === 'metadata' ? { ...Object.fromEntries(form.entries()), keyword_id: form.get('keyword_id') || null, geo_prompt_id: form.get('geo_prompt_id') || null } : operation.kind === 'generate' ? { target_keyword: job.target_keyword, title: job.title, writing_style_profile_id: form.get('writing_style_profile_id') || null, knowledge_entity_ids: form.getAll('knowledge_entity_ids'), idempotency_key: crypto.randomUUID() } : 'draft' in operation ? { draft_id: operation.draft.id } : {};
        const result = await command(operation.kind === 'generate' ? 'content-draft' : operation.kind === 'metadata' ? 'content-update' : `content-${operation.kind}`, { job_id: job.id, expected_revision: revision, ...values });
        if (operation.kind === 'metadata') { setRevision(Number(result.job.revision || 0)); setError(''); } else adopt(result);
        setMessage('변경 사항을 저장했습니다.');
      }}>
      {operation.kind === 'metadata' && <><label>주제<input aria-label="주제" name="target_keyword" defaultValue={text(job.target_keyword)} required maxLength={200} /></label><label>작업 상태<select aria-label="작업 상태" name="status" defaultValue={text(job.status || 'draft')}>{Object.entries(CONTENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>작업 메모<textarea aria-label="작업 메모" name="notes" defaultValue={text(job.notes)} maxLength={5000} /></label><label>원문 URL<input aria-label="원문 URL" type="url" name="source_url" defaultValue={text(job.source_url)} maxLength={2000} /></label><ContentReferences data={data} job={job} /></>}
      {operation.kind === 'generate' && <GenerationFields data={data} job={job} />}
    </LiveModal>}
  </>;
}
