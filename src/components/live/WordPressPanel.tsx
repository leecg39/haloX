'use client';

import { useRef, useState } from 'react';
import type { ContentRow as Row } from '@/lib/api/content';
import { PUBLICATION_STATUS, type ExportData } from '@/lib/api/exports';
import type { ExportCommand } from './ExportForms';
import { LiveModal, EmptyState } from './LiveUI';
import { text, safeUrl } from './LibraryShared';

export function WordPressPanel({ mode, data, rows, command }: { mode: 'connections' | 'publications'; data: ExportData; rows: Row[]; command: ExportCommand }) {
  const [edit, setEdit] = useState<{ kind: 'connection' | 'publish' | 'delete' | 'notes' | 'resolve'; row?: Row }>();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const allowed = data.can_manage_connections;
  async function run(name: string, row: Row) {
    setBusy(row.id); setError('');
    try { await command(name, { destination_id: row.id, publication_id: row.id, expected_revision: row.revision }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.'); }
    finally { setBusy(''); }
  }
  return <section className="live-section">
    <div className="live-actions"><button className="primary" disabled={!allowed} onClick={() => setEdit({ kind: mode === 'connections' ? 'connection' : 'publish' })}>{mode === 'connections' ? 'WordPress 연결 추가' : '외부 게시'}</button>{!allowed && <small>연결 및 게시 작업은 워크스페이스 관리자만 실행할 수 있습니다.</small>}</div>
    {error && <p role="alert" className="live-error">{error}</p>}
    {!rows.length && <EmptyState>{mode === 'connections' ? 'WordPress 사이트와 애플리케이션 비밀번호를 등록해 주세요.' : '외부 게시 이력이 없습니다.'}</EmptyState>}
    <div className="live-history">{rows.map(row => mode === 'connections' ? <article className="live-card" key={row.id}><h2>{text(row.name)}</h2><p>{text(row.site_url)}</p><p>{text(row.username)} · 비밀번호 {row.has_credentials ? '저장됨' : '없음'}</p><p>{row.verification_status === 'verified' ? `연결 확인 완료 · ${row.can_publish ? '공개 게시 가능' : '초안 저장 가능'}` : row.verification_status === 'failed' ? '연결 확인 실패' : '연결 확인 필요'}</p>{Boolean(row.verification_error) && <p className="live-error">{text(row.verification_error)}</p>}<div className="live-actions"><button disabled={!allowed || Boolean(busy)} onClick={() => void run('wordpress-verify', row)}>{busy === row.id ? '확인 중…' : '연결 확인'}</button><button disabled={!allowed} onClick={() => setEdit({ kind: 'connection', row })}>연결 수정</button><button className="danger" disabled={!allowed} onClick={() => setEdit({ kind: 'delete', row })}>연결 삭제</button></div></article> : <article className="live-card" key={row.id}><h2>{text(row.title)}</h2><p>{text((row.destination_snapshot as Row)?.name)} · {text((row.destination_snapshot as Row)?.site_url)}</p><p>{PUBLICATION_STATUS[row.status as keyof typeof PUBLICATION_STATUS] || text(row.status)} · 요청: {row.requested_status === 'publish' ? '공개 게시' : '초안 저장'}{row.remote_status ? ` · 원격 상태: ${text(row.remote_status)}` : ''}</p><p>{text(row.notes)}</p>{Boolean(row.error) && <p className="live-error">{text(row.error)}</p>}{safeUrl(row.remote_url) && <a href={safeUrl(row.remote_url)} target="_blank" rel="noreferrer">WordPress에서 보기</a>}<details><summary>전송한 내용</summary><pre className="live-answer">{text((row.source_snapshot as Row)?.content_md)}</pre><small>조회용 식별자: {text(row.remote_slug)}</small></details><div className="live-actions">{['sending', 'unknown'].includes(text(row.status)) && <><button disabled={!allowed || Boolean(busy)} onClick={() => void run('wordpress-reconcile', row)}>원격 상태 확인</button><button disabled={!allowed} onClick={() => setEdit({ kind: 'resolve', row })}>직접 확인 후 정리</button></>}<button disabled={!allowed} onClick={() => setEdit({ kind: 'notes', row })}>게시 메모 수정</button><button className="danger" disabled={!allowed || ['sending', 'unknown'].includes(text(row.status))} onClick={() => setEdit({ kind: 'delete', row })}>이력 삭제</button></div></article>)}</div>
    {edit?.kind === 'connection' && <WordPressConnection row={edit.row} command={command} onClose={() => setEdit(undefined)} />}
    {edit?.kind === 'publish' && <WordPressPublish data={data} command={command} onClose={() => setEdit(undefined)} />}
    {edit?.kind === 'delete' && edit.row && <LiveModal title={mode === 'connections' ? 'WordPress 연결 삭제' : '게시 이력 삭제'} submit="삭제" description={mode === 'connections' ? '서버에 저장한 연결 비밀번호를 삭제합니다. 원격 글은 유지됩니다.' : 'HaloX의 이력을 삭제합니다. WordPress의 글은 유지됩니다.'} onClose={() => setEdit(undefined)} onSave={async () => { await command(mode === 'connections' ? 'wordpress-delete' : 'wordpress-history-delete', { destination_id: edit.row!.id, publication_id: edit.row!.id, expected_revision: edit.row!.revision }); }} />}
    {edit?.kind === 'notes' && edit.row && <LiveModal title="게시 메모 수정" onClose={() => setEdit(undefined)} onSave={async form => { await command('wordpress-history-update', { publication_id: edit.row!.id, expected_revision: edit.row!.revision, notes: form.get('notes') }); }}><label>메모<textarea aria-label="메모" name="notes" defaultValue={text(edit.row.notes)} maxLength={5000} /></label></LiveModal>}
    {edit?.kind === 'resolve' && edit.row && <LiveModal title="게시 결과 직접 확인" submit="이력 정리" description="WordPress 관리자에서 글의 생성 여부를 확인해 주세요. 이력 정리 후 다시 게시하면 글이 중복될 수 있습니다. 기존 요청을 자동 재전송하지 않습니다." onClose={() => setEdit(undefined)} onSave={async form => { await command('wordpress-resolve', { publication_id: edit.row!.id, expected_revision: edit.row!.revision, confirm_absent: form.has('confirm') }); }}><p>조회용 식별자: {text(edit.row.remote_slug)}</p><label className="check"><input type="checkbox" required name="confirm" />WordPress에서 직접 확인했습니다.</label></LiveModal>}
  </section>;
}

function WordPressConnection({ row, command, onClose }: { row?: Row; command: ExportCommand; onClose: () => void }) {
  return <LiveModal title={row ? 'WordPress 연결 수정' : 'WordPress 연결 추가'} description="WordPress 사용자 프로필에서 생성한 애플리케이션 비밀번호를 사용합니다. 저장한 비밀번호는 다시 표시하지 않습니다." onClose={onClose} onSave={async form => { await command(row ? 'wordpress-update' : 'wordpress-create', { ...Object.fromEntries(form.entries()), ...(row ? { destination_id: row.id, expected_revision: row.revision } : {}) }); }}>
    <label>연결 이름<input name="name" aria-label="연결 이름" required maxLength={100} defaultValue={text(row?.name)} /></label>
    <label>사이트 주소<input name="site_url" aria-label="사이트 주소" type="url" required maxLength={2000} placeholder="https://example.com/" defaultValue={text(row?.site_url)} /></label>
    <label>WordPress 사용자 이름<input name="username" aria-label="WordPress 사용자 이름" required maxLength={100} defaultValue={text(row?.username)} autoComplete="off" /></label>
    <label>애플리케이션 비밀번호<input type="password" name="password" aria-label="애플리케이션 비밀번호" required={!row} maxLength={200} autoComplete="new-password" /></label>
    {row && <small>비워 두면 기존 비밀번호를 유지합니다. 사이트 또는 사용자 이름을 바꾸면 다시 입력해 주세요.</small>}
  </LiveModal>;
}

function WordPressPublish({ data, command, onClose }: { data: ExportData; command: ExportCommand; onClose: () => void }) {
  const [kind, setKind] = useState('content'), [sourceId, setSourceId] = useState(''), [targetId, setTargetId] = useState(''), [status, setStatus] = useState('draft');
  const targets = data.export_destinations.filter(row => row.kind === 'wordpress' && row.verification_status === 'verified');
  const sources = kind === 'content' ? data.content_jobs : data.article_translations.filter(row => ['manual', 'deepl'].includes(text(row.origin)) && row.status === 'ready');
  const source = sources.find(row => row.id === sourceId), target = targets.find(row => row.id === targetId);
  const body = kind === 'content' ? data.content_drafts.find(row => row.content_job_id === sourceId && (source?.current_draft_id ? row.id === source.current_draft_id : row.is_selected)) : source;
  const request = useRef({ fingerprint: '', key: '' });
  return <LiveModal title="외부 게시 미리보기" submit={status === 'publish' ? '공개 게시' : 'WordPress에 초안 저장'} description="선택한 사이트에 실제 글을 전송합니다. 원문을 수정한 뒤 다시 전송하면 별도 글로 생성됩니다." onClose={onClose} onSave={async form => {
    const values = { destination_id: targetId, expected_destination_revision: target?.revision, status, confirm: form.has('confirm'), ...(kind === 'content' ? { job_id: sourceId, expected_content_revision: source?.revision } : { translation_id: sourceId, expected_translation_revision: source?.revision }) };
    const fingerprint = JSON.stringify(values); if (fingerprint !== request.current.fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    await command('wordpress-publish', { ...values, idempotency_key: request.current.key });
  }}>
    <label>게시 사이트<select aria-label="게시 사이트" value={targetId} onChange={event => setTargetId(event.target.value)} required><option value="">연결 확인을 마친 사이트 선택</option>{targets.map(row => <option key={row.id} value={row.id}>{text(row.name)}</option>)}</select></label>
    <label>게시할 자료<select aria-label="게시할 자료" value={kind} onChange={event => { setKind(event.target.value); setSourceId(''); }}><option value="content">제작소 원문</option><option value="translation">검토한 번역문</option></select></label>
    <label>게시 콘텐츠<select aria-label="게시 콘텐츠" value={sourceId} onChange={event => setSourceId(event.target.value)} required><option value="">선택해 주세요</option>{sources.map(row => <option key={row.id} value={row.id}>{text(row.title)}</option>)}</select></label>
    <label>게시 상태<select aria-label="게시 상태" value={status} onChange={event => setStatus(event.target.value)}><option value="draft">초안 저장 (비공개)</option><option value="publish">공개 게시</option></select></label>
    {target && <p>대상: {text(target.site_url)} · {text(target.username)}</p>}
    {body && <details open><summary>{text(body.title)} · 전송할 본문</summary><pre className="live-answer">{text(body.content_md)}</pre><p>검색 설명: {text(body.meta_description)}</p></details>}
    {status === 'publish' && <small>제작소 원문은 사용 준비 상태여야 하며 WordPress 계정에 공개 게시 권한이 있어야 합니다.</small>}
    <label className="check"><input type="checkbox" required name="confirm" />내용과 대상을 확인했고 이 사이트로 전송합니다.</label>
  </LiveModal>;
}
