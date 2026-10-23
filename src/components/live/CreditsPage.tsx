'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreditView } from '@/lib/api/credits';
import { CREDIT_KIND_LABELS, CREDIT_SOURCE_LABELS } from '@/lib/api/credits';
import { LibraryWorkspace, text } from './LibraryShared';
import { EmptyState, ErrorState } from './LiveUI';
import { SettingsNav } from './WorkspaceSettingsPage';

const signed = (row: Record<string, unknown>) => `${Number(row.delta) > 0 ? '+' : ''}${Number(row.delta || 0).toLocaleString('ko-KR')}`;
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString('ko-KR') : '—';
const money = (value: number, currency: string) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(value / 10 ** (new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits || 0));
export function CreditsPage() { return <LibraryWorkspace>{(id, name) => <CreditsPanel key={id} workspaceId={id} name={name} />}</LibraryWorkspace>; }
function CreditsPanel({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [data, setData] = useState<CreditView>(), [loading, setLoading] = useState(true), [error, setError] = useState(''); const generation = useRef(0);
  const reload = useCallback(async () => { const current = ++generation.current; setLoading(true); setError(''); try { const response = await fetch(`/api/v1/credits?workspace_id=${encodeURIComponent(workspaceId)}`, { cache: 'no-store' }), body = await response.json(); if (!response.ok) throw new Error(body.error || '크레딧 내역을 불러오지 못했습니다.'); if (current === generation.current) setData(body); } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); } finally { if (current === generation.current) setLoading(false); } }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  return <div className="live live-settings-page live-credits-page"><header className="live-head"><div><h1>크레딧·보상</h1><p>{name} · 추가 사용량과 내 추천 정산을 구분하여 표시합니다.</p></div><button disabled={loading} onClick={() => void reload()}>새로고침</button></header><SettingsNav current="credits" />
    {loading && <p role="status">크레딧 내역을 불러오는 중…</p>}{error && <ErrorState message={error} retry={reload} />}{data && !error && <>
      <p className="live-status">크레딧 원장은 결제·추천·고객 지원 같은 검증된 서버 이벤트만 변경합니다. 사용자가 잔액을 직접 수정하거나 삭제할 수 없습니다.</p>
      <section className="live-section"><h2>워크스페이스 크레딧</h2><div className="live-grid">{data.balances.map(row => { const quota = data.quota.find(item => item.unit_key === row.unit_key); return <article className="live-card" key={text(row.unit_key)}><h3>{text(row.unit_label)}</h3><p><strong>{Number(row.balance || 0).toLocaleString('ko-KR')} 크레딧</strong></p><p>플랜 {text(quota?.plan_used)} / {text(quota?.plan_limit)} · 남은 총량 {text(quota?.effective_remaining)}</p></article>; })}</div></section>
      <section className="live-section"><h2>크레딧 원장</h2>{!data.ledger.length ? <EmptyState>적립·사용·회수 내역이 없습니다.</EmptyState> : <div className="live-history">{data.ledger.map(row => <article className="live-card" key={text(row.id)}><div className="live-head"><div><h3>{text(row.unit_key)} · {CREDIT_KIND_LABELS[text(row.kind)] || text(row.kind)}</h3><p>{CREDIT_SOURCE_LABELS[text(row.source_type)] || text(row.source_type)} · {date(row.created_at)}</p></div><strong className={Number(row.delta) < 0 ? 'live-error' : ''}>{signed(row)}</strong></div><p>{text(row.memo) || '서버 정산 이벤트'}</p><small>처리 후 잔액 {Number(row.balance_after || 0).toLocaleString('ko-KR')}</small></article>)}</div>}</section>
      <section className="live-section"><div className="live-head"><div><h2>내 추천 보상</h2><p>계정 소유 정산이라 워크스페이스를 바꿔도 동일합니다.</p></div><Link href="/app/referral">추천 프로그램 관리</Link></div>{!Object.keys(data.reward_totals).length ? <EmptyState>확정된 추천 보상이 없습니다.</EmptyState> : <div className="live-grid">{Object.entries(data.reward_totals).map(([currency, total]) => <article className="live-card" key={currency}><h3>{currency}</h3><p>적립 {money(total.earned, currency)} · 회수 {money(total.reversed, currency)}</p><p>지급 {money(total.paid, currency)} · 정산 잔액 <strong>{money(total.balance, currency)}</strong></p></article>)}</div>}</section>
      <section className="live-card"><h2>결제와 크레딧</h2><p>플랜 결제와 정기 구독은 결제 원장에, 추가 사용량 크레딧은 별도 원장에 기록됩니다. 추천 보상은 현금 정산 대상이며 워크스페이스 사용량 크레딧과 합산하지 않습니다.</p><Link href="/app/settings?tab=billing">구독·결제 내역 보기</Link></section>
    </>}
  </div>;
}
