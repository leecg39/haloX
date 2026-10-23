'use client';

import { useRef, useState } from 'react';
import type { ContentRow as Row } from '@/lib/api/content';
import { TRANSLATION_LOCALES, TRANSLATION_RUN_STATUS, type ExportData } from '@/lib/api/exports';
import type { ExportCommand } from './ExportForms';
import { EmptyState, LiveModal } from './LiveUI';
import { text } from './LibraryShared';

export function AutomaticTranslationForm({ data, command, onClose }: { data: ExportData; command: ExportCommand; onClose: () => void }) {
  const [jobId, setJobId] = useState(data.content_jobs[0]?.id || ''), [sourceLocale, setSourceLocale] = useState('ko'), [locale, setLocale] = useState('en');
  const request = useRef({ fingerprint: '', key: '' });
  const job = data.content_jobs.find(row => row.id === jobId);
  const draft = data.content_drafts.find(row => row.content_job_id === jobId && (job?.current_draft_id ? row.id === job.current_draft_id : row.is_selected));
  const options = Object.entries(TRANSLATION_LOCALES).map(([key, name]) => <option key={key} value={key}>{name}</option>);
  const characters = draft ? ['title', 'content_md', 'meta_title', 'meta_description'].reduce((sum, field) => sum + [...text(draft[field])].length, 0) : 0;
  return <LiveModal title="자동 번역" submit="DeepL 번역 요청" description="선택한 원문의 제목·본문·검색 메타 정보를 번역합니다. 번역문은 검토 중 상태로 저장됩니다." onClose={onClose} onSave={async form => {
    const values = { job_id: jobId, expected_content_revision: Number(job?.revision || 0), source_locale: sourceLocale, locale };
    const fingerprint = JSON.stringify(values);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    await command('translate-content-v2', { ...values, confirm: form.has('confirm'), idempotency_key: request.current.key });
  }}>
    {!data.translation_configured && <p role="status">자동 번역 서비스 설정이 필요합니다. 관리자에게 문의해 주세요.</p>}
    <label>번역할 콘텐츠<select aria-label="번역할 콘텐츠" value={jobId} onChange={event => setJobId(event.target.value)} required><option value="">선택해 주세요</option>{data.content_jobs.map(row => <option key={row.id} value={row.id}>{text(row.title)}</option>)}</select></label>
    <div className="live-grid"><label>원문 언어<select aria-label="원문 언어" value={sourceLocale} onChange={event => setSourceLocale(event.target.value)}>{options}</select></label><label>번역 언어<select aria-label="번역 언어" value={locale} onChange={event => setLocale(event.target.value)}>{options}</select></label></div>
    {draft && <details><summary>전송할 원문 v{text(draft.version)} · {characters.toLocaleString()}자</summary><h3>{text(draft.title)}</h3><pre className="live-answer">{text(draft.content_md)}</pre><p>검색 제목: {text(draft.meta_title) || '없음'}</p><p>검색 설명: {text(draft.meta_description) || '없음'}</p></details>}
    <p>자동 번역 1회에 콘텐츠 생성 사용량 1회를 사용합니다. DeepL 비용은 별도이며 실제 과금 문자는 실행 이력에서 확인할 수 있습니다. 긴 글은 나누어 전송하므로 일부만 번역되어도 비용이 발생할 수 있습니다.</p>
    <p>실패한 요청을 이 창에서 다시 누르면 기존 결과만 확인합니다. 새 요청이 필요하면 실행 이력을 확인한 뒤 창을 다시 열어 주세요. 다시 요청한 부분에도 비용이 발생할 수 있습니다.</p>
    <label className="check"><input type="checkbox" name="confirm" required />선택한 원문을 DeepL로 전송하고 비용이 발생할 수 있음에 동의합니다.</label>
  </LiveModal>;
}

