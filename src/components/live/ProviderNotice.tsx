'use client';

import { useEffect, useState } from 'react';

type Status = { mode: 'live' | 'demo'; openai: boolean; dataforseo: boolean };
export function ProviderNotice({ service }: { service: 'openai' | 'dataforseo' }) {
  const [status, setStatus] = useState<Status>(), [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/providers', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error();
      setStatus(await response.json());
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  if (error) return <p role="status" className="muted">외부 서비스 설정 상태를 확인하지 못했습니다. 화면을 새로고침해 주세요.</p>;
  if (!status) return null;
  if (status.mode === 'demo') return <p role="status" className="live-error">현재 서버는 오프라인 테스트 모드입니다. 수집·생성 결과는 모의 자료이며 외부 API를 호출하지 않습니다.</p>;
  if (!status[service]) return <p role="status" className="live-error">{service === 'openai' ? 'OpenAI 연동 대기: 서버에 OPENAI_API_KEY를 설정하면 AI 생성·응답 수집을 사용할 수 있습니다.' : '검색 연동 대기: 서버에 DATAFORSEO_LOGIN과 DATAFORSEO_PASSWORD를 설정하면 검색 결과를 수집할 수 있습니다.'} 설정 후 서버를 재시작해 주세요.</p>;
  return <p className="muted">{service === 'openai' ? 'OpenAI' : 'DataForSEO'} 자격증명이 설정되어 있습니다. 실행 시 입력 내용이 해당 서비스로 전송되고 API 비용이 발생합니다.</p>;
}
