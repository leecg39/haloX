import { expect, test, type APIRequestContext } from '@playwright/test';

/** S7 journeys in settings: member invite and live usage (docs/clone/user-journeys.md J6). */

const WORKSPACE = '11111111-1111-4000-8000-111111111111';
const UNIT_LABELS: Record<string, string> = {
  keyword_create: '키워드',
  prompt_create: 'AI 프롬프트',
  content_gen: '콘텐츠',
  site_audit_scan: '사이트 진단',
};

type QuotaUnit = { unit_key: string; plan_used: number; plan_limit: number };

async function quota(api: APIRequestContext): Promise<QuotaUnit[]> {
  const res = await api.post('/api/v1/rpc/get_workspace_quota_summary', { data: { _workspace_id: WORKSPACE } });
  expect(res.status()).toBe(200);
  return (await res.json()) as QuotaUnit[];
}

test('J6 member invite stores a pending invitation for the entered email', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto('/app/settings?tab=members');
  await page.getByRole('button', { name: '멤버 초대', exact: true }).first().click();
  const dialog = page.getByRole('dialog').last();
  const field = dialog.locator('input[type=email]').first();
  await expect(field).toBeVisible();
  await field.fill(email);
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('발급한 초대 링크')).toHaveValue(/\/app\/invite#token=/);

  await expect.poll(async () => {
    const res = await request.get(`/api/v1/rest/workspace_invitations?email=eq.${encodeURIComponent(email)}`);
    return ((await res.json()) as unknown[]).length;
  }).toBe(1);
  const [invite] = (await (await request.get(`/api/v1/rest/workspace_invitations?email=eq.${encodeURIComponent(email)}`)).json()) as Array<Record<string, unknown>>;
  expect(invite.workspace_id).toBe(WORKSPACE);
  expect(invite.status).toBe('pending');
});

test('J6 usage tab shows live quota from the backend for all four units', async ({ page, request }) => {
  // Change usage first so a stale captured number cannot pass by accident.
  const res = await request.post('/api/v1/functions/keywords-collect', {
    data: { workspace_id: WORKSPACE, keywords: [`e2e usage ${Date.now()}`] },
  });
  expect(res.status()).toBe(200);
  const units = await quota(request);

  await page.goto('/app/settings?tab=plan');
  const section = page.locator('text=실시간 사용량').locator('xpath=ancestor::div[.//span[normalize-space()="키워드"]][1]');
  for (const unit of units) {
    const label = UNIT_LABELS[unit.unit_key];
    expect(label, `label for ${unit.unit_key}`).toBeTruthy();
    const value = section.locator(`span:text-is("${label}") + span`).first();
    await expect(value, label).toHaveText(`${unit.plan_used} / ${unit.plan_limit}`);
  }
});
