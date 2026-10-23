import { expect, test, type Page } from '@playwright/test';
import { loginIsolatedAccount } from './isolated-account';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { runWordPressCommand } from '../src/lib/backend/wordpress-service';
import { ExternalServiceError } from '../src/lib/backend/public-json';
import { DEFAULT_USER_ID, type Row } from '../src/lib/backend/database';

test.use({ storageState: { cookies: [], origins: [] } });
const live = (page: Page) => page.locator('[data-live-root]'), dialog = (page: Page) => page.getByRole('dialog');
async function submit(page: Page, name = '저장') { await dialog(page).getByRole('button', { name, exact: true }).click(); await expect(dialog(page)).not.toBeVisible(); }
async function setup(page: Page) {
  const actor = await loginIsolatedAccount(page, 'wordpress');
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `WordPress 검증 ${Date.now()}` } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  const content = await page.request.post('/api/v1/functions/content-create', { data: { workspace_id: ws.id, title: '게시할 문서', target_keyword: '제품 안내', content_md: '## 안내\n검토한 내용을 WordPress에 전송합니다.' } }); expect(content.status()).toBe(200);
  await page.goto('/app/settings?tab=export'); await expect(live(page).getByRole('button', { name: '파일 만들기', exact: true })).toBeEnabled();
  await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name);
  await live(page).getByRole('button', { name: 'WordPress 연결', exact: true }).click(); return { ws, actor, ...(await content.json()) };
}
async function connect(page: Page) {
  await live(page).getByRole('button', { name: 'WordPress 연결 추가', exact: true }).click(); await dialog(page).getByLabel('연결 이름').fill('검토 블로그'); await dialog(page).getByLabel('사이트 주소').fill('https://blog.example.invalid/'); await dialog(page).getByLabel('WordPress 사용자 이름').fill('editor'); await dialog(page).getByLabel('애플리케이션 비밀번호').fill('abcd efgh ijkl mnop qrst uvwx'); await submit(page);
}

