/**
 * Live usage for the settings plan tab ("실시간 사용량").
 * The captured page shows usage numbers frozen at capture time; this replaces them
 * with get_workspace_quota_summary from the backend and refreshes on "새로고침".
 */

const DEFAULT_WORKSPACE_UUID = '11111111-1111-4000-8000-111111111111';

// Row labels in the captured usage card → original quota unit keys.
const LABEL_TO_UNIT: Readonly<Record<string, string>> = Object.freeze({
  '키워드': 'keyword_create',
  'AI 프롬프트': 'prompt_create',
  '콘텐츠': 'content_gen',
  '사이트 진단': 'site_audit_scan',
});

interface QuotaRow {
  unit_key: string;
  plan_used: number;
  plan_limit: number;
}

function isQuotaRows(value: unknown): value is QuotaRow[] {
  return Array.isArray(value) && value.every(row =>
    row && typeof row === 'object'
    && typeof (row as QuotaRow).unit_key === 'string'
    && Number.isFinite((row as QuotaRow).plan_used)
    && Number.isFinite((row as QuotaRow).plan_limit));
}

async function fetchQuota(): Promise<QuotaRow[] | null> {
  try {
    const res = await fetch('/api/v1/rpc/get_workspace_quota_summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _workspace_id: DEFAULT_WORKSPACE_UUID }),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isQuotaRows(data) ? data : null;
  } catch {
    return null;
  }
}

/** Rewrite one "<label> <used / limit>" row and its "N% 사용" text, if present. */
function applyRow(labelEl: HTMLElement, row: QuotaRow): void {
  const valueEl = labelEl.nextElementSibling as HTMLElement | null;
  if (!valueEl) return;
  const limitEl = valueEl.querySelector('span');
  const usedNode = Array.from(valueEl.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
  if (usedNode) usedNode.textContent = `${row.plan_used} `;
  if (limitEl) limitEl.textContent = `/ ${row.plan_limit}`;

  const percent = row.plan_limit > 0 ? Math.min(100, Math.round((row.plan_used / row.plan_limit) * 100)) : 0;
  const card = labelEl.parentElement?.parentElement?.parentElement;
  const percentEl = card
    ? Array.from(card.querySelectorAll<HTMLElement>('span,p,div')).find(el => el.children.length === 0 && /^\d+% 사용$/.test(el.textContent?.trim() || ''))
    : undefined;
  if (percentEl) percentEl.textContent = `${percent}% 사용`;
}

async function refresh(root: HTMLElement): Promise<void> {
  const rows = await fetchQuota();
  if (!rows) return;
  const byUnit = new Map(rows.map(r => [r.unit_key, r]));
  for (const labelEl of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
    const unit = LABEL_TO_UNIT[labelEl.textContent?.trim() || ''];
    const row = unit ? byUnit.get(unit) : undefined;
    if (row && labelEl.nextElementSibling?.tagName === 'SPAN') applyRow(labelEl, row);
  }
}

/** Returns a cleanup function. Only active on the settings usage (plan) tab. */
export function initializeLiveUsage(root: HTMLElement, route: string): () => void {
  const url = new URL(route, 'http://local');
  if (url.pathname !== '/app/settings' || url.searchParams.get('tab') !== 'plan') return () => {};
  void refresh(root);
  const onClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement | null)?.closest('button');
    if (button && button.textContent?.trim() === '새로고침') void refresh(root);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
