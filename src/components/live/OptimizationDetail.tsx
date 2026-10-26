'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CHANGE_FIELDS, CHANGE_OPERATIONS, REVIEW_STATUS, type OptimizationData } from '@/lib/api/optimization';
import type { ContentRow as Row } from '@/lib/api/content';
import { LiveModal } from './LiveUI';
import { safeUrl, text } from './LibraryShared';
import type { ReviewCommand } from './OptimizationPage';

export function OptimizationDetail({ run, data, command, onDelete }: { run: Row; data: OptimizationData; command: ReviewCommand; onDelete: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [pendingSelection, setPendingSelection] = useState<{ id: string; checked: boolean }>();
  const [modal, setModal] = useState<'metadata' | 'apply' | 'restore'>(), [edit, setEdit] = useState<{ row?: Row }>(), [deleting, setDeleting] = useState<Row>();
  const changes = data.content_change_items.filter(row => row.review_run_id === run.id).sort((a, b) => Number(a.position) - Number(b.position));
  const job = data.content_jobs.find(row => row.id === run.content_job_id), source = run.source_snapshot as Row | undefined;
  const output = data.content_drafts.find(row => row.id === (run.reverted_draft_id || run.applied_draft_id));
  const audit = run.audit as Record<string, unknown> | undefined;
  const serp = run.serp_result as { topResults: { url: string; title: string; rank: number }[]; paaQuestions: string[] } | undefined;
  const stage = ['audited', 'collected', 'proposed', 'applied', 'reverted'].indexOf(text(run.status));
  const currentDraftId = job?.current_draft_id || data.content_drafts.find(row => row.content_job_id === job?.id && row.is_selected)?.id;
  const stale = Boolean(job && (currentDraftId !== run.base_draft_id || Number(job.revision || 0) !== Number(run.base_job_revision)));
  const selected = changes.filter(row => row.status === 'proposed');
  const execute = (name: string, values: Record<string, unknown> = {}) => command(name, { ...values, review_run_id: run.id, expected_revision: Number(run.revision || 0) });
  async function action(name: string, values: Record<string, unknown> = {}) {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    try { await execute(name, values); setMessage('변경 사항을 저장했습니다.'); } catch (cause) { setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.'); } finally { setBusy(false); }
  }
  return <section className="live-section"><header className="live-head"><div><h2>{text(run.title || run.target_keyword)}</h2><p className="muted">{text(run.target_keyword)} · {REVIEW_STATUS[text(run.status) as keyof typeof REVIEW_STATUS] || '이전 데모'}</p></div><div className="live-actions"><button disabled={busy} onClick={() => setModal('metadata')}>진단 설정</button><button className="danger" disabled={busy} onClick={onDelete}>최적화 삭제</button></div></header>
    {Boolean(run.notes) && <p className="live-preserve">{text(run.notes)}</p>}{safeUrl(run.url) && <p><a href={safeUrl(run.url)} target="_blank" rel="noreferrer">가져온 원문 보기</a></p>}
    {!source ? <p className="live-error">이전 데모 이력입니다. 새 최적화에서 원문을 등록해 주세요.</p> : <>
      <div className="live-actions live-section"><Link href={`/app/factory/${run.content_job_id}`}>제작소에서 본문·버전 보기</Link><Link href={`/app/optimize?job=${run.content_job_id}`}>현재 버전으로 새 진단</Link></div>
      <ol className="live-review-steps">{['본문 진단', '검색 참고 수집', '제안 검토', '본문 적용'].map((label, index) => <li key={label} aria-current={Math.min(stage, 3) === index ? 'step' : undefined}><span>{index + 1}</span>{label}{stage > index ? ' ✓' : ''}</li>)}</ol>
      {audit && <div className="live-kpis"><div className="live-card"><small>원문 글자 수</small><strong>{Number(audit.character_count).toLocaleString()}</strong></div><div className="live-card"><small>구성 수</small><strong>{text(audit.section_count)}</strong></div><div className="live-card"><small>검색 설명</small><strong>{audit.has_meta_description ? '있음' : '없음'}</strong></div><div className="live-card"><small>요약 제목</small><strong>{audit.has_summary ? '있음' : '없음'}</strong></div></div>}
      {error && <p role="alert" className="live-error">{error}</p>}{message && <p role="status" className="live-status">{message}</p>}
      {run.status === 'audited' && <button className="primary" disabled={busy} onClick={() => void action('optimize-serp-fetch')}>{busy ? '수집 중…' : '2단계: 검색 참고 수집'}</button>}
      {serp && <section className="live-section live-card"><h3>검색 참고 · {text(run.search_provider || '이전 데모 자료')}</h3><ul>{serp.topResults.map((result, index) => <li key={`${result.url}:${index}`}><a href={safeUrl(result.url)} target="_blank" rel="noreferrer">{result.rank}. {result.title}</a></li>)}</ul><p className="muted">수집 시점의 검색 참고입니다. 출처가 deterministic인 이력은 모의 자료입니다. AI 제안의 사실관계와 인용은 적용 전에 확인해 주세요.</p></section>}
      {run.status === 'collected' && <div className="live-section"><button className="primary" disabled={busy} onClick={() => void action('optimize-strategy-synthesis')}>{busy ? '생성 중…' : '3단계: 변경 제안 생성'}</button></div>}
      {stage >= 2 && <section className="live-section"><div className="live-head"><div><h2>변경 제안</h2><p className="muted">목록 순서대로 적용합니다. 제외한 제안은 본문에 반영하지 않습니다.</p></div>{run.status === 'proposed' && <button disabled={busy} onClick={() => setEdit({})}>제안 추가</button>}</div>
        <div className="live-history">{changes.map(change => <article key={change.id} className="live-card"><div className="live-head"><div><h3>{text(change.section_title)}</h3><small>{CHANGE_FIELDS[text(change.target_field) as keyof typeof CHANGE_FIELDS]} · {CHANGE_OPERATIONS[text(change.operation) as keyof typeof CHANGE_OPERATIONS]} · {change.status === 'applied' ? '적용됨' : change.status === 'excluded' ? '제외됨' : '검토 중'}</small></div>{run.status === 'proposed' && <div className="live-actions"><label><input type="checkbox" aria-label={`적용 대상: ${change.section_title}`} checked={pendingSelection?.id === change.id ? pendingSelection.checked : change.status === 'proposed'} disabled={busy} onChange={event => { const checked = event.target.checked; setPendingSelection({ id: change.id, checked }); void action('optimize-change-update', { change_id: change.id, status: checked ? 'proposed' : 'excluded' }).finally(() => setPendingSelection(undefined)); }} /> 적용 대상</label><button disabled={busy} onClick={() => setEdit({ row: change })}>편집</button><button className="danger" disabled={busy} onClick={() => setDeleting(change)}>삭제</button></div>}</div><p>{text(change.rationale)}</p><div className="live-grid"><div><small>변경 전{change.operation !== 'replace' ? ' (추가)' : ''}</small><pre className="live-answer">{text(change.before_text) || '(없음)'}</pre></div><div><small>변경 후</small><pre className="live-answer">{text(change.after_text) || '(삭제)'}</pre></div></div></article>)}</div>
        {run.status === 'proposed' && <div className="live-section">{stale && <p role="alert" className="live-error">진단 이후 콘텐츠가 변경되었습니다. 현재 버전으로 새 진단을 시작해 주세요.</p>}<button className="primary" disabled={busy || stale || !selected.length} onClick={() => setModal('apply')}>선택한 {selected.length}개 제안 적용</button></div>}
      </section>}
      {run.status === 'applied' && <div className="live-section"><button disabled={busy || !job} onClick={() => setModal('restore')}>적용 전 원본 복원</button></div>}
      <div className="live-grid live-section"><details className="live-card"><summary>진단 원문 · v{text(source.version)}</summary><pre className="live-answer">{text(source.content_md)}</pre><p>검색 설명: {text(source.meta_description) || '없음'}</p></details>{output && <details open className="live-card"><summary>{run.status === 'reverted' ? '원본 복원 결과' : '적용 결과'} · v{text(output.version)}</summary><pre className="live-answer">{text(output.content_md)}</pre><p>검색 설명: {text(output.meta_description) || '없음'}</p></details>}</div>
    </>}
    {modal && <LiveModal title={modal === 'metadata' ? '진단 설정' : modal === 'apply' ? '변경 제안 적용' : '원본 복원'} submit={modal === 'metadata' ? '저장' : modal === 'apply' ? '적용' : '복원'} description={modal === 'metadata' ? '진단 이름과 메모를 수정합니다. 원문은 보존됩니다.' : modal === 'apply' ? '선택한 제안을 새 본문 버전에 반영합니다. 진단 이후 원문이 변경되었거나 제안이 서로 충돌하면 저장하지 않습니다.' : '적용 전 원문을 새 버전으로 복원합니다. 적용 후 다른 버전으로 변경했다면 제작소에서 복원할 버전을 선택해 주세요.'} onClose={() => setModal(undefined)} onSave={async form => { await execute(modal === 'metadata' ? 'optimize-review-update' : modal === 'apply' ? 'optimize-rewrite-content' : 'optimize-restore-original', modal === 'metadata' ? Object.fromEntries(form.entries()) : modal === 'apply' ? { change_ids: selected.map(row => row.id) } : { expected_content_revision: Number(job?.revision || 0) }); setError(''); }}>
      {modal === 'metadata' && <><label>진단 이름<input aria-label="진단 이름" name="title" defaultValue={text(run.title || run.target_keyword)} required maxLength={200} /></label><label>메모<textarea aria-label="메모" name="notes" defaultValue={text(run.notes)} maxLength={5000} /></label></>}
    </LiveModal>}
    {edit && source && <ChangeEditor row={edit.row} source={source} onClose={() => setEdit(undefined)} onSave={async values => { await execute(edit.row ? 'optimize-change-update' : 'optimize-change-create', { ...values, ...(edit.row ? { change_id: edit.row.id } : {}) }); }} />}
    {deleting && <LiveModal title="제안 삭제" submit="삭제" description="이 제안을 삭제합니다. 원문 본문은 유지됩니다." onClose={() => setDeleting(undefined)} onSave={async () => { await execute('optimize-change-delete', { change_id: deleting.id }); }} />}
  </section>;
}

function ChangeEditor({ row, source, onSave, onClose }: { row?: Row; source: Row; onSave: (values: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const [field, setField] = useState(text(row?.target_field || 'content_md')), [operation, setOperation] = useState(text(row?.operation || 'append')), [before, setBefore] = useState(text(row?.before_text));
  return <LiveModal title={row ? '제안 편집' : '제안 추가'} onClose={onClose} onSave={async form => { await onSave({ ...Object.fromEntries(form.entries()), target_field: field, operation, before_text: before, status: row?.status || 'proposed' }); }}>
    <label>제안 제목<input aria-label="제안 제목" name="section_title" defaultValue={text(row?.section_title)} required maxLength={200} /></label>
    <label>변경 대상<select aria-label="변경 대상" value={field} onChange={event => { setField(event.target.value); setOperation('replace'); setBefore(text(source[event.target.value])); }}>{Object.entries(CHANGE_FIELDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>적용 방법<select aria-label="적용 방법" value={operation} onChange={event => setOperation(event.target.value)}>{Object.entries(CHANGE_OPERATIONS).filter(([value]) => field === 'content_md' || value === 'replace').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {operation === 'replace' && <label>교체할 원문<textarea aria-label="교체할 원문" value={before} onChange={event => setBefore(event.target.value)} maxLength={100000} required={field === 'content_md'} /></label>}
    <label>변경할 내용<textarea aria-label="변경할 내용" name="after_text" defaultValue={text(row?.after_text)} rows={6} required={operation !== 'replace'} maxLength={field === 'content_md' ? 100000 : field === 'meta_description' ? 1000 : 200} /></label><label>변경 이유<textarea aria-label="변경 이유" name="rationale" defaultValue={text(row?.rationale)} maxLength={2000} /></label>
  </LiveModal>;
}
