import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { runTranslationCommand } from '../src/lib/backend/translation-service';
import type { TranslationClient } from '../src/lib/backend/openai-translation';
import { ExternalServiceError } from '../src/lib/backend/public-json';
import { OTHER_USER_ID } from '../src/lib/backend/database';

test.use({ storageState: path.join(__dirname, '.auth', 'export-state.json') });
const live = (page: Page) => page.locator('[data-live-root]'), dialog = (page: Page) => page.getByRole('dialog');
async function submit(page: Page, name = '저장') { await dialog(page).getByRole('button', { name, exact: true }).click(); await expect(dialog(page)).not.toBeVisible(); }
async function setup(page: Page) {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `자동 번역 검증 ${Date.now()}` } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  const content = await page.request.post('/api/v1/functions/content-create', { data: { workspace_id: ws.id, title: '번역할 안내문', target_keyword: '사용 방법', content_md: '## 사용 방법\n제품을 켜고 시작해 주세요.', meta_title: '안내문', meta_description: '처음 사용하는 분을 위한 설명' } }); expect(content.status()).toBe(200);
  await page.goto('/app/exports'); await expect(live(page).getByRole('button', { name: '파일 만들기', exact: true })).toBeEnabled();
  await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name);
  await live(page).getByRole('button', { name: '번역문 관리', exact: true }).click(); return ws;
}
async function start(page: Page) {
  await live(page).getByRole('button', { name: '자동 번역', exact: true }).click();
  await dialog(page).getByLabel('번역할 콘텐츠').selectOption({ label: '번역할 안내문' });
  await dialog(page).getByRole('checkbox').check();
}
async function mockProvider(page: Page, client: TranslationClient) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!);
  // Only paid OpenAI I/O is replaced. Commands persist through the actual service
  // and isolated SQLite store; the remaining endpoints are real HTTP requests.
  await page.route('**/api/v1/functions/translate-content-v2', async route => {
    try { const result = await runTranslationCommand(store, 'translate-content-v2', route.request().postDataJSON(), OTHER_USER_ID, client); await route.fulfill({ status: result.ok === false ? 502 : 200, json: result }); }
    catch (error) { await route.fulfill({ status: 400, json: { error: (error as Error).message } }); }
  });
  return store;
}

