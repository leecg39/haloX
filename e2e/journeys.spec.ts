import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Core user journeys (docs/clone/user-journeys.md). Each test drives the UI and then
 * verifies the backend state through the same /api/v1 surface the client uses.
 */

const WORKSPACE = '11111111-1111-4000-8000-111111111111';
const ISOLATED_WORKSPACE = '22222222-2222-4000-8000-222222222222';

type Row = Record<string, unknown>;

async function rows(api: APIRequestContext, table: string, query = ''): Promise<Row[]> {
  const res = await api.get(`/api/v1/rest/${table}${query ? `?${query}` : ''}`);
  expect(res.status(), `GET ${table}`).toBe(200);
  return (await res.json()) as Row[];
}

async function quotaUsed(api: APIRequestContext, unit: string): Promise<number> {
  const res = await api.post('/api/v1/rpc/get_workspace_quota_summary', { data: { _workspace_id: WORKSPACE } });
  expect(res.status()).toBe(200);
  const units = (await res.json()) as Array<{ unit_key: string; plan_used: number }>;
  const found = units.find(u => u.unit_key === unit);
  expect(found, `quota unit ${unit}`).toBeTruthy();
  return found!.plan_used;
}

/**
 * Open a dialog from a page button (optionally picking a start option first), fill every
 * required field — the first one with `value` — submit it and wait for the saved toast.
 */
async function submitDialog(
  page: Page, route: string, trigger: string, value: string,
  opts: { choose?: RegExp; submit?: string } = {},
): Promise<void> {
  await page.goto(route);
  await expect(page.locator('.clone-surface')).toBeVisible();
  await page.getByRole('button', { name: trigger, exact: true }).first().click();
  if (opts.choose) await page.getByRole('button', { name: opts.choose }).click();
  const dialog = page.getByRole('dialog').last();
  const fields = dialog.locator('input[required]:not([type=checkbox]):not([type=hidden]), textarea[required]');
  await expect(fields.first()).toBeVisible();
  const count = await fields.count();
  for (let i = 0; i < count; i += 1) {
    const field = fields.nth(i);
    const type = await field.getAttribute('type');
    const filler = i === 0 ? value : type === 'url' ? 'https://example.com' : type === 'email' ? 'e2e@example.com' : 'e2e';
    await field.fill(filler);
  }
  await dialog.getByRole('button', { name: opts.submit ?? '로컬 저장', exact: true }).last().click();
  await expect(page.locator('.clone-toast')).toContainText('로컬 데모에 저장했습니다');
}

