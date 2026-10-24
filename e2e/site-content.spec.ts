import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: path.join(__dirname, '.auth', 'raw-state.json') });
const root = (page: Page) => page.locator('body');
const modal = (page: Page) => page.getByRole('dialog');
async function save(page: Page, label = '저장') { await modal(page).getByRole('button', { name: label, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }

test('captured select keeps its initial value without React selected-option warnings', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('setting `selected` on <option>')) warnings.push(message.text()); });
  await page.goto('/ko/contact-sales');
  await expect(page.locator('select[name="field-1"]')).toHaveValue('onboarding');
  expect(warnings).toEqual([]);
});

test('operator publishes versioned public content and manages persisted public inquiries', async ({ page, browser, baseURL }) => {
  const suffix = Date.now().toString(36), route = `/ko/cms-e2e-${suffix}`, title = `CMS E2E ${suffix}`;
  await page.goto('/app/site-content');
  await expect(root(page).getByRole('heading', { name: '공개 사이트 콘텐츠' })).toBeVisible();
  await root(page).getByRole('button', { name: '페이지 추가', exact: true }).click();
  await modal(page).getByLabel('공개 경로').fill(route);
  await modal(page).getByLabel('제목', { exact: true }).fill(title);
  await modal(page).getByLabel('요약').fill('게시된 요약');
  await modal(page).getByLabel('본문 Markdown').fill('# 게시 본문\n\n최초 공개 내용입니다.');
  await modal(page).getByLabel('SEO 제목').fill(`${title} SEO`);
  await save(page);
  let card = root(page).getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(card).toContainText('draft');
  await card.getByRole('button', { name: '게시', exact: true }).click(); await save(page, '게시');

  const guest = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const publicPage = await guest.newPage();
    await publicPage.goto(route); await expect(publicPage.getByRole('heading', { name: title, exact: true })).toBeVisible(); await expect(publicPage.locator('body')).toContainText('최초 공개 내용입니다.');
    await card.getByRole('button', { name: '수정', exact: true }).click();
    await modal(page).getByLabel('제목', { exact: true }).fill(`${title} 수정`); await modal(page).getByLabel('본문 Markdown').fill('# 수정 초안\n\n아직 공개되지 않은 내용입니다.'); await save(page);
    await publicPage.reload(); await expect(publicPage.getByRole('heading', { name: title, exact: true })).toBeVisible(); await expect(publicPage.locator('body')).not.toContainText('아직 공개되지 않은 내용입니다.');
    card = root(page).getByRole('article').filter({ has: page.getByRole('heading', { name: `${title} 수정`, exact: true }) });
    await card.getByRole('button', { name: '게시', exact: true }).click(); await save(page, '게시');
    await publicPage.reload(); await expect(publicPage.getByRole('heading', { name: `${title} 수정`, exact: true })).toBeVisible(); await expect(publicPage.locator('body')).toContainText('아직 공개되지 않은 내용입니다.');

    await publicPage.goto('/ko/contact-sales');
    const form = publicPage.locator('form').filter({ has: publicPage.locator('input[name="email"]') });
    await form.locator('input[name="name"]').fill(`문의자 ${suffix}`);
    await form.locator('input[name="email"]').fill(`contact-${suffix}@example.test`);
    await form.locator('input[name="company"]').fill(`문의 회사 ${suffix}`);
    await form.locator('select[name="field-1"]').selectOption('onboarding');
    await form.locator('select[name="field-5"]').selectOption('saas');
    await form.locator('select[name="field-6"]').selectOption('lt50');
    await form.locator('input[name="phone"]').fill('010-1234-5678');
    await form.locator('textarea[name="message"]').fill('CMS 문의 접수 E2E입니다.');
    await form.getByRole('checkbox').click();
    await expect(form.locator('input[name="field-9"]')).toBeChecked();
    await form.locator('button[type="submit"]').click();
    await expect(publicPage.locator('.clone-toast')).toContainText('문의가 접수되었습니다');

    await root(page).getByRole('button', { name: '새로고침', exact: true }).click();
    await root(page).getByRole('button', { name: '문의 접수', exact: true }).click();
    const inquiry = root(page).getByRole('article').filter({ hasText: `문의 회사 ${suffix}` });
    await expect(inquiry).toContainText('CMS 문의 접수 E2E입니다.');
    await inquiry.getByRole('button', { name: '상태·메모 수정', exact: true }).click();
    await modal(page).getByLabel('상태').selectOption('contacted'); await modal(page).getByLabel('운영 메모').fill('전화 완료'); await save(page);
    await expect(root(page).getByRole('article').filter({ hasText: `문의 회사 ${suffix}` })).toContainText('contacted');
    await root(page).getByRole('article').filter({ hasText: `문의 회사 ${suffix}` }).getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
    await expect(root(page)).not.toContainText(`문의 회사 ${suffix}`);

    await root(page).getByRole('button', { name: '페이지·글', exact: true }).click();
    card = root(page).getByRole('article').filter({ has: page.getByRole('heading', { name: `${title} 수정`, exact: true }) });
    await card.getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
    const deleted = await publicPage.goto(route); expect(deleted?.status()).toBe(404);
  } finally { await guest.close(); }

  const member = await browser.newContext({ baseURL, storageState: path.join(__dirname, '.auth', 'state.json') });
  try { expect((await member.request.get('/api/v1/site-content?admin=1')).status()).toBe(403); } finally { await member.close(); }
});
