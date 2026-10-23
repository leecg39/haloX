import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { type Row } from '../src/lib/backend/database';
test.use({ storageState: path.join(__dirname, '.auth', 'export-state.json') });
const live = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
async function setup(page: Page, route = '/app') {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `관측 검증 ${Date.now()}`, default_brand_filter: 'brizzi.kr' } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  await page.goto(route); await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name); await expect(live(page).getByRole('button', { name: '새로고침', exact: true })).toBeEnabled(); return ws;
}
async function invoke(page: Page, name: string, workspace: string, values: Record<string, unknown>) { const response = await page.request.post(`/api/v1/functions/${name}`, { data: { ...values, workspace_id: workspace } }); expect(response.status(), await response.text()).toBe(200); return response.json(); }

test('dashboard persists personal period/panels, resets and recalculates after keyword collection/deletion', async ({ page }) => {
  const ws = await setup(page);
  try {
    await expect(live(page)).toContainText('키워드 0개'); await expect(live(page).getByRole('link', { name: /검색 가시성/ })).toContainText('미측정');
    await live(page).getByRole('button', { name: '대시보드 설정', exact: true }).click(); await modal(page).getByLabel('조회 기간').selectOption('7'); await modal(page).getByLabel('표본 정렬').selectOption('recent'); await modal(page).getByLabel('AI 질문 현황', { exact: true }).uncheck(); await modal(page).getByRole('button', { name: '검색 현황 위로', exact: true }).click(); await save(page); await page.reload();
    await expect(live(page).getByRole('heading', { name: 'AI 질문 현황' })).toHaveCount(0); await live(page).getByRole('button', { name: '대시보드 설정', exact: true }).click(); await expect(modal(page).getByLabel('조회 기간')).toHaveValue('7'); await modal(page).getByRole('button', { name: '취소' }).click();
    await invoke(page, 'keywords-collect', ws.id, { keywords: ['대시보드 측정 검증'] }); await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await expect(live(page)).toContainText('키워드 1개'); await expect(live(page).getByRole('link', { name: '대시보드 측정 검증', exact: true })).toBeVisible();
    const [kw] = await (await page.request.get(`/api/v1/rest/keywords?workspace_id=eq.${ws.id}`)).json(); expect((await page.request.delete(`/api/v1/rest/keywords?id=eq.${kw.id}&workspace_id=eq.${ws.id}`)).status()).toBe(200); await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await expect(live(page)).toContainText('키워드 0개');
    await live(page).getByRole('button', { name: '설정 초기화', exact: true }).click(); await save(page, '초기화'); await expect(live(page).getByRole('heading', { name: 'AI 질문 현황' })).toBeVisible();
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('monitoring worker evaluates a saved rule, supports acknowledgment, disables/resolves and cascades deletion', async ({ page }) => {
  const ws = await setup(page, '/app/monitoring');
  try {
    await invoke(page, 'keywords-collect', ws.id, { keywords: ['감시 측정 검증'] }); await live(page).getByRole('button', { name: '감시 규칙 추가' }).click(); await modal(page).getByLabel('규칙 이름').fill('Top10 감시'); await modal(page).getByLabel('비교 조건').selectOption('gte'); await modal(page).getByLabel('임계값').fill('0'); await save(page);
    await expect.poll(async () => { const data = await (await page.request.get(`/api/v1/observability?workspace_id=${ws.id}&kind=monitoring`)).json(); return data.alerts.length; }).toBe(1);
    await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await expect(live(page)).toContainText('조건 충족'); await live(page).getByRole('button', { name: '발생 알림', exact: true }).click(); await live(page).getByRole('button', { name: '확인·메모' }).click(); await modal(page).getByLabel('알림 확인함').check(); await modal(page).getByLabel('알림 메모').fill('원인 검토 완료'); await save(page); await page.reload(); await live(page).getByRole('button', { name: '발생 알림', exact: true }).click(); await expect(live(page)).toContainText('원인 검토 완료');
    await live(page).getByRole('button', { name: '감시 규칙', exact: true }).click(); await live(page).getByRole('button', { name: '규칙 편집' }).click(); await modal(page).getByLabel('감시 켜짐').uncheck(); await save(page); await expect(live(page)).toContainText('감시 꺼짐');
    await live(page).getByRole('button', { name: '발생 알림', exact: true }).click(); await expect(live(page)).toContainText('규칙 변경'); await live(page).getByRole('button', { name: '알림 삭제' }).click(); await save(page, '삭제');
    await live(page).getByRole('button', { name: '감시 규칙', exact: true }).click(); await live(page).getByRole('button', { name: '규칙 삭제' }).click(); await save(page, '삭제'); await live(page).getByRole('button', { name: '이벤트 이력' }).click(); await expect(live(page)).toContainText('평가 이벤트가 없습니다');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('reports create/edit summaries and actions, export frozen evidence, persist reload and delete', async ({ page }) => {
  const ws = await setup(page, '/app/reports/weekly');
  try {
    await invoke(page, 'keywords-collect', ws.id, { keywords: ['리포트 측정 검증'] }); await live(page).getByRole('button', { name: '리포트 생성', exact: true }).click(); await modal(page).getByLabel('리포트 제목').fill('월간 실측 보고서'); await modal(page).getByLabel('리포트 주기').selectOption('month'); await save(page, '생성'); await expect(live(page).getByRole('heading', { name: '리포트 상세' })).toBeVisible();
    await live(page).getByRole('button', { name: '리포트 편집' }).click(); await modal(page).getByLabel('리포트 메모').fill('검토 기록'); await save(page);
    await live(page).getByRole('button', { name: '요약 편집' }).click(); await modal(page).getByLabel('요약 내용').fill('저장 근거 검토 완료'); await save(page);
    await live(page).getByRole('button', { name: '액션 추가' }).click(); await modal(page).getByLabel('액션 제목').fill('인용 근거 확인'); await modal(page).getByLabel('우선순위').selectOption('high'); await save(page); await live(page).getByRole('button', { name: '액션 편집' }).click(); await modal(page).getByLabel('액션 상태').selectOption('done'); await modal(page).getByLabel('액션 메모').fill('검토 마침'); await save(page); await page.reload(); await expect(live(page)).toContainText('저장 근거 검토 완료'); await expect(live(page)).toContainText('검토 마침');
    const download = page.waitForEvent('download'); await live(page).getByRole('link', { name: 'JSON 다운로드' }).click(); expect((await download).suggestedFilename()).toMatch(/^report-.*\.json$/);
    const reportId = new URL(page.url()).pathname.split('/').at(-1), response = await page.request.get(`/api/v1/reports/${reportId}/download?format=json`); const body = await response.json(); expect(body.report.snapshot.counts.keywords).toBe(1); expect(body.actions[0].status).toBe('done');
    await live(page).getByRole('button', { name: '액션 삭제' }).click(); await save(page, '삭제'); await live(page).getByRole('button', { name: '요약 삭제' }).click(); await save(page, '삭제'); await live(page).getByRole('button', { name: '요약 작성' }).click(); await modal(page).getByLabel('요약 내용').fill('새 요약'); await save(page);
    await live(page).getByRole('button', { name: '리포트 삭제', exact: true }).click(); await save(page, '삭제'); await expect(live(page)).toContainText('리포트가 없습니다'); expect((await page.request.get(`/api/v1/reports/${reportId}/download`)).status()).toBe(404);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('automatic reports execute in the actual server worker and settings reset without deleting reports', async ({ page }) => {
  const ws = await setup(page, '/app/reports');
  try {
    await live(page).getByRole('button', { name: '자동 리포트 설정' }).click(); await modal(page).getByLabel('자동 생성 켜짐').check(); await save(page); await expect(live(page)).toContainText('자동 생성 켜짐');
    const fixtureStore = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!);
    await fixtureStore.write(db => { const member = db.exportState().tables.workspace_members.find((row: Row) => row.workspace_id === ws.id && row.role === 'owner'); db.updateTable('report_preferences', { next_run_at: new Date(Date.now() - 1000).toISOString() }, { workspace_id: `eq.${ws.id}` }, String(member!.user_id)); });
    await expect.poll(async () => (await (await page.request.get(`/api/v1/rest/report_snapshots?workspace_id=eq.${ws.id}`)).json()).length).toBe(1);
    await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await expect(live(page)).toContainText('자동 생성'); await expect(live(page)).toContainText('종료된 기간'); await live(page).getByRole('button', { name: '자동 설정 초기화' }).click(); await save(page, '삭제'); await expect(live(page).getByRole('button', { name: '자동 설정 초기화' })).toHaveCount(0); await expect(live(page).getByRole('link', { name: '상세 보기 →' })).toHaveCount(1);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('failed writes retain inputs, revision/REST/tenant guards hold, and mobile content scrolls', async ({ page }) => {
  const ws = await setup(page, '/app/monitoring');
  try {
    await page.route('**/api/v1/functions/monitor-rule-create', route => route.fulfill({ status: 503, json: { error: '감시 저장 일시 중단' } })); await live(page).getByRole('button', { name: '감시 규칙 추가' }).click(); await modal(page).getByLabel('규칙 이름').fill('입력 보존 검증'); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await expect(modal(page).getByLabel('규칙 이름')).toHaveValue('입력 보존 검증'); await page.unroute('**/api/v1/functions/monitor-rule-create'); await save(page);
    const data = await (await page.request.get(`/api/v1/observability?workspace_id=${ws.id}&kind=monitoring`)).json(), rule = data.rules[0]; expect((await page.request.post('/api/v1/functions/monitor-rule-delete', { data: { workspace_id: ws.id, rule_id: rule.id, expected_revision: 0 } })).status()).toBe(409); expect((await page.request.patch(`/api/v1/rest/monitor_rules?id=eq.${rule.id}`, { data: { threshold: 999 } })).status()).toBe(403);
    const outsider = await page.context().browser()!.newContext({ storageState: path.join(__dirname, '.auth', 'state.json') }); try { expect((await outsider.request.get(`/api/v1/observability?workspace_id=${ws.id}&kind=monitoring`)).status()).toBe(403); } finally { await outsider.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.mouse.move(195, 400); await page.mouse.wheel(0, 900); await expect.poll(() => live(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await live(page).getByRole('button', { name: '규칙 편집' }).click(); await modal(page).getByLabel('규칙 메모').fill('모바일 저장'); await save(page); await expect(live(page)).toContainText('모바일 저장');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