export function TranslationRunPanel({ data, rows, command }: { data: ExportData; rows: Row[]; command: ExportCommand }) {
  const [edit, setEdit] = useState<{ kind: 'notes' | 'delete' | 'resolve'; row: Row }>();
  const close = () => setEdit(undefined);
  return <>
    <p className="muted">응답이 끊긴 요청은 자동 재전송하지 않습니다. 마지막 진행 기록으로부터 5분 후 수동 종료할 수 있습니다. 종료해도 DeepL 과금은 취소되지 않으며, 확인된 부분 결과는 아래에서 확인할 수 있습니다.</p>
    {!rows.length && <EmptyState>자동 번역 실행 이력이 없습니다.</EmptyState>}
    <div className="live-history">{rows.map(row => {
      const unresolved = ['running', 'unknown'].includes(text(row.status)), partial = row.partial_body as Row | undefined;
      return <article className="live-card" key={row.id}>
        <h2>{text(row.title)}</h2><p>{text(TRANSLATION_LOCALES[row.source_locale as keyof typeof TRANSLATION_LOCALES])} → {text(TRANSLATION_LOCALES[row.locale as keyof typeof TRANSLATION_LOCALES])} · {text(TRANSLATION_RUN_STATUS[row.status as keyof typeof TRANSLATION_RUN_STATUS] || row.status)}</p>
        <p>원문 v{text((row.source_snapshot as Row)?.version)} · 확인한 응답 {Number(row.completed_batches)} / {Number(row.total_batches)} · DeepL</p>
        <p>확인된 과금 문자: {Number(row.billed_characters).toLocaleString()}자{!row.billing_complete || unresolved ? ' (일부 또는 미확인 — 최종 과금은 DeepL에서 확인)' : ''} · 콘텐츠 생성 사용량: {row.quota_status === 'released' ? '반환됨' : row.quota_status === 'reserved' ? '예약 중' : '1회 사용'}</p>
        {row.error ? <p className="live-error">{text(row.error)}</p> : null}<small>{text(row.notes)}</small>
        {row.status === 'succeeded' && <p>{row.translation_id ? '번역문 관리에서 내용을 검토하고 사용 준비로 변경해 주세요.' : '생성된 번역문이 삭제되었습니다.'}</p>}
        <details><summary>원문과 진행 기록</summary><small>마지막 진행: {text(row.last_checkpoint_at)}</small><pre className="live-answer">{text((row.source_snapshot as Row)?.content_md)}</pre>
          {partial && Object.values(partial).some(Boolean) && <><h3>확인된 부분 결과 (완성된 번역문이 아닙니다)</h3>{([['title', '제목'], ['content_md', '본문'], ['meta_title', '검색 제목'], ['meta_description', '검색 설명']] as const).map(([key, label]) => partial[key] ? <div key={key}><strong>{label}</strong><pre className="live-answer">{text(partial[key])}</pre></div> : null)}</>}
        </details>
        {data.can_manage_connections && <div className="live-actions">{unresolved ? <button onClick={() => setEdit({ kind: 'resolve', row })}>실행 수동 종료</button> : <><button onClick={() => setEdit({ kind: 'notes', row })}>실행 메모 수정</button><button className="danger" onClick={() => setEdit({ kind: 'delete', row })}>실행 이력 삭제</button></>}</div>}
      </article>;
    })}</div>
    {edit && <LiveModal title={edit.kind === 'notes' ? '실행 메모 수정' : edit.kind === 'delete' ? '실행 이력 삭제' : '실행 수동 종료'} submit={edit.kind === 'notes' ? '저장' : edit.kind === 'delete' ? '삭제' : '종료'} description={edit.kind === 'delete' ? '이력과 부분 결과를 삭제합니다. 생성된 번역문과 사용량은 유지되며 같은 요청은 재전송되지 않습니다.' : edit.kind === 'resolve' ? '마지막 진행으로부터 5분 후 종료할 수 있습니다. DeepL의 과금 여부는 별도로 확인해야 하며 사용량은 반환되지 않습니다.' : undefined} onClose={close} onSave={async form => { await command(`translation-run-${edit.kind === 'notes' ? 'update' : edit.kind}`, { run_id: edit.row.id, expected_revision: edit.row.revision, notes: form.get('notes'), confirm: form.has('confirm') }); }}>
      {edit.kind === 'notes' && <label>실행 메모<textarea aria-label="실행 메모" name="notes" maxLength={5000} defaultValue={text(edit.row.notes)} /></label>}
      {edit.kind === 'resolve' && <label className="check"><input type="checkbox" name="confirm" required />과금 가능성을 확인했으며 이 실행을 종료합니다.</label>}
    </LiveModal>}
  </>;
}
