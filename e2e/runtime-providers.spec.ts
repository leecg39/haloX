import { expect, test } from '@playwright/test';

test.describe('live runtime without configured external keys', () => {
  test.skip(process.env.HALOX_E2E_PROVIDER_MODE !== 'live', 'Run with HALOX_E2E_PROVIDER_MODE=live');

  test('requires authentication for provider configuration and never exposes credentials', async ({ page, playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try { expect((await anonymous.get('/api/v1/providers')).status()).toBe(401); } finally { await anonymous.dispose(); }
    const response = await page.request.get('/api/v1/providers');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ mode: 'live', openai: false, dataforseo: false });
  });

  test('keyless AI generation keeps the form, shows the missing setting, and creates no fake content', async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'halox_display', value: 'original', domain: new URL(baseURL!).hostname, path: '/' }]);
    await page.goto('/app/factory');
    const live = page.locator('[data-live-root]');
    await expect(live).toContainText('OpenAI 연동 대기');
    await live.getByRole('button', { name: '새 콘텐츠 만들기', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('작성 방법').selectOption('generated');
    await dialog.getByLabel('주제', { exact: true }).fill('실수집 키 누락 확인');
    await dialog.getByRole('button', { name: '초안 생성', exact: true }).click();
    await expect(dialog).toContainText('OPENAI_API_KEY 서버 환경변수를 설정해 주세요.');
    await expect(dialog.getByLabel('주제', { exact: true })).toHaveValue('실수집 키 누락 확인');
    await expect(page).toHaveURL(/\/app\/factory$/);
  });

  test('live APIs fail explicitly when keys are absent instead of returning mock success', async ({ page }) => {
    const session = await (await page.request.get('/api/v1/auth')).json();
    const workspace_id = session.workspaces[0].id;
    for (const [name, payload, setting] of [
      ['generate-content-draft', { target_keyword: '키 누락 확인' }, 'OPENAI_API_KEY'],
      ['geo-run', { prompt_text: '어떤 도구가 좋나요?', engines: ['openai'] }, 'OPENAI_API_KEY'],
      ['keywords-collect', { keywords: ['실수집 확인'] }, 'DATAFORSEO_LOGIN'],
    ] as const) {
      const result = await page.request.post(`/api/v1/functions/${name}`, { data: { workspace_id, ...payload } });
      expect(result.status()).toBe(503);
      expect((await result.json()).error).toContain(setting);
    }
  });
});