test('J1 keyword add charges keyword_create quota and stores the keyword', async ({ page, request }) => {
  const keyword = `e2e 키워드 ${Date.now()}`;
  const before = await quotaUsed(request, 'keyword_create');
  await page.goto('/app/keywords');
  await page.getByRole('button', { name: '키워드 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('키워드 (한 줄에 하나, 최대 20개)').fill(keyword);
  await dialog.getByRole('button', { name: '키워드 추가', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: keyword, exact: true })).toBeVisible();
  await expect.poll(async () => (await rows(request, 'keywords', `keyword=eq.${encodeURIComponent(keyword)}`)).length).toBe(1);
  expect(await quotaUsed(request, 'keyword_create')).toBe(before + 1);
});

test('J2 prompt add creates a GEO prompt and a run', async ({ page, request }) => {
  const prompt = `e2e 질문 ${Date.now()}`;
  await page.goto('/app/geo/prompts');
  await page.getByRole('button', { name: '프롬프트 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('질문', { exact: true }).fill(prompt);
  await dialog.getByRole('button', { name: '추가하고 실행', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: prompt, exact: true })).toBeVisible();
  await expect.poll(async () => (await rows(request, 'geo_prompts', `prompt_text=eq.${encodeURIComponent(prompt)}`)).length).toBe(1);
  const [created] = await rows(request, 'geo_prompts', `prompt_text=eq.${encodeURIComponent(prompt)}`);
  await expect.poll(async () => (await rows(request, 'geo_prompt_runs', `prompt_id=eq.${created.id}`)).length).toBeGreaterThan(0);
});

test('J3 new site audit creates a scan for the entered URL', async ({ page, request }) => {
  const url = `https://e2e-${Date.now()}.example.com`;
  await submitDialog(page, '/app/site-audit', '새 진단', url, { submit: '다음: 수집 범위' });
  await expect.poll(async () => (await rows(request, 'site_audit_scans', `target_url=eq.${encodeURIComponent(url)}`)).length).toBe(1);
});

test('J4 new content creates a content job with a draft', async ({ page, request }) => {
  const topic = `e2e 콘텐츠 ${Date.now()}`;
  const before = (await rows(request, 'content_jobs')).length;
  await page.goto('/app/factory');
  await page.getByRole('button', { name: '새 콘텐츠 만들기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('작성 방법').selectOption('generated');
  await dialog.getByLabel('주제', { exact: true }).fill(topic);
  await dialog.getByRole('button', { name: '초안 생성', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await rows(request, 'content_jobs')).length).toBe(before + 1);
  const job = (await rows(request, 'content_jobs', `target_keyword=eq.${encodeURIComponent(topic)}`))[0];
  expect(job, 'content job for the entered topic').toBeTruthy();
  await expect.poll(async () => (await rows(request, 'content_drafts', `content_job_id=eq.${job.id}`)).length).toBeGreaterThan(0);
});

test('J5 weekly report page renders and a weekly snapshot can be generated', async ({ page, request }) => {
  await page.goto('/app/reports/weekly');
  await expect(page.locator('.clone-surface')).toBeVisible();
  const before = (await rows(request, 'report_snapshots', 'period_type=eq.week')).length;
  const res = await request.post('/api/v1/functions/report-snapshot', { data: { workspace_id: WORKSPACE, period_type: 'week' } });
  expect(res.status()).toBe(200);
  expect((await rows(request, 'report_snapshots', 'period_type=eq.week')).length).toBe(before + 1);
});

test('J6 API key issue stores a workspace API key', async ({ page, request }) => {
  const name = `e2e-key-${Date.now()}`;
  await submitDialog(page, '/app/settings?tab=api', '키 발급', name);
  await expect.poll(async () => (await rows(request, 'workspace_api_keys', `name=eq.${encodeURIComponent(name)}`)).length).toBe(1);
  const [key] = await rows(request, 'workspace_api_keys', `name=eq.${encodeURIComponent(name)}`);
  expect(key.key_hash, 'key hash must never be returned to clients').toBeUndefined();
});

test('J6 tenant isolation: another workspace is not readable', async ({ request }) => {
  expect(await rows(request, 'workspaces', `id=eq.${ISOLATED_WORKSPACE}`)).toHaveLength(0);
  const res = await request.post('/api/v1/rpc/reserve_unit_with_bypass', {
    data: { _workspace_id: ISOLATED_WORKSPACE, _unit_key: 'keyword_create', _amount: 1, _idempotency_key: `e2e-x-${Date.now()}` },
  });
  expect(res.status()).toBe(403);
});

test('quota reservations cannot be created, committed or released directly by clients', async ({ request }) => {
  const reservations = await rows(request, 'usage_reservations', `workspace_id=eq.${WORKSPACE}`);
  expect(reservations.length).toBeGreaterThan(0);
  for (const fn of ['reserve_unit_with_bypass', 'commit_reservation', 'release_reservation']) {
    const response = await request.post(`/api/v1/rpc/${fn}`, { data: { p_workspace_id: WORKSPACE, p_reservation_id: reservations[0].id, p_unit_key: 'prompt_create', p_amount: 1 } });
    expect(response.status()).toBe(403);
    expect((await request.post('/api/v1/functions/rpc-cache', { data: { rpc_name: fn, args: { p_workspace_id: WORKSPACE, p_reservation_id: reservations[0].id } } })).status()).toBe(403);
  }
  expect(await rows(request, 'usage_reservations', `workspace_id=eq.${WORKSPACE}`)).toEqual(reservations);
});
