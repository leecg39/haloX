import { expect, test } from '@playwright/test';

test('legacy capture cookie cannot disable the functional app on mobile', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const origin = new URL(baseURL!);
  await page.context().addCookies([{ name: 'halox_display', value: 'original', domain: origin.hostname, path: '/' }]);
  await page.goto('/app/keywords');

  const toggle = page.getByRole('button', { name: '표시 모드를 원본 1:1 모드로 전환' });
  await expect(toggle).toHaveCount(0);
  await expect(page.locator('[data-live-root]')).toBeVisible();
  await expect(page.locator('[data-live-root]').getByRole('heading', { name: '키워드 현황', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-live-root]')).toBeVisible();
});
