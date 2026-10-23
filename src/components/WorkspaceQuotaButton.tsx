'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { canAccess } from '@/lib/permissions/workspace';
import { useWorkspace } from './WorkspaceProvider';
type Usage = { workspace: string; used: number; limit: number };
export function WorkspaceQuotaButton({ className }: { className?: string }) {
  const { activeWorkspace, permission } = useWorkspace(), router = useRouter();
  const [usage, setUsage] = useState<Usage>(), generation = useRef(0);
  useEffect(() => {
    const workspace = activeWorkspace.id;
    const refresh = async () => {
      const request = ++generation.current; setUsage(undefined); if (!workspace) return;
      try {
        const response = await fetch('/api/v1/rpc/get_workspace_quota_summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_workspace_id: workspace }) });
        if (!response.ok) return;
        const rows: unknown = await response.json();
        const row = Array.isArray(rows) ? rows.find(item => item?.unit_key === 'prompt_create') : undefined;
        if (request === generation.current && row && Number.isFinite(row.plan_used) && row.plan_used >= 0 && Number.isFinite(row.plan_limit) && row.plan_limit >= 0) setUsage({ workspace, used: row.plan_used, limit: row.plan_limit });
      } catch { /* Unavailable usage remains explicitly unknown. */ }
    };
    void refresh(); window.addEventListener('halox:usage-changed', refresh); window.addEventListener('focus', refresh);
    return () => { ++generation.current; window.removeEventListener('halox:usage-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [activeWorkspace.id]);
  const current = usage?.workspace === activeWorkspace.id ? usage : undefined;
  const percent = current && current.limit > 0 ? `${Math.round(100 * current.used / current.limit)}%` : '—';
  const label = current ? `AI 프롬프트 ${current.used} / ${current.limit} · 사용량 보기` : 'AI 프롬프트 사용량 미확인';
  return <button type="button" data-live-quota="true" className={className} aria-label={label} title={label} disabled={!activeWorkspace.id || !canAccess(permission, 'other')} onClick={event => { event.stopPropagation(); router.push('/app/settings?tab=plan'); }}>{percent}</button>;
}
