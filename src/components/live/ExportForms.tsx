'use client';

import { useRef, useState } from 'react';
import type { ContentRow as Row } from '@/lib/api/content';
import { EXPORT_FORMATS, TRANSLATION_LOCALES, TRANSLATION_STATUS, type ExportData } from '@/lib/api/exports';
import { LiveModal } from './LiveUI';
import { text } from './LibraryShared';

export type ExportCommand = (name: string, payload: Record<string, unknown>) => Promise<Record<string, Row>>;
const options = (values: Record<string, string>) => Object.entries(values).map(([key, label]) => <option key={key} value={key}>{label}</option>);

export function NewExport({ data, initialJobId, command, onClose }: { data: ExportData; initialJobId?: string; command: ExportCommand; onClose: () => void }) {
  const [source, setSource] = useState('content'), [jobId, setJobId] = useState(initialJobId || data.content_jobs[0]?.id || ''), [translationId, setTranslationId] = useState(''), [destinationId, setDestinationId] = useState('');
  const request = useRef({ fingerprint: '', key: '' });
  const job = data.content_jobs.find(row => row.id === jobId), destination = data.export_destinations.find(row => row.id === destinationId);
  const draft = data.content_drafts.find(row => row.content_job_id === jobId && (job?.current_draft_id ? row.id === job.current_draft_id : row.is_selected));
  const translations = data.article_translations.filter(row => row.origin === 'manual' && row.status === 'ready');
  return <LiveModal title="파일 만들기" submit="파일 저장" description="선택한 본문을 파일로 보관합니다. 생성 후 이력에서 다운로드할 수 있습니다." onClose={onClose} onSave={async form => {
    const translation = translations.find(row => row.id === translationId);
    const values = { ...(source === 'content' ? { job_id: jobId, expected_content_revision: Number(job?.revision || 0) } : { translation_id: translationId, expected_translation_revision: Number(translation?.revision || 0) }), ...(destination ? { destination_id: destination.id, expected_destination_revision: Number(destination.revision) } : { format: form.get('format'), include_metadata: form.has('include_metadata') }) };
    const fingerprint = JSON.stringify(values);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    await command('export-create', { ...values, idempotency_key: request.current.key });
  }}>
    <label>내보낼 자료<select aria-label="내보낼 자료" value={source} onChange={event => setSource(event.target.value)}><option value="content">제작소 원문</option><option value="translation">검토한 번역문</option></select></label>
    {source === 'content' ? <><label>콘텐츠<select aria-label="콘텐츠" value={jobId} onChange={event => setJobId(event.target.value)} required><option value="">선택해 주세요</option>{data.content_jobs.map(row => <option key={row.id} value={row.id}>{text(row.title)}</option>)}</select></label>{draft && <p>현재 선택한 원문 · v{text(draft.version)} · {text(draft.title)}</p>}</> : <label>번역문<select aria-label="번역문" value={translationId} onChange={event => setTranslationId(event.target.value)} required><option value="">선택해 주세요</option>{translations.map(row => <option key={row.id} value={row.id}>{text(row.title)} ({text(row.locale)})</option>)}</select></label>}
    <label>파일 설정<select aria-label="파일 설정" value={destinationId} onChange={event => setDestinationId(event.target.value)}><option value="">이번에 직접 선택</option>{data.export_destinations.map(row => <option key={row.id} value={row.id}>{text(row.name)}</option>)}</select></label>
    {destination ? <p>{text(EXPORT_FORMATS[destination.format as keyof typeof EXPORT_FORMATS])} · 메타 정보 {destination.include_metadata ? '포함' : '제외'} · 파일명 접두어: {text(destination.file_prefix) || '없음'}</p> : <><label>파일 형식<select aria-label="파일 형식" name="format" defaultValue="md">{options(EXPORT_FORMATS)}</select></label><label className="check"><input type="checkbox" name="include_metadata" />검색 메타 정보 포함</label></>}
  </LiveModal>;
}

