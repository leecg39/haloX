'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ANALYSIS_LANGUAGES, ANALYSIS_COUNTRIES, type GeneralSettingsData } from '@/lib/api/general-settings';
import { accountRequest } from '../AccountSecurityForms';
import { LibraryWorkspace } from './LibraryShared';
import { ErrorState, LiveModal } from './LiveUI';
import { SettingsNav } from './WorkspaceSettingsPage';
export function GeneralSettingsPage() { return <LibraryWorkspace>{id => <GeneralPanel key={id} workspaceId={id} />}</LibraryWorkspace>; }
function GeneralPanel({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<GeneralSettingsData>(), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [edit, setEdit] = useState<{ kind: 'update' | 'reset'; snapshot: GeneralSettingsData }>(), generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current; setLoading(true); setError('');
    try { const response = await fetch(`/api/v1/general-settings?${new URLSearchParams({ workspace_id: workspaceId })}`), body = await response.json(); if (!response.ok) throw new Error(body.error || '설정을 불러오지 못했습니다.'); if (current === generation.current) setData(body); }
    catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '조회 실패'); }
    finally { if (current === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void reload(); return () => { ++generation.current; }; }, [reload]);
  return <div className="live live-settings-page"><header className="live-head"><div><h1>일반 환경 설정</h1><p>{data?.workspace_name} · 수집 기본값</p></div><button disabled={loading || !!edit} onClick={() => void reload()}>새로고침</button></header><SettingsNav current="" />
    {error && <ErrorState message={error} retry={reload} />}{loading && <p role="status">설정을 불러오는 중…</p>}{notice && <p role="status" className="live-status">{notice}</p>}
    {data && !error && <><section className="live-card live-section"><h2>데이터 수집 기본 타겟</h2><p>이 워크스페이스에서 새 키워드·세트·아이디어·프롬프트를 추가할 때 적용합니다. 기존 항목의 언어와 국가는 바뀌지 않으며 추가 화면에서 개별 선택할 수 있습니다.</p><dl><dt>분석 언어</dt><dd>{ANALYSIS_LANGUAGES[data.defaults.language as keyof typeof ANALYSIS_LANGUAGES]} ({data.defaults.language})</dd><dt>대상 국가</dt><dd>{ANALYSIS_COUNTRIES[data.defaults.country as keyof typeof ANALYSIS_COUNTRIES]} ({data.defaults.country})</dd><dt>프롬프트 자동 생성</dt><dd>{data.defaults.auto_generate_prompts ? '켜짐' : '꺼짐'}</dd></dl>
      <p>켜면 새 키워드마다 언어별 문장 규칙으로 GEO 질문 1개를 등록하고 연결합니다. 같은 문구·언어·국가의 질문은 재사용하며, 새 질문에는 프롬프트 생성 한도 1회를 사용합니다. 한도가 부족하면 키워드와 질문을 함께 저장하지 않습니다.</p><p>자동 질문은 미분류·미실행 상태입니다. 프롬프트 화면에서 검토·수정하고 실행하거나 예약 세트에 배치하세요. 설정을 꺼도 기존 질문과 예약은 유지됩니다.</p>
      {data.editable ? <div className="live-actions"><button className="primary" disabled={loading} onClick={() => setEdit({ kind: 'update', snapshot: data })}>수집 기본값 수정</button><button disabled={loading} onClick={() => setEdit({ kind: 'reset', snapshot: data })}>수집 기본값 초기화</button></div> : <p>기본값 변경은 워크스페이스 소유자·관리자가 할 수 있습니다.</p>}
    </section><section className="live-card live-section"><h2>인터페이스 언어</h2><p>한국어</p><p className="muted">영어 인터페이스는 아직 제공하지 않습니다. 위 분석 언어는 수집 대상 언어이며 화면 언어와 별개입니다.</p></section></>}
    {edit && <LiveModal title={edit.kind === 'reset' ? '수집 기본값 초기화' : '수집 기본값 수정'} submit={edit.kind === 'reset' ? '초기화' : '저장'} description={edit.kind === 'reset' ? '한국어·대한민국·자동 생성 켜짐으로 되돌립니다. 기존 자료와 다른 워크스페이스 설정은 유지됩니다.' : '현재 워크스페이스의 모든 멤버에게 적용됩니다.'} onClose={() => setEdit(undefined)} onSave={async form => {
      const result = await accountRequest<GeneralSettingsData>('/api/v1/general-settings', { action: edit.kind, workspace_id: workspaceId, expected_revision: edit.snapshot.revision, language: form.get('language'), country: form.get('country'), auto_generate_prompts: form.has('auto_generate_prompts') }); setData(result); setNotice(edit.kind === 'reset' ? '수집 기본값을 초기화했습니다.' : '수집 기본값을 저장했습니다.');
    }}>{edit.kind === 'update' && <><label>분석 언어<select name="language" defaultValue={edit.snapshot.defaults.language}>{Object.entries(ANALYSIS_LANGUAGES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>대상 국가<select name="country" defaultValue={edit.snapshot.defaults.country}>{Object.entries(ANALYSIS_COUNTRIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="check"><input type="checkbox" name="auto_generate_prompts" defaultChecked={edit.snapshot.defaults.auto_generate_prompts} />키워드 추가 시 프롬프트 자동 생성</label></>}</LiveModal>}
  </div>;
}
