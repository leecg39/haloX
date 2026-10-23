import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: path.join(__dirname, '.auth', 'export-state.json') });
const live = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
async function setup(page: Page, collect = true) {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `전략맵 검증 ${Date.now()}` } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  if (collect) expect((await page.request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: ws.id, keywords: ['SEO 시작', 'SEO 비교', '콘텐츠 설계'] } })).status()).toBe(200);
  await page.goto('/app/strategy-map'); await expect(live(page).getByRole('button', { name: '클러스터 추가', exact: true })).toBeEnabled(); await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name); return ws;
}
async function add(page: Page, name: string, keywords: string[] = []) {
  await live(page).getByRole('button', { name: '클러스터 추가', exact: true }).click(); await modal(page).getByLabel('클러스터 이름', { exact: true }).fill(name); for (const keyword of keywords) await modal(page).getByRole('checkbox', { name: keyword, exact: true }).check(); await save(page);
}
const data = async (page: Page, ws: string) => (await page.request.get(`/api/v1/strategy-map?workspace_id=${ws}`)).json();

test('manual strategy groups, membership, graph relationships and snapshot notes persist and cascade on delete', async ({ page }) => {
  const ws = await setup(page);
  try {
    await add(page, '검색 전략', ['SEO 시작']); await live(page).getByRole('link', { name: '검색 전략', exact: true }).click();
    await live(page).getByRole('button', { name: '클러스터 편집', exact: true }).click(); await modal(page).getByLabel('클러스터 이름').fill('검색 핵심'); await modal(page).getByLabel('우선순위', { exact: true }).selectOption('high'); await modal(page).getByLabel('클러스터 메모').fill('핵심 콘텐츠 묶음'); await save(page);
    await live(page).getByRole('button', { name: '키워드 구성 편집', exact: true }).click(); await modal(page).getByLabel('구성 키워드 검색').fill('비교'); await modal(page).getByRole('checkbox', { name: 'SEO 비교', exact: true }).check(); await save(page); await page.reload(); await expect(live(page)).toContainText('핵심 콘텐츠 묶음'); await expect(live(page).getByRole('link', { name: 'SEO 시작', exact: true })).toBeVisible(); await expect(live(page).getByRole('link', { name: 'SEO 비교', exact: true })).toBeVisible();
    const first = (await data(page, ws.id)).keyword_clusters[0]; expect(first.stats.keyword_count).toBe(2);
    await live(page).getByRole('button', { name: '집계 스냅샷 저장', exact: true }).click(); await save(page, '스냅샷 저장');
    const snapshot = live(page).locator('details.live-card').first(); await snapshot.locator('summary').click(); await snapshot.getByRole('button', { name: '이력 메모 수정' }).click(); await modal(page).getByLabel('이력 메모').fill('집계 검토 완료'); await save(page); await expect(live(page)).toContainText('집계 검토 완료');
    const download = page.waitForEvent('download'); await snapshot.getByRole('button', { name: '스냅샷 CSV' }).click(); expect((await download).suggestedFilename()).toBe('strategy-history.csv');
    await page.goto('/app/strategy-map'); await add(page, '콘텐츠 전략', ['콘텐츠 설계']); await live(page).getByRole('button', { name: '네트워크', exact: true }).click(); await live(page).getByRole('button', { name: '관계 추가', exact: true }).click();
    await modal(page).getByLabel('시작 클러스터').selectOption({ label: '검색 핵심' }); await modal(page).getByLabel('대상 클러스터').selectOption({ label: '콘텐츠 전략' }); await modal(page).getByLabel('관계 유형').selectOption('supports'); await modal(page).getByLabel('관계 메모').fill('콘텐츠 지원 경로'); await save(page); await expect(live(page).locator('.strategy-edge.manual')).toHaveCount(1);
    await live(page).getByRole('button', { name: '관계 편집', exact: true }).click(); await modal(page).getByLabel('관계 메모').fill('검토한 지원 경로'); await save(page); await page.reload(); await live(page).getByRole('button', { name: '네트워크', exact: true }).click(); await expect(live(page)).toContainText('검토한 지원 경로');
    await live(page).getByRole('button', { name: '포트폴리오', exact: true }).click(); await expect(live(page).locator('.strategy-point')).toHaveCount(2); await live(page).getByRole('button', { name: '맵 확대', exact: true }).click(); await expect(live(page).getByRole('button', { name: '맵 왼쪽 이동' })).toBeVisible(); await live(page).getByRole('button', { name: '확대 초기화', exact: true }).click();
    await live(page).getByRole('link', { name: '검색 핵심 상세 보기', exact: true }).click(); await live(page).getByRole('button', { name: '클러스터 삭제', exact: true }).click(); await save(page, '삭제'); await expect(page).toHaveURL(/\/app\/strategy-map$/);
    const after = await data(page, ws.id); expect(after.keywords).toHaveLength(3); expect(after.keyword_cluster_links).toHaveLength(0); expect(after.keyword_clusters).toHaveLength(1); expect(after.cluster_stats_history.filter((row: { cluster_id: string }) => row.cluster_id === first.id)).toHaveLength(0);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('automatic grouping previews reject stale sources, preserve manual groups and retain reviewed run history', async ({ page }) => {
  const ws = await setup(page);
  try {
    await add(page, '수동 기준', ['SEO 시작']); await live(page).getByRole('button', { name: '자동 분류 미리보기' }).click(); await expect(modal(page)).toContainText('키워드 3개 → 자동 그룹 2개'); await modal(page).getByRole('checkbox').check();
    expect((await page.request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: ws.id, keywords: ['추가 관찰'] } })).status()).toBe(200);
    await modal(page).getByRole('button', { name: '분류 적용', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('전략맵 또는 원본 자료가 변경'); await expect(modal(page).getByRole('checkbox')).toBeChecked();
    await modal(page).getByRole('button', { name: '미리보기 갱신' }).click(); await expect(modal(page)).toContainText('키워드 4개 → 자동 그룹 3개'); await expect(modal(page).getByRole('checkbox')).not.toBeChecked(); await modal(page).getByRole('checkbox').check(); await save(page, '분류 적용');
    const first = await data(page, ws.id); expect(first.keyword_clusters).toHaveLength(4); expect(first.keyword_clusters.find((row: { label: string }) => row.label === '수동 기준')).toBeTruthy();
    await page.reload(); await live(page).getByRole('button', { name: '실행 이력', exact: true }).click(); await live(page).locator('details.live-card summary').first().click(); await live(page).getByRole('button', { name: '이력 메모 수정', exact: true }).click(); await modal(page).getByLabel('이력 메모').fill('첫 분류 확인'); await save(page); await expect(live(page)).toContainText('첫 분류 확인');
    await live(page).getByRole('button', { name: '자동 분류 미리보기' }).click(); await expect(modal(page)).toContainText('새 그룹 0개 · 갱신 3개 · 삭제 0개'); await modal(page).getByRole('checkbox').check(); await save(page, '분류 적용');
    const second = await data(page, ws.id); expect(second.keyword_clusters.map((row: { id: string }) => row.id).sort()).toEqual(first.keyword_clusters.map((row: { id: string }) => row.id).sort()); expect(second.cluster_batch_runs).toHaveLength(2);
    await live(page).locator('details.live-card summary').first().click(); await live(page).getByRole('button', { name: '이력 삭제', exact: true }).first().click(); await save(page, '삭제'); expect((await data(page, ws.id)).cluster_batch_runs).toHaveLength(1);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('strategy save failures preserve input; filters, pagination, empty charts, keyboard and tenant boundaries work on mobile', async ({ page }) => {
  const ws = await setup(page, false);
  try {
    await page.route('**/api/v1/functions/cluster-create', route => route.fulfill({ status: 503, json: { error: '전략 저장 일시 중단' } }));
    await live(page).getByRole('button', { name: '클러스터 추가', exact: true }).click(); await modal(page).getByLabel('클러스터 이름').fill('유지할 입력'); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('전략 저장 일시 중단'); await expect(modal(page).getByLabel('클러스터 이름')).toHaveValue('유지할 입력'); await page.keyboard.press('Escape'); await expect(modal(page)).not.toBeVisible(); await page.unroute('**/api/v1/functions/cluster-create');
    for (let i = 0; i < 12; i++) expect((await page.request.post('/api/v1/functions/cluster-create', { data: { workspace_id: ws.id, label: `검증 그룹 ${i}`, priority: i === 0 ? 'high' : 'normal', keyword_ids: [] } })).status()).toBe(200);
    await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await expect(live(page)).toContainText('1 / 2'); await live(page).getByRole('button', { name: '다음', exact: true }).click(); await expect(live(page)).toContainText('2 / 2'); await live(page).getByLabel('우선순위 필터').selectOption('high'); await expect(live(page).getByRole('link', { name: '검증 그룹 0', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 }); await live(page).getByRole('button', { name: '포트폴리오', exact: true }).click(); await expect(live(page)).toContainText('검색량과 난이도 값이 있는 클러스터가 없습니다.'); await live(page).getByRole('button', { name: '네트워크', exact: true }).click(); await expect(live(page).locator('.strategy-point')).toHaveCount(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const result = await data(page, ws.id), cluster = result.keyword_clusters[0]; expect((await page.request.patch(`/api/v1/rest/keyword_clusters?id=eq.${cluster.id}`, { data: { stats_json: { keyword_count: 999 } } })).status()).toBe(403);
    expect(await live(page).evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    await page.mouse.move(195, 420); await page.mouse.wheel(0, 1200); await expect.poll(() => live(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const outsider = await page.context().browser()!.newContext({ storageState: path.join(__dirname, '.auth', 'state.json') }); try { expect((await outsider.request.get(`/api/v1/strategy-map?workspace_id=${ws.id}`)).status()).toBe(403); } finally { await outsider.close(); }
    expect((await page.request.post('/api/v1/functions/cluster-delete', { data: { workspace_id: ws.id, cluster_id: cluster.id, expected_revision: 0 } })).status()).toBe(409);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