test('missing automatic translation settings fail honestly and preserve the selected input on mobile', async ({ page }) => {
  const ws = await setup(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 }); await start(page); await dialog(page).getByLabel('번역 언어').selectOption('ja');
    const response = page.waitForResponse('**/api/v1/functions/translate-content-v2');
    await dialog(page).getByRole('button', { name: 'OpenAI 번역 요청', exact: true }).click(); expect((await response).status()).toBe(503);
    await expect(dialog(page).getByRole('alert')).toContainText('아직 설정되지'); await expect(dialog(page).getByLabel('번역 언어')).toHaveValue('ja'); await expect(dialog(page).getByLabel('번역할 콘텐츠')).not.toHaveValue('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const data = await (await page.request.get(`/api/v1/exports?workspace_id=${ws.id}`)).json(); expect(data.translation_runs).toHaveLength(0); expect(data.translation_configured).toBe(false);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('automatic translation results require review, persist edits and history, and download real translated bytes', async ({ page }) => {
  const ws = await setup(page); let requests = 0;
  await mockProvider(page, { translate: async batch => { requests++; return { pieces: batch.map(piece => ({ text: piece.field === 'title' ? 'Product instructions' : piece.field === 'content_md' ? '## Getting started\nTurn on your device.' : 'Product guide' })), usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 }, model: 'gpt-4.1-mini', response_id: 'resp_e2e' }; } });
  try {
    await start(page); await submit(page, 'OpenAI 번역 요청'); await expect(live(page)).toContainText('번역문 저장됨'); expect(requests).toBe(1); await expect(live(page)).toContainText('확인된 토큰: 입력 100 · 출력 80 · 합계 180');
    await live(page).getByRole('button', { name: '실행 메모 수정', exact: true }).click(); await dialog(page).getByLabel('실행 메모').fill('담당자 검토 예정'); await submit(page);
    await page.reload(); await live(page).getByRole('button', { name: '번역 실행', exact: true }).click(); await expect(live(page)).toContainText('담당자 검토 예정');
    await live(page).getByRole('button', { name: '파일 만들기', exact: true }).click(); await dialog(page).getByLabel('내보낼 자료').selectOption('translation'); expect(await dialog(page).getByLabel('번역문', { exact: true }).locator('option').count()).toBe(1); await dialog(page).getByRole('button', { name: '취소', exact: true }).click();
    await live(page).getByRole('button', { name: '번역문 관리', exact: true }).click(); await expect(live(page)).toContainText('OpenAI · 검토 중');
    await live(page).getByRole('button', { name: '번역문 편집', exact: true }).click(); await expect(dialog(page).getByLabel('번역 본문')).toHaveValue('## Getting started\nTurn on your device.'); await dialog(page).getByLabel('번역 본문').fill('## Reviewed instructions\nStart here.'); await dialog(page).getByLabel('검토 상태').selectOption('ready'); await submit(page);
    await live(page).getByRole('button', { name: '파일 만들기', exact: true }).click(); await dialog(page).getByLabel('내보낼 자료').selectOption('translation'); await dialog(page).getByLabel('번역문', { exact: true }).selectOption({ label: 'Product instructions (en)' }); await submit(page, '파일 저장');
    await live(page).getByRole('button', { name: '파일 이력', exact: true }).click(); const downloading = page.waitForEvent('download'); await live(page).getByRole('button', { name: '다운로드', exact: true }).click(); const download = await downloading;
    const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk)); expect(Buffer.concat(chunks).toString()).toBe('## Reviewed instructions\nStart here.');
    const outsider = await page.context().browser()!.newContext({ storageState: path.join(__dirname, '.auth', 'state.json') });
    try { expect((await outsider.request.get(`/api/v1/exports?workspace_id=${ws.id}`)).status()).toBe(403); } finally { await outsider.close(); }
    const data = await (await page.request.get(`/api/v1/exports?workspace_id=${ws.id}`)).json(); expect(data.translation_runs[0].status).toBe('succeeded'); expect(data.article_translations[0].origin).toBe('openai');
    expect((await page.request.patch(`/api/v1/rest/translation_runs?id=eq.${data.translation_runs[0].id}`, { data: { status: 'succeeded' } })).status()).toBe(403);
    await live(page).getByRole('button', { name: '번역 실행', exact: true }).click(); await live(page).getByRole('button', { name: '실행 이력 삭제', exact: true }).click(); await submit(page, '삭제'); await expect(live(page)).toContainText('자동 번역 실행 이력이 없습니다');
    await live(page).getByRole('button', { name: '번역문 관리', exact: true }).click(); await expect(live(page)).toContainText('Product instructions'); expect(requests).toBe(1);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('uncertain translation stays visible, repeated submit never resends and explicit delayed closure persists', async ({ page }) => {
  const ws = await setup(page); let requests = 0;
  const store = await mockProvider(page, { translate: async () => { requests++; throw new ExternalServiceError('번역 응답 시간 초과'); } });
  try {
    await start(page); await dialog(page).getByRole('button', { name: 'OpenAI 번역 요청', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('번역 응답 시간 초과');
    await dialog(page).getByRole('button', { name: 'OpenAI 번역 요청', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('번역 응답 시간 초과'); expect(requests).toBe(1);
    await dialog(page).getByRole('button', { name: '취소', exact: true }).click(); await expect(live(page)).toContainText('결과 확인 필요');
    await live(page).getByRole('button', { name: '실행 수동 종료', exact: true }).click(); await dialog(page).getByRole('checkbox').check(); await dialog(page).getByRole('button', { name: '종료', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('5분'); await dialog(page).getByRole('button', { name: '취소', exact: true }).click();
    await store.write(db => { const row = db.queryTable('translation_runs', { filters: { workspace_id: `eq.${ws.id}` } }, OTHER_USER_ID).data[0]; db.updateTable('translation_runs', { last_checkpoint_at: new Date(Date.now() - 301000).toISOString() }, { id: `eq.${row.id}` }, OTHER_USER_ID); });
    await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await live(page).getByRole('button', { name: '실행 수동 종료', exact: true }).click(); await dialog(page).getByRole('checkbox').check(); await submit(page, '종료'); await expect(live(page)).toContainText('수동 확인 후 종료'); expect(requests).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    // Ensure a failed assertion cannot leave an unresolved fixture run behind.
    await store.write(db => db.updateTable('translation_runs', { status: 'abandoned' }, { workspace_id: `eq.${ws.id}` }, OTHER_USER_ID));
    await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`);
  }
});
