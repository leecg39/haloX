'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObservationSnapshot, ObservationSeries } from '@/lib/api/observability';
import { invokeEdgeEndpoint } from '@/lib/api/client';
import { ErrorState, EmptyState } from './LiveUI';
import { AnalysisPager } from './AnalysisViews';
export type ObservationCommand = (name: string, values: Record<string, unknown>) => Promise<Record<string, unknown>>;
export const displayMetric = (value: unknown, unit = '') => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 10) / 10}${unit}` : '미측정';
export const observationTime = (value: unknown) => value ? `${String(value).slice(0, 19).replace('T', ' ')} UTC` : '없음';
export function useObservation<T>(workspace: string, kind: string, id = '') {
  const [data, setData] = useState<T>(), [loading, setLoading] = useState(true), [error, setError] = useState(''), generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try { const response = await fetch(`/api/v1/observability?${new URLSearchParams({ workspace_id: workspace, kind, ...(id ? { report_id: id } : {}) })}`), body = await response.json(); if (!response.ok) throw new Error(body.error || '조회 실패'); if (request === generation.current) setData(body); }
    catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspace, kind, id]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  const command: ObservationCommand = async (name, values) => { try { return await invokeEdgeEndpoint(name, { ...values, workspace_id: workspace }); } finally { await reload(); } };
  const notices = <>{error && <ErrorState message={error} retry={() => void reload()} />}{loading && <p role="status">자료를 불러오는 중…</p>}</>;
  return { data, loading, error, reload, command, notices, ready: !!data && !loading && !error };
}
export function ObservationSource({ snapshot }: { snapshot: ObservationSnapshot }) {
  return <p className="muted">{snapshot.start} ~ {snapshot.end} (UTC) · 집계 {observationTime(snapshot.generated_at)}. Provider: {snapshot.providers.join(', ') || '수집 없음'}. 데모 Provider가 포함된 값은 실제 시장 성과를 의미하지 않습니다. 미측정 값은 0점으로 대체하지 않습니다.</p>;
}
export function ObservationScores({ snapshot }: { snapshot: ObservationSnapshot }) {
  const cards = [['avi', '통합 가시성', '/app/seo/insights'], ['seo', '검색 가시성', '/app/seo/insights'], ['geo', 'AI 가시성', '/app/geo/analysis'], ['web_health', 'HTML 건강도', '/app/site-audit']] as const;
  return <section aria-label="가시성 지표"><div className="observation-kpis">{cards.map(([key, title, href]) => <Link className="live-card" key={key} href={href}><span>{title}</span><strong>{displayMetric(snapshot.scores[key], '점')}</strong><small>상세 분석 →</small></Link>)}</div><p className="muted">검색 점수는 순위·Top 10·AIO 인용 자료, AI 점수는 인용률·멘션율 및 각각의 순위 점수가 필요합니다. HTML 건강도는 기간 내 대상별 최신 완료 진단의 평균입니다.</p></section>;
}
export function ObservationSeriesView({ series, kind, sort = 'rank', compact = false }: { series: ObservationSeries; kind: 'seo' | 'geo'; sort?: string; compact?: boolean }) {
  const seo = kind === 'seo', field = seo ? 'top10_percent' : 'citation_percent', label = seo ? '검색 Top 10 비율' : 'AI 인용률', current = series.summary[field], previous = series.previous[field];
  const samples = [...series.latest].sort((a, b) => sort === 'recent' ? b.at.localeCompare(a.at) : seo ? (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.text.localeCompare(b.text) : Number(b.cited) - Number(a.cited) || a.text.localeCompare(b.text));
  const rows = compact ? samples.slice(0, 8) : samples;
  return <section className="live-card live-section"><div className="live-head"><h2>{seo ? '검색 현황' : 'AI 질문 현황'}</h2><Link href={seo ? '/app/seo/insights' : '/app/geo/analysis'}>전체 분석 →</Link></div><div className="observation-kpis"><div><span>{label}</span><strong>{displayMetric(current, '%')}</strong></div><div><span>직전 동일 길이 기간</span><strong>{displayMetric(previous, '%')}</strong></div><div><span>변화</span><strong>{current === null || previous === null ? '비교 자료 없음' : displayMetric(current - previous, '%p')}</strong></div></div><p className="muted">{seo ? `키워드·엔진별 최신 측정 ${series.summary.rank_measured}개 기준. 평균 순위 ${displayMetric(series.summary.average_rank, '위')}.` : `완료 실행 중 인용 측정 ${series.summary.citation_measured}개 기준. 멘션율 ${displayMetric(series.summary.mention_percent, '%')}. 반복 실행도 각각 포함됩니다.`}</p>
    {!!series.trend.length && <details><summary>일별 추이와 수치</summary><div className="observation-chart"><svg viewBox="0 0 760 180" role="img" aria-label={`${label} 일별 측정값`}><line x1="36" y1="150" x2="724" y2="150" stroke="currentColor" opacity=".2" /><text x="0" y="20">100%</text><text x="0" y="150">0%</text>{series.trend.map((row, index) => row.summary[field] === null ? null : <circle key={row.day} cx={36 + index * 688 / Math.max(1, series.trend.length - 1)} cy={150 - Number(row.summary[field]) * 1.3} r="5" fill="#6d5ce7"><title>{row.day}: {row.summary[field]}%</title></circle>)}</svg></div><p className="muted">수집한 날짜만 표시합니다. 점 사이 간격은 날짜별 순서입니다.</p><div className="live-table"><table><thead><tr><th>날짜 (UTC)</th><th>{label}</th><th>표본</th></tr></thead><tbody>{series.trend.map(row => <tr key={row.day}><td>{row.day}</td><td>{displayMetric(row.summary[field], '%')}</td><td>{row.summary.samples}</td></tr>)}</tbody></table></div></details>}
    {!rows.length ? <EmptyState>선택한 기간에 측정된 자료가 없습니다. <Link href={seo ? '/app/keywords' : '/app/geo/prompts'}>{seo ? '키워드' : '질문'} 관리</Link></EmptyState> : <AnalysisPager rows={rows}>{visible => <div className="live-table"><table><thead><tr><th>{seo ? '키워드' : '질문'}</th><th>엔진</th><th>{seo ? '자사 순위' : '인용 여부'}</th><th>측정 시각</th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td><Link href={`${seo ? '/app/keywords' : '/app/geo/prompts'}/${row.entity_id}`}>{row.text}</Link></td><td>{row.engine}</td><td>{seo ? row.rank !== null ? `${row.rank}위` : row.rank_measured ? '수집 범위 내 없음' : '미측정' : row.cited === null ? '미측정' : row.cited ? '인용' : '인용 없음'}</td><td>{observationTime(row.at)}</td></tr>)}</tbody></table></div>}</AnalysisPager>}
  </section>;
}
export function ObservationAudits({ snapshot }: { snapshot: ObservationSnapshot }) {
  return <section className="live-card live-section"><div className="live-head"><h2>사이트 진단</h2><Link href="/app/site-audit">진단 관리 →</Link></div>{!snapshot.audits.length ? <EmptyState>기간 내 완료한 HTML 진단이 없습니다.</EmptyState> : <ul className="observation-links">{snapshot.audits.map(row => <li key={row.id}><Link href={`/app/site-audit/${row.id}`}>{row.name}</Link><span>{displayMetric(row.score, '점')} · {observationTime(row.at)}</span></li>)}</ul>}</section>;
}
