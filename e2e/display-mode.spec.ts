import { expect, test } from '@playwright/test';

test('mobile display mode control stays outside the application content', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const origin = new URL(baseURL!);
  await page.context().addCookies([{ name: 'halox_display', value: 'live', domain: origin.hostname, path: '/' }]);
  await page.goto('/app/keywords');

  const toggle = page.getByRole('button', { name: '표시 모드를 원본 1:1 모드로 전환' });
  const surface = page.locator('.clone-surface');
  await expect(toggle).toBeVisible();
  await expect(surface).toBeVisible();

  const [toggleBox, surfaceBox] = await Promise.all([toggle.boundingBox(), surface.boundingBox()]);
  expect(toggleBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  expect(toggleBox!.y + toggleBox!.height).toBeLessThanOrEqual(surfaceBox!.y);
});
