/** Replace captured plan usage with the selected workspace's authorized quota. */
const LABEL_TO_UNIT: Readonly<Record<string, string>> = { '키워드': 'keyword_create', 'AI 프롬프트': 'prompt_create', '콘텐츠': 'content_gen', '사이트 진단': 'site_audit_scan' };
interface QuotaRow { unit_key: string; plan_used: number; plan_limit: number }
function applyRow(label: HTMLElement, row?: QuotaRow) {
  const value = label.nextElementSibling as HTMLElement | null; if (!value || value.tagName !== 'SPAN') return;
  const card = label.parentElement?.parentElement?.parentElement;
  const percent = card?.querySelector<HTMLElement>('[data-live-usage-percent]') || Array.from(card?.querySelectorAll<HTMLElement>('span,p,div') || []).find(el => el.children.length === 0 && /^\d+% 사용$/.test(el.textContent?.trim() || ''));
  if (percent) { percent.dataset.liveUsagePercent = 'true'; percent.textContent = row && row.plan_limit > 0 ? `${Math.round(100 * row.plan_used / row.plan_limit)}% 사용` : row?.plan_limit === 0 && row.plan_used === 0 ? '0% 사용' : '사용량 미확인'; }
  if (!row) { value.textContent = '미확인'; return; }
  const limit = document.createElement('span'); limit.textContent = `/ ${row.plan_limit}`;
  value.replaceChildren(document.createTextNode(`${row.plan_used} `), limit);
}
export function initializeLiveUsage(root: HTMLElement, route: string, workspaceId: string): () => void {
  const url = new URL(route, 'http://local');
  if (url.pathname !== '/app/settings' || url.searchParams.get('tab') !== 'plan') return () => {};
  let generation = 0;
  const apply = (rows: QuotaRow[]) => {
    const units = new Map(rows.map(row => [row.unit_key, row]));
    for (const label of root.querySelectorAll<HTMLElement>('span')) { const unit = LABEL_TO_UNIT[label.textContent?.trim() || '']; if (unit) applyRow(label, units.get(unit)); }
  };
  const refresh = async () => {
    const current = ++generation; apply([]); if (!workspaceId) return;
    try {
      const response = await fetch('/api/v1/rpc/get_workspace_quota_summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_workspace_id: workspaceId }) });
      if (!response.ok) return;
      const rows: unknown = await response.json();
      if (current === generation && Array.isArray(rows)) apply(rows.filter(row => row && typeof row.unit_key === 'string' && Number.isFinite(row.plan_used) && row.plan_used >= 0 && Number.isFinite(row.plan_limit) && row.plan_limit >= 0));
    } catch { /* Captured demo values stay replaced by unknown on failure. */ }
  };
  void refresh();
  const click = (event: MouseEvent) => { if ((event.target as HTMLElement | null)?.closest('button')?.textContent?.trim() === '새로고침') void refresh(); };
  root.addEventListener('click', click); window.addEventListener('halox:usage-changed', refresh); window.addEventListener('focus', refresh);
  return () => { generation++; root.removeEventListener('click', click); window.removeEventListener('halox:usage-changed', refresh); window.removeEventListener('focus', refresh); };
}
