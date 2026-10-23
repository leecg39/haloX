'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUDIT_ACTIVE, AUDIT_STATUS, AUDIT_TABLES, type AuditData, type AuditTarget } from '@/lib/api/site-audit';
import type { ContentRow as Row } from '@/lib/api/content';
import { invokeEdgeEndpoint } from '@/lib/api/client';
import { LibraryWorkspace, text } from './LibraryShared';
import { EmptyState, ErrorState, LiveModal } from './LiveUI';
import { SiteAuditDetail, ScopePreview } from './SiteAuditDetail';

export type AuditCommand = (name: string, values: Record<string, unknown>) => Promise<Record<string, Row>>;
export function SiteAuditPage({ scanId }: { scanId?: string }) {
  return <LibraryWorkspace>{(id, name) => <AuditWorkspace key={id} workspaceId={id} workspaceName={name} scanId={scanId} />}</LibraryWorkspace>;
}
function AuditWorkspace({ workspaceId, workspaceName, scanId }: { workspaceId: string; workspaceName: string; scanId?: string }) {
  const router = useRouter(), generation = useRef(0);
  const [data, setData] = useState<AuditData>(() => Object.fromEntries(AUDIT_TABLES.map(table => [table, []])) as unknown as AuditData);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [tab, setTab] = useState('history'), [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const [edit, setEdit] = useState<{ kind: 'target' | 'run' | 'notes' | 'rerun' | 'delete-target' | 'delete-scan' | 'cancel'; row?: Row }>();
  const reload = useCallback(async (silent = false) => {
    const request = ++generation.current; if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/v1/site-audit?${new URLSearchParams({ workspace_id: workspaceId })}`), body = await response.json();
      if (!response.ok) throw new Error(body.error || '진단 자료를 불러오지 못했습니다.');
      if (request === generation.current) { setData(body); setLoaded(true); setError(''); }
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const active = data.site_audit_scans.some(row => AUDIT_ACTIVE.includes(text(row.status)));
  useEffect(() => { if (!active) return; const timer = setInterval(() => { void reload(true); }, 3000); return () => clearInterval(timer); }, [active, reload]);
  const command: AuditCommand = async (name, values) => { try { return await invokeEdgeEndpoint<Record<string, Row>>(name, { ...values, workspace_id: workspaceId }); } finally { await reload(); } };
  const scan = data.site_audit_scans.find(row => row.id === scanId), candidates = tab === 'targets' ? data.site_audit_targets : data.site_audit_scans;
  const rows = candidates.filter(row => `${text(row.name)} ${text(row.target_url)} ${text(row.notes)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (tab !== 'history' || !status || row.status === status));
  const pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages), close = () => setEdit(undefined);
  return <div className="live"><header className="live-head"><div><h1>사이트 진단</h1><p>{workspaceName} · 공개 페이지를 수집하고 HTML 점검 결과를 보관합니다.</p></div><div className="live-actions"><button disabled={loading} onClick={() => void reload()}>새로고침</button><button disabled={!loaded} onClick={() => setEdit({ kind: 'target' })}>진단 대상 추가</button><button className="primary" disabled={!data.site_audit_targets.length} onClick={() => setEdit({ kind: 'run' })}>새 진단</button></div></header>
    <p className="muted">실제 HTML의 제목·검색 설명·문서 구조·이미지 대체 텍스트·색인 설정·JSON-LD 구문을 점검합니다. JavaScript 실행, Lighthouse 성능, 검색 순위와 AI 노출은 측정하지 않습니다.</p>
    {error && <ErrorState message={error} retry={() => reload()} />}{loading && <p role="status">진단 자료를 불러오는 중…</p>}
    {scanId ? <><Link href="/app/site-audit">← 진단 목록</Link>{scan ? <SiteAuditDetail key={scan.id} scan={scan} data={data} command={command} onAction={kind => setEdit({ kind, row: scan })} /> : loaded && <EmptyState>진단을 찾을 수 없습니다. 현재 워크스페이스를 확인해 주세요.</EmptyState>}</> : <>
      <nav className="live-actions" aria-label="사이트 진단 메뉴">{[['history', '진단 이력'], ['targets', '대상·수집 범위']].map(([key, label]) => <button key={key} aria-pressed={tab === key} className={tab === key ? 'primary' : ''} onClick={() => { setTab(key); setPage(1); }}>{label}</button>)}</nav>
      <div className="live-toolbar"><input aria-label="진단 검색" placeholder="이름·URL·메모 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />{tab === 'history' && <select aria-label="진단 상태 필터" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">모든 상태</option>{Object.entries(AUDIT_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}<small>{rows.length}개</small></div>
      {loaded && !rows.length && <EmptyState>{query || status && tab === 'history' ? '검색 결과가 없습니다.' : tab === 'targets' ? '진단 대상과 수집 범위를 추가해 주세요.' : '진단 이력이 없습니다. 대상을 등록한 뒤 새 진단을 시작해 주세요.'}</EmptyState>}
      {tab === 'targets' ? <div className="live-grid">{rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => <article className="live-card" key={row.id}><h2>{text(row.name)}</h2><p className="live-url">{text(row.target_url)}</p><p>최대 {Number(row.max_pages)}페이지 · 깊이 {Number(row.max_depth)}</p><ScopePreview target={row as unknown as AuditTarget} /><p>{text(row.notes)}</p><div className="live-actions"><button onClick={() => setEdit({ kind: 'target', row })}>대상·범위 수정</button><button onClick={() => setEdit({ kind: 'run', row })}>이 대상 진단</button><button className="danger" onClick={() => setEdit({ kind: 'delete-target', row })}>대상 삭제</button></div></article>)}</div> : rows.length > 0 && <div className="live-table"><table><thead><tr><th>진단 / URL</th><th>상태 / 페이지</th><th>HTML 점검 점수</th><th>작업</th></tr></thead><tbody>{rows.slice((currentPage - 1) * 10, currentPage * 10).map(row => <tr key={row.id}><td className="live-prompt-cell"><Link href={`/app/site-audit/${row.id}`}>{text(row.name) || '이전 데모 진단'}</Link><small>{text(row.target_url)}</small><small>{text(row.created_at).slice(0, 16).replace('T', ' ')}</small></td><td>{AUDIT_STATUS[text(row.status) as keyof typeof AUDIT_STATUS] || text(row.status)}<small>{row.provider === 'html' ? `${Number(row.crawled_urls)}개 분석 / ${Number(row.failed_urls)}개 실패 / ${Number(row.skipped_urls)}개 제외` : '이전 데모 데이터'}</small></td><td>{row.provider === 'html' && row.site_health_score !== null ? text(row.site_health_score) : '—'}</td><td>{AUDIT_ACTIVE.includes(text(row.status)) ? <button onClick={() => setEdit({ kind: 'cancel', row })}>진단 취소</button> : <button className="danger" onClick={() => setEdit({ kind: 'delete-scan', row })}>이력 삭제</button>}</td></tr>)}</tbody></table></div>}
      {pages > 1 && <div className="live-pagination"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {pages}</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</button></div>}
    </>}
    {edit?.kind === 'target' && <AuditTargetForm row={edit.row} command={command} onClose={close} />}
    {(edit?.kind === 'run' || edit?.kind === 'rerun') && <AuditRunForm data={data} target={edit.kind === 'run' ? edit.row : undefined} prior={edit.kind === 'rerun' ? edit.row : undefined} command={command} onClose={close} onCreated={id => { close(); router.push(`/app/site-audit/${id}`); }} />}
    {edit?.kind === 'notes' && edit.row && <LiveModal title="진단 메모 수정" onClose={close} onSave={async form => { await command('site-audit-update', { ...Object.fromEntries(form.entries()), scan_id: edit.row!.id, expected_revision: Number(edit.row!.revision || 0) }); }}><label>진단 이름<input name="name" aria-label="진단 이름" required maxLength={100} defaultValue={text(edit.row.name) || '이전 데모 진단'} /></label><label>진단 메모<textarea name="notes" aria-label="진단 메모" maxLength={5000} defaultValue={text(edit.row.notes)} /></label></LiveModal>}
    {edit?.row && ['delete-target', 'delete-scan', 'cancel'].includes(edit.kind) && <LiveModal title={edit.kind === 'cancel' ? '진단 취소' : edit.kind === 'delete-target' ? '대상 삭제' : '진단 이력 삭제'} submit={edit.kind === 'cancel' ? '진단 취소' : '삭제'} description={edit.kind === 'cancel' ? '대기 중인 실행은 사용량을 반환합니다. 시작한 실행은 사용량과 이미 수집한 결과를 유지하고 추가 수집을 중단합니다.' : edit.kind === 'delete-target' ? '대상 설정을 삭제합니다. 완료된 진단과 당시 수집 범위는 보존됩니다.' : '진단과 수집한 페이지·점검 결과·메모를 함께 삭제합니다. 대상 설정과 사용량은 유지됩니다.'} onClose={close} onSave={async () => {
      await command(edit.kind === 'delete-target' ? 'audit-target-delete' : edit.kind === 'cancel' ? 'site-audit-cancel' : 'site-audit-delete', { [edit.kind === 'delete-target' ? 'target_id' : 'scan_id']: edit.row!.id, expected_revision: Number(edit.row!.revision || 0) });
      if (edit.kind === 'delete-scan' && scanId) router.push('/app/site-audit');
    }} />}
  </div>;
}

function AuditTargetForm({ row, command, onClose }: { row?: Row; command: AuditCommand; onClose: () => void }) {
  const scope = row?.scope_rules as AuditTarget['scope_rules'] | undefined;
  return <LiveModal title={row ? '대상·범위 수정' : '진단 대상 추가'} description="같은 출처의 공개 HTML 링크를 탐색합니다. 쿼리 URL·외부 사이트·robots.txt에서 차단한 경로는 수집하지 않습니다. 범위를 수정해도 기존 진단에는 당시 설정이 남습니다." onClose={onClose} onSave={async form => {
    const lines = (key: string) => text(form.get(key)).split('\n').map(line => line.trim()).filter(Boolean);
    await command(row ? 'audit-target-update' : 'audit-target-create', { name: form.get('name'), target_url: form.get('target_url'), max_pages: Number(form.get('max_pages')), max_depth: Number(form.get('max_depth')), notes: form.get('notes'), scope_rules: { include_paths: lines('include_paths'), exclude_paths: lines('exclude_paths') }, ...(row ? { target_id: row.id, expected_revision: row.revision } : {}) });
  }}>
    <label>대상 이름<input name="name" aria-label="대상 이름" required maxLength={100} defaultValue={text(row?.name)} /></label><label>시작 URL<input name="target_url" aria-label="시작 URL" type="url" required maxLength={2000} defaultValue={text(row?.target_url)} placeholder="https://example.com/" /></label>
    <div className="live-grid"><label>최대 페이지<input name="max_pages" aria-label="최대 페이지" type="number" min={1} max={100} required defaultValue={Number(row?.max_pages || 25)} /></label><label>탐색 깊이<input name="max_depth" aria-label="탐색 깊이" type="number" min={0} max={5} required defaultValue={Number(row?.max_depth ?? 2)} /></label></div>
    <label>포함 경로<textarea name="include_paths" aria-label="포함 경로" maxLength={15000} rows={3} defaultValue={scope?.include_paths.join('\n') || ''} placeholder="비우면 전체 경로, 예: /docs" /></label><label>제외 경로<textarea name="exclude_paths" aria-label="제외 경로" maxLength={15000} rows={3} defaultValue={scope?.exclude_paths.join('\n') ?? '/admin\n/api\n/login\n/logout'} /></label><small>한 줄에 경로 하나, 최대 30개. /docs는 /docs와 그 하위 경로에 적용됩니다. 깊이 0은 시작 페이지만 수집합니다.</small>
    <label>대상 메모<textarea name="notes" aria-label="대상 메모" maxLength={5000} defaultValue={text(row?.notes)} /></label>
  </LiveModal>;
}
function AuditRunForm({ data, target, prior, command, onClose, onCreated }: { data: AuditData; target?: Row; prior?: Row; command: AuditCommand; onClose: () => void; onCreated: (id: string) => void }) {
  const [targetId, setTargetId] = useState(target?.id || data.site_audit_targets[0]?.id || ''), request = useRef({ fingerprint: '', key: '' });
  const selected = data.site_audit_targets.find(row => row.id === targetId), scope = (prior?.target_snapshot || selected) as AuditTarget | undefined;
  return <LiveModal title={prior ? '동일 범위 재실행' : '새 진단'} submit="진단 시작" description="진단 1회를 사용합니다. 시작 전 취소하면 사용량을 반환합니다. 서버가 켜져 있는 동안 수집하며 완료 전까지 페이지별 결과가 추가됩니다." onClose={onClose} onSave={async () => {
    const values = prior ? { scan_id: prior.id, expected_revision: Number(prior.revision || 0) } : { target_id: targetId, expected_revision: Number(selected?.revision || 0) }, fingerprint = JSON.stringify(values);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    const result = await command(prior ? 'site-audit-rerun' : 'site-audit-start', { ...values, idempotency_key: request.current.key }); onCreated(result.scan.id);
  }}>
    {!prior && <label>진단 대상<select aria-label="진단 대상" value={targetId} onChange={event => setTargetId(event.target.value)} required>{data.site_audit_targets.map(row => <option key={row.id} value={row.id}>{text(row.name)}</option>)}</select></label>}
    {scope && <><p className="live-url">{scope.target_url}</p><p>최대 {scope.max_pages}페이지 · 탐색 깊이 {scope.max_depth}</p><ScopePreview target={scope} /></>}
    <p>HTML 점검 점수는 수집한 페이지의 점검 항목을 기준으로 계산합니다. 제한된 범위의 결과이며 사이트 전체 품질이나 검색 노출을 보장하지 않습니다.</p>
  </LiveModal>;
}