test('WordPress settings, private credentials, permission verification, explicit preview and publication history persist', async ({ page }) => {
  const { ws, actor } = await setup(page); const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!); const sent: Row[] = [];
  // Only the remote WordPress client is a fixture; service transactions and all
  // settings/history/read endpoints use the production logic and isolated DB.
  const client = { verify: async () => ({ remote_user_id: 7, can_publish: true }), publish: async (_credentials: unknown, body: Row) => { sent.push(body); return { id: 18, status: 'draft', url: 'https://blog.example.invalid/?p=18' }; }, find: async () => null };
  await page.route(/\/api\/v1\/functions\/wordpress-(verify|publish)$/, async route => {
    const name = route.request().url().split('/').at(-1)!;
    const result = await runWordPressCommand(store, name, route.request().postDataJSON(), actor, client);
    await route.fulfill({ status: result.ok === false ? 502 : 200, json: result });
  });
  try {
    await connect(page); await page.reload(); await live(page).getByRole('button', { name: 'WordPress 연결', exact: true }).click(); await expect(live(page)).toContainText('비밀번호 저장됨');
    const response = await page.request.get(`/api/v1/exports?workspace_id=${ws.id}`); const data = await response.json(); const target = data.export_destinations[0]; expect(JSON.stringify(data)).not.toContain('abcdefghijkl'); expect(JSON.stringify(data)).not.toContain('ciphertext');
    await live(page).getByRole('button', { name: '연결 수정', exact: true }).click(); await expect(dialog(page).getByLabel('애플리케이션 비밀번호')).toHaveValue(''); await dialog(page).getByLabel('연결 이름').fill('수정한 블로그'); await submit(page);
    await live(page).getByRole('button', { name: '연결 확인', exact: true }).click(); await expect(live(page)).toContainText('연결 확인 완료');
    await live(page).getByRole('button', { name: '게시 이력', exact: true }).click(); await live(page).getByRole('button', { name: '외부 게시', exact: true }).click();
    await dialog(page).getByLabel('게시 사이트').selectOption({ label: '수정한 블로그' }); await dialog(page).getByLabel('게시 콘텐츠').selectOption({ label: '게시할 문서' }); await expect(dialog(page)).toContainText('검토한 내용을 WordPress에 전송합니다.'); await dialog(page).getByRole('checkbox').check(); await submit(page, 'WordPress에 초안 저장');
    expect(sent).toHaveLength(1); expect(sent[0].content_md).toContain('WordPress에 전송'); await expect(live(page)).toContainText('전송 확인'); await expect(live(page)).toContainText('원격 상태: draft');
    await live(page).getByRole('button', { name: '게시 메모 수정', exact: true }).click(); await dialog(page).getByLabel('메모').fill('게시 담당자 확인'); await submit(page); await page.reload(); await live(page).getByRole('button', { name: '게시 이력', exact: true }).click(); await expect(live(page)).toContainText('게시 담당자 확인');
    await live(page).getByRole('button', { name: 'WordPress 연결', exact: true }).click(); await live(page).getByRole('button', { name: '연결 삭제', exact: true }).click(); await submit(page, '삭제'); expect((await store.read(db => db.getServerRecords('export_credentials'))).some(row => row.destination_id === target.id)).toBe(false);
    await live(page).getByRole('button', { name: '게시 이력', exact: true }).click(); await expect(live(page)).toContainText('수정한 블로그'); await live(page).getByRole('button', { name: '이력 삭제', exact: true }).click(); await submit(page, '삭제'); await expect(live(page)).toContainText('외부 게시 이력이 없습니다'); expect(sent).toHaveLength(1);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('failed connection and ambiguous delivery remain visible; remote reconciliation never reposts and members cannot manage connections', async ({ page }) => {
  const { ws, job, actor } = await setup(page); const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!); let failVerify = true, posts = 0;
  const client = { verify: async () => { if (failVerify) throw new ExternalServiceError('연결 인증 실패', 'WORDPRESS_REJECTED', 502, false); return { remote_user_id: 7, can_publish: true }; }, publish: async () => { posts++; throw new ExternalServiceError('게시 응답 시간 초과'); }, find: async () => ({ id: 19, status: 'draft', url: 'https://blog.example.invalid/?p=19' }) };
  await page.route(/\/api\/v1\/functions\/wordpress-(verify|publish|reconcile)$/, async route => {
    try { const result = await runWordPressCommand(store, route.request().url().split('/').at(-1)!, route.request().postDataJSON(), actor, client); await route.fulfill({ status: result.ok === false ? 502 : 200, json: result }); }
    catch (error) { await route.fulfill({ status: 502, json: { error: (error as Error).message } }); }
  });
  try {
    await connect(page); await live(page).getByRole('button', { name: '연결 확인', exact: true }).click(); await expect(live(page)).toContainText('연결 확인 실패'); await page.reload(); await live(page).getByRole('button', { name: 'WordPress 연결', exact: true }).click(); await expect(live(page)).toContainText('연결 인증 실패');
    failVerify = false; await live(page).getByRole('button', { name: '연결 확인', exact: true }).click(); await expect(live(page)).toContainText('연결 확인 완료');
    const data = await (await page.request.get(`/api/v1/exports?workspace_id=${ws.id}`)).json(), target = data.export_destinations[0];
    expect((await page.request.post('/api/v1/functions/wordpress-publish', { data: { workspace_id: ws.id, destination_id: target.id, expected_destination_revision: target.revision, job_id: job.id, expected_content_revision: job.revision, status: 'draft', idempotency_key: 'missing-confirmation' } })).status()).toBe(400);
    await live(page).getByRole('button', { name: '게시 이력', exact: true }).click(); await live(page).getByRole('button', { name: '외부 게시', exact: true }).click(); await dialog(page).getByLabel('게시 사이트').selectOption({ label: '검토 블로그' }); await dialog(page).getByLabel('게시 콘텐츠').selectOption({ label: '게시할 문서' }); await dialog(page).getByRole('checkbox').check(); await dialog(page).getByRole('button', { name: 'WordPress에 초안 저장', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('게시 응답 시간 초과'); await dialog(page).getByRole('button', { name: '취소', exact: true }).click(); await expect(live(page)).toContainText('결과 확인 필요');
    await live(page).getByRole('button', { name: '원격 상태 확인', exact: true }).click(); await expect(live(page)).toContainText('전송 확인'); expect(posts).toBe(1);
    expect((await page.request.post('/api/v1/rest/workspace_members', { data: { workspace_id: ws.id, user_id: DEFAULT_USER_ID, role: 'member' } })).status()).toBe(201);
    const outsider = await page.context().browser()!.newContext(); try { await outsider.request.post('/api/v1/auth', { data: { email: 'demo@halox.local', password: process.env.HALOX_DEMO_PASSWORD } }); expect((await outsider.request.post('/api/v1/functions/wordpress-delete', { data: { workspace_id: ws.id, destination_id: target.id, expected_revision: target.revision } })).status()).toBe(403); } finally { await outsider.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