export function DestinationForm({ row, command, onClose }: { row?: Row; command: ExportCommand; onClose: () => void }) {
  return <LiveModal title={row ? '파일 설정 수정' : '파일 설정 추가'} onClose={onClose} onSave={async form => {
    await command(row ? 'export-destination-update' : 'export-destination-create', { ...Object.fromEntries(form.entries()), include_metadata: form.has('include_metadata'), ...(row ? { destination_id: row.id, expected_revision: row.revision } : {}) });
  }}>
    <label>설정 이름<input aria-label="설정 이름" name="name" defaultValue={text(row?.name)} required maxLength={100} /></label>
    <label>파일 형식<select aria-label="파일 형식" name="format" defaultValue={text(row?.format) || 'md'}>{options(EXPORT_FORMATS)}</select></label>
    <label>파일명 접두어<input aria-label="파일명 접두어" name="file_prefix" defaultValue={text(row?.file_prefix)} maxLength={40} /></label>
    <label className="check"><input type="checkbox" name="include_metadata" defaultChecked={Boolean(row?.include_metadata)} />검색 메타 정보 포함</label>
  </LiveModal>;
}

export function TranslationForm({ row, data, command, onClose }: { row?: Row; data: ExportData; command: ExportCommand; onClose: () => void }) {
  const [jobId, setJobId] = useState(data.content_jobs[0]?.id || '');
  const job = data.content_jobs.find(item => item.id === jobId);
  const source = row?.source_snapshot as Row | undefined || data.content_drafts.find(item => item.content_job_id === jobId && (job?.current_draft_id ? item.id === job.current_draft_id : item.is_selected));
  return <LiveModal title={row ? '번역문 편집' : '번역문 등록'} description="직접 번역한 내용을 저장하고 검토 상태를 관리합니다. 선택한 원문 버전도 함께 보관됩니다." onClose={onClose} onSave={async form => {
    await command(row ? 'translation-update' : 'translation-create', { ...Object.fromEntries(form.entries()), ...(row ? { translation_id: row.id, expected_revision: row.revision } : { job_id: jobId, expected_content_revision: Number(job?.revision || 0) }) });
  }}>
    {!row && <><label>원문 콘텐츠<select aria-label="원문 콘텐츠" value={jobId} onChange={event => setJobId(event.target.value)} required><option value="">선택해 주세요</option>{data.content_jobs.map(item => <option key={item.id} value={item.id}>{text(item.title)}</option>)}</select></label><div className="live-grid"><label>원문 언어<select aria-label="원문 언어" name="source_locale" defaultValue="ko">{options(TRANSLATION_LOCALES)}</select></label><label>번역 언어<select aria-label="번역 언어" name="locale" defaultValue="en">{options(TRANSLATION_LOCALES)}</select></label></div></>}
    {source && <details><summary>참조 원문 v{text(source.version)} · {text(source.title)}</summary><pre className="live-answer">{text(source.content_md)}</pre></details>}
    <label>번역 제목<input aria-label="번역 제목" name="title" defaultValue={text(row?.title)} required maxLength={200} /></label>
    <label>번역 본문<textarea aria-label="번역 본문" name="content_md" defaultValue={text(row?.content_md)} required maxLength={100000} rows={9} /></label>
    <label>번역 검색 제목<input aria-label="번역 검색 제목" name="meta_title" defaultValue={text(row?.meta_title)} maxLength={200} /></label>
    <label>번역 검색 설명<textarea aria-label="번역 검색 설명" name="meta_description" defaultValue={text(row?.meta_description)} maxLength={1000} rows={2} /></label>
    <label>검토 상태<select aria-label="검토 상태" name="status" defaultValue={text(row?.status) || 'draft'}>{options(TRANSLATION_STATUS)}</select></label>
    <label>번역 메모<textarea aria-label="번역 메모" name="notes" defaultValue={text(row?.notes)} maxLength={5000} rows={2} /></label>
  </LiveModal>;
}
