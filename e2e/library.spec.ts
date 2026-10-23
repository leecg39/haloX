import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => { expect((await page.request.post('/api/v1/auth', { data: { email: 'admin@halox.local', password: process.env.HALOX_DEMO_PASSWORD } })).status()).toBe(200); });
const live = (page: Page) => page.locator('[data-live-root]');
const dialog = (page: Page) => page.getByRole('dialog');
async function save(page: Page, name = '저장') { await dialog(page).getByRole('button', { name, exact: true }).click(); await expect(dialog(page)).not.toBeVisible(); }
async function workspace(page: Page, route: string) {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `자료 검증 ${Date.now()}` } }); expect(response.status()).toBe(201);
  const [item] = await response.json(); await page.goto(route); await expect(live(page).getByRole('button', { name: '새로고침', exact: true })).toBeEnabled();
  await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${item.name} (trial)` }).click(); await expect(live(page)).toContainText(item.name);
  return item;
}

test('personas, examples and generation use persistent records and deletion preserves historical content', async ({ page }) => {
  const ws = await workspace(page, '/app/personas');
  try {
    await expect(live(page)).toContainText('등록된 페르소나가 없습니다');
    await live(page).getByRole('button', { name: '페르소나 추가', exact: true }).click();
    await dialog(page).getByLabel('이름', { exact: true }).fill('개발자 안내 문체');
    await dialog(page).getByLabel('대상 독자').fill('개발자'); await dialog(page).getByLabel('문체 지침').fill('수치와 짧은 문장'); await dialog(page).getByLabel('금지어', { exact: true }).fill('최고\n혁신적'); await dialog(page).getByLabel('기본 페르소나').check(); await save(page);
    await live(page).getByRole('link', { name: '개발자 안내 문체', exact: true }).click();
    const id = page.url().split('/').at(-1)!;
    await live(page).getByRole('button', { name: '예문 추가', exact: true }).click(); await dialog(page).getByLabel('제목', { exact: true }).fill('첫 번째 예문'); await dialog(page).getByLabel('예문 본문').fill('근거를 먼저 설명합니다.'); await save(page);
    const sample = live(page).locator('article').filter({ hasText: '첫 번째 예문' }); await sample.getByRole('button', { name: '편집', exact: true }).click(); await dialog(page).getByLabel('예문 본문').fill('검증된 근거부터 설명합니다.'); await save(page);
    await page.reload(); await expect(live(page)).toContainText('검증된 근거부터 설명합니다.');
    await live(page).getByRole('button', { name: '이 페르소나로 초안 생성' }).click(); await dialog(page).getByLabel('주제', { exact: true }).fill('독자 맞춤 작성'); await save(page, '초안 생성');
    const summary = live(page).locator('details summary'); await summary.click(); await expect(live(page).locator('details pre')).toContainText('수치와 짧은 문장');
    const snapshot = await (await page.request.get(`/api/v1/library?workspace_id=${ws.id}`)).json(); const job = snapshot.content_jobs[0]; expect(job.generation_context.persona.samples[0].content).toBe('검증된 근거부터 설명합니다.');
    await sample.getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제'); await expect(live(page)).toContainText('등록된 예문이 없습니다');
    await live(page).locator('.live-library-detail').getByRole('button', { name: '편집', exact: true }).click(); await dialog(page).getByLabel('이름', { exact: true }).fill('수정된 문체'); await save(page); await expect(live(page).getByRole('heading', { name: /수정된 문체/ })).toBeVisible();
    await live(page).locator('.live-library-detail').getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제'); await expect(page).toHaveURL(/\/app\/personas$/);
    const after = await (await page.request.get(`/api/v1/library?workspace_id=${ws.id}`)).json(); expect(after.writing_style_samples).toEqual([]); expect(after.content_jobs[0].writing_style_profile_id).toBeNull(); expect(after.content_jobs[0].generation_context.persona.name).toBe('개발자 안내 문체');
    await page.goto(`/app/personas/${id}`); await expect(live(page)).toContainText('페르소나를 찾을 수 없습니다');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('knowledge body, sources, file bytes, notes and keyword links survive reload and cascade on deletion', async ({ page }) => {
  const ws = await workspace(page, '/app/knowledgehub');
  try {
    await live(page).getByRole('button', { name: '자료 추가', exact: true }).click(); await dialog(page).getByLabel('이름', { exact: true }).fill('제품 근거 자료'); await dialog(page).getByLabel('본문', { exact: true }).fill('우리 제품은 저장된 근거를 사용합니다.'); await dialog(page).getByLabel('자료 유형', { exact: true }).selectOption('product'); await save(page);
    await live(page).getByRole('link', { name: '제품 근거 자료', exact: true }).click(); const entityId = page.url().split('/').at(-1)!;
    await live(page).getByRole('button', { name: '출처 추가', exact: true }).click(); await dialog(page).getByLabel('제목', { exact: true }).fill('공식 문서'); await dialog(page).getByLabel('출처 유형').selectOption('url'); await dialog(page).getByLabel('출처 URL').fill('https://example.com/docs'); await dialog(page).getByLabel('본문 / 요약').fill('사용자가 확인한 내용'); await save(page);
    await live(page).getByRole('button', { name: '근거 메모 추가', exact: true }).click(); await dialog(page).getByLabel('제목', { exact: true }).fill('검증 메모'); await dialog(page).getByLabel('연결 출처').selectOption({ label: '공식 문서' }); await dialog(page).getByLabel('본문 / 요약').fill('공식 문서에서 인용한 근거'); await save(page);
    await live(page).getByRole('button', { name: '파일 업로드', exact: true }).click(); const bytes = Buffer.from('원본 파일의 정확한 바이트\n보존 확인'); await dialog(page).getByLabel('파일', { exact: true }).setInputFiles({ name: 'reference.md', mimeType: 'text/markdown', buffer: bytes }); await save(page, '업로드');
    const download = page.waitForEvent('download'); await live(page).getByRole('link', { name: '원본 다운로드: reference.md' }).click(); const file = await download; expect(file.suggestedFilename()).toBe('reference.md'); expect(await readFile((await file.path())!)).toEqual(bytes);
    const sourceData = await (await page.request.get(`/api/v1/library?workspace_id=${ws.id}`)).json(); const sourceId = sourceData.knowledge_entity_sources.find((row: { source_type: string }) => row.source_type === 'file').id; expect(JSON.stringify(sourceData)).not.toContain(bytes.toString('base64'));
    const keywordResponse = await page.request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: ws.id, keywords: ['자료 연결 키워드'] } }); expect(keywordResponse.ok()).toBe(true); await page.reload();
    await live(page).getByRole('button', { name: '키워드 연결', exact: true }).click(); await dialog(page).getByLabel('키워드', { exact: true }).selectOption({ label: '자료 연결 키워드' }); await save(page);
    await live(page).getByRole('button', { name: '이 자료로 초안 생성' }).click(); await dialog(page).getByLabel('주제', { exact: true }).fill('제품 설명'); await save(page, '초안 생성'); await live(page).locator('details summary').click(); await expect(live(page).locator('details pre')).toContainText('원본 파일의 정확한 바이트');
    await page.reload(); await expect(live(page).getByRole('link', { name: '자료 연결 키워드', exact: true })).toBeVisible(); await expect(live(page)).toContainText('검증 메모');
    await live(page).locator('.live-library-detail').getByRole('button', { name: '편집', exact: true }).click(); await dialog(page).getByLabel('본문', { exact: true }).fill('편집한 자료 본문'); await save(page); await expect(live(page).locator('.live-library-detail')).toContainText('편집한 자료 본문');
    const note = live(page).locator('article').filter({ has: page.getByRole('heading', { name: '검증 메모', exact: true }) }); await note.getByRole('button', { name: '편집', exact: true }).click(); await dialog(page).getByLabel('본문 / 요약').fill('수정한 메모'); await save(page); await expect(note).toContainText('수정한 메모');
    const source = live(page).locator('article').filter({ has: page.getByRole('heading', { name: '공식 문서 URL', exact: true }) }); await source.getByRole('button', { name: '편집', exact: true }).click(); await dialog(page).getByLabel('본문 / 요약').fill('갱신한 출처 요약'); await save(page); await expect(source).toContainText('갱신한 출처 요약');
    await live(page).locator('article').filter({ has: page.getByRole('heading', { name: '공식 문서 URL', exact: true }) }).getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제'); await expect(live(page)).toContainText('출처: 연결 없음');
    await live(page).locator('.live-library-detail').getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제'); await expect(page).toHaveURL(/\/app\/knowledgehub$/);
    expect((await page.request.get(`/api/v1/library/files/${sourceId}`)).status()).toBe(404);
    const after = await (await page.request.get(`/api/v1/library?workspace_id=${ws.id}`)).json(); for (const table of ['knowledge_entities', 'knowledge_entity_sources', 'evidence_contexts', 'keyword_knowledge_entities']) expect(after[table]).toEqual([]);
    expect(after.content_jobs[0].generation_context.knowledge[0].body).toBe('우리 제품은 저장된 근거를 사용합니다.');
    await page.goto(`/app/knowledgehub/${entityId}`); await expect(live(page)).toContainText('자료를 찾을 수 없습니다');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('failed library writes preserve input, reject invalid files and isolate workspace data on mobile', async ({ page }) => {
  const ws = await workspace(page, '/app/knowledgehub');
  try {
    await live(page).getByRole('button', { name: '자료 추가', exact: true }).click(); await dialog(page).getByLabel('이름', { exact: true }).fill('실패 후 재시도');
    await page.route('**/api/v1/rest/knowledge_entities', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '저장소 일시 중단' }) }));
    await dialog(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('저장소 일시 중단'); await expect(dialog(page).getByLabel('이름', { exact: true })).toHaveValue('실패 후 재시도');
    await page.unroute('**/api/v1/rest/knowledge_entities'); await save(page); await live(page).getByRole('link', { name: '실패 후 재시도', exact: true }).click(); const id = page.url().split('/').at(-1)!;
    expect((await page.request.post('/api/v1/library/files', { multipart: { workspace_id: ws.id, knowledge_entity_id: id, file: { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not pdf') } } })).status()).toBe(400);
    expect((await page.request.get('/api/v1/library?workspace_id=22222222-2222-4000-8000-222222222222')).status()).toBe(403);
    expect((await page.request.post('/api/v1/rest/evidence_contexts', { data: { workspace_id: ws.id, knowledge_entity_id: '61000000-0000-4000-8000-000000000001', title: '교차 참조', content: '내용' } })).status()).toBe(400);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/app/knowledgehub'); await live(page).getByLabel('자료 검색').fill('없는 자료'); await expect(live(page)).toContainText('검색 결과가 없습니다');
    await page.reload(); await expect(live(page).getByRole('link', { name: '실패 후 재시도', exact: true })).toBeVisible();
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
