import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';
test.use({ storageState: { cookies: [], origins: [] } });
const root = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
const password = 'earned-local-test-password', url = 'https://media.example.invalid/published?id=1';
async function fixture(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), hash = await hashPassword(password);
  const owner = await store.write(db => db.createAccount({ email: `earned-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '발행 콘텐츠 담당자', passwordHash: hash }));
  const response = await page.request.post('/api/v1/auth', { data: { email: owner.email, password } }); expect(response.status()).toBe(200); const workspace = (await response.json()).workspaces[0];
  await page.goto('/app/settings?tab=earned'); await expect(root(page).getByRole('button', { name: '첫 URL 등록하기', exact: true })).toBeVisible();
  const data = async () => (await page.request.get(`/api/v1/earned?workspace_id=${workspace.id}`)).json();
  const post = (values: Record<string, unknown>) => page.request.post('/api/v1/earned', { data: { workspace_id: workspace.id, ...values } });
  return { store, owner, workspace, data, post };
}
async function submit(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
async function add(page: Page, title = '외부 발행 글') {
  await root(page).getByRole('button', { name: /첫 URL 등록하기|^URL 등록$/ }).click(); await modal(page).getByLabel('발행 URL').fill(url); await modal(page).getByLabel('콘텐츠 제목').fill(title); await modal(page).getByLabel('채널', { exact: true }).fill('미디어'); await submit(page);
}
test('registered URL CRUD and imported SERP/AIO/GEO evidence persist across login without changing original observations', async ({ page, browser, baseURL }) => {
  const f = await fixture(page); await add(page); const registered = (await f.data()).rows[0];
  const kw = await f.store.write(db => db.insertTable('keywords', { workspace_id: f.workspace.id, keyword: '발행 글 검색' }, String(f.owner.id))[0]);
  const contents = JSON.stringify({ schema_version: 1, kind: 'seo', source: { provider: 'e2e-fixture' }, records: [{ source_id: 'earned-proof', keyword_id: kw.id, keyword_text: kw.keyword, language: kw.language, country: kw.country, engine: 'google', captured_at: new Date(Date.now() - 1000).toISOString(), top_results: [{ url: url + '#heading', rank: 4 }], ai_overview_detected: true, ai_overview: { cited_domains: ['media.example.invalid'], cited_urls: [url] } }] });
  const imported = await page.request.post('/api/v1/functions/raw-import-create', { data: { workspace_id: f.workspace.id, title: '등록 URL 관측 근거', filename: 'earned.json', contents, idempotency_key: crypto.randomUUID() } }); expect(imported.status()).toBe(200);
  await f.store.write(db => {
    const prompt = db.insertTable('geo_prompts', { workspace_id: f.workspace.id, prompt_text: '발행 글 추천' }, String(f.owner.id))[0];
    const run = db.insertTable('geo_prompt_runs', { workspace_id: f.workspace.id, prompt_id: prompt.id, prompt_text: prompt.prompt_text, language_code: prompt.language_code, location_code: prompt.location_code, engine: 'openai', status: 'completed', finished_at: new Date().toISOString(), provider: 'e2e-fixture' }, String(f.owner.id))[0];
    db.insertTable('geo_citations', { workspace_id: f.workspace.id, run_id: run.id, cited_url: url }, String(f.owner.id));
  });
  await page.reload(); const card = root(page).getByRole('article', { name: '외부 발행 글', exact: true }); await expect(card).toContainText('SERP 1회 · AIO 1회 · GEO 1회'); await card.getByRole('button', { name: '관측 근거 (3)' }).click(); await expect(modal(page)).toContainText('import:e2e-fixture'); await expect(modal(page)).toContainText('4위'); await modal(page).getByRole('button', { name: '닫기', exact: true }).click();
  await card.getByRole('button', { name: 'URL 수정', exact: true }).click(); await modal(page).getByLabel('콘텐츠 제목').fill('발행 글 검토본'); await modal(page).getByLabel('URL 메모').fill('확인한 출처'); await submit(page);
  const other = await browser.newContext({ baseURL }); try { expect((await other.request.post('/api/v1/auth', { data: { email: f.owner.email, password } })).status()).toBe(200); const second = await other.newPage(); await second.goto('/app/settings?tab=earned'); await expect(root(second)).toContainText('확인한 출처'); } finally { await other.close(); }
  await root(page).getByRole('button', { name: 'URL 삭제', exact: true }).click(); await submit(page, '삭제'); await expect(root(page)).toContainText('아직 등록된 URL이 없습니다.');
  expect(await f.store.read(db => db.queryTable('serp_snapshots', { filters: { workspace_id: `eq.${f.workspace.id}` } }, String(f.owner.id)).count)).toBe(1);
  expect((await page.request.patch(`/api/v1/rest/earned_publications?id=eq.${registered.id}`, { data: { url: 'https://forged.invalid/' } })).status()).toBe(403);
});
test('CSV file preview, pagination and atomic save preserve failed input, reject stale previews and export real formula-safe bytes', async ({ page }) => {
  const f = await fixture(page); await root(page).getByRole('button', { name: 'CSV 업로드', exact: true }).click();
  await modal(page).getByLabel('CSV 내용').fill('url\nhttps://media.example.invalid/good\nhttp://localhost/bad'); await modal(page).getByRole('button', { name: 'CSV 미리보기', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('데이터 2행'); expect((await f.data()).rows).toHaveLength(0);
  const csv = 'url,title,channel\r\n' + Array.from({ length: 16 }, (_, i) => `https://media.example.invalid/${i},${i === 0 ? '=1+1' : '자료 ' + i},뉴스`).join('\r\n');
  await modal(page).getByLabel('CSV 파일').setInputFiles({ name: 'publications.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFF' + csv) }); await expect(modal(page).getByLabel('CSV 내용')).toHaveValue(csv.replaceAll('\r\n', '\n'));
  await modal(page).getByRole('button', { name: 'CSV 미리보기', exact: true }).click(); await expect(modal(page)).toContainText('저장할 URL 16개'); await modal(page).getByRole('button', { name: '다음', exact: true }).click(); await expect(modal(page)).toBeVisible(); expect((await f.data()).rows).toHaveLength(0);
  expect((await f.post({ action: 'create', url, title: '동시 등록', request_id: crypto.randomUUID() })).status()).toBe(200);
  await modal(page).getByRole('button', { name: '검토한 URL 저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('변경'); await expect(modal(page).getByLabel('CSV 내용')).toHaveValue(csv.replaceAll('\r\n', '\n'));
  await modal(page).getByRole('button', { name: 'CSV 미리보기', exact: true }).click(); await expect(modal(page).getByRole('button', { name: 'CSV 미리보기', exact: true })).toBeEnabled();
  await page.route('**/api/v1/earned', route => route.request().postDataJSON()?.action === 'import' ? route.fulfill({ status: 503, json: { error: 'CSV 저장 일시 중단' } }) : route.continue());
  await modal(page).getByRole('button', { name: '검토한 URL 저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await page.unroute('**/api/v1/earned'); await submit(page, '검토한 URL 저장'); expect((await f.data()).rows).toHaveLength(17);
  await root(page).getByLabel('채널 필터').selectOption('뉴스'); await root(page).getByLabel('등록 URL 검색').fill('=1+1'); await expect(root(page)).toContainText('1개 표시 / 전체 17개');
  const downloading = page.waitForEvent('download'); await root(page).getByRole('button', { name: '현재 목록 CSV', exact: true }).click(); const download = await downloading; expect(download.suggestedFilename()).toBe('registered-urls.csv'); const bytes = await readFile((await download.path())!, 'utf8'); expect(bytes).toContain("'=1+1"); expect(bytes).toContain('https://media.example.invalid/0'); expect(bytes).not.toContain('동시 등록');
});
test('save failure and stale edits retain input; workspaces, viewer and analysis permissions stay isolated on mobile', async ({ page }) => {
  const f = await fixture(page); await add(page); await root(page).getByRole('button', { name: 'URL 수정', exact: true }).click(); await modal(page).getByLabel('URL 메모').fill('유지할 메모');
  await page.route('**/api/v1/earned', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: '저장 중단' } }) : route.continue()); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('저장 중단'); await page.unroute('**/api/v1/earned');
  const row = (await f.data()).rows[0]; expect((await f.post({ action: 'update', id: row.id, expected_revision: row.revision, url: `https://media.example.invalid/${'long'.repeat(70)}`, title: '' })).status()).toBe(200);
  await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('변경'); await expect(modal(page).getByLabel('URL 메모')).toHaveValue('유지할 메모'); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: '등록 URL 없는 공간' } }), [other] = await response.json(); await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, other); await expect(root(page)).toContainText('아직 등록된 URL이 없습니다.');
  const hash = await hashPassword(password), guest = await f.store.write(db => { const user = db.createAccount({ email: `earned-viewer-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '조회 회원', passwordHash: hash }); db.insertTable('workspace_members', { workspace_id: f.workspace.id, user_id: user.id, role: 'viewer', allowed_sections: ['other', 'analysis'] }, String(f.owner.id)); return user; });
  expect((await page.request.post('/api/v1/auth', { data: { email: guest.email, password } })).status()).toBe(200); await page.evaluate(ws => localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })), f.workspace); await page.reload();
  await root(page).getByLabel('관측 필터').selectOption('yes'); await expect(root(page)).toContainText('조건에 맞는 URL이 없습니다.');
  await f.store.write(db => db.updateTable('workspace_members', { allowed_sections: ['other'] }, { workspace_id: `eq.${f.workspace.id}`, user_id: `eq.${guest.id}` }, String(f.owner.id)));
  await root(page).getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(root(page).getByLabel('관측 필터')).toBeDisabled(); await expect(root(page).getByLabel('관측 필터')).toHaveValue('all'); await expect(root(page)).toContainText('1개 표시 / 전체 1개');
  await expect(root(page)).toContainText('분석 메뉴 권한이 필요'); await expect(root(page).getByRole('button', { name: 'URL 수정', exact: true })).toHaveCount(0); expect((await f.post({ action: 'delete', id: row.id, expected_revision: 2 })).status()).toBe(403);
  expect((await page.request.get(`/api/v1/earned?workspace_id=${other.id}`)).status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 600 }); await page.reload(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390); await page.mouse.move(285, 480); await page.mouse.wheel(0, 650); await expect.poll(() => root(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});
