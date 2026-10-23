import { loginIsolatedAccount } from './isolated-account';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
test.use({ storageState: { cookies: [], origins: [] } });
const live = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
const endpoint = (workspace: string, kind = 'seo', params: Record<string, string> = {}) => `/api/v1/raw-data?${new URLSearchParams({ workspace_id: workspace, kind, ...params })}`;
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
async function invoke(page: Page, name: string, workspace: string, values: Record<string, unknown>) { const response = await page.request.post(`/api/v1/functions/${name}`, { data: { ...values, workspace_id: workspace } }); expect(response.status(), await response.text()).toBe(200); return response.json(); }
async function rows(page: Page, workspace: string, table: string) { return (await page.request.get(`/api/v1/rest/${table}?workspace_id=eq.${workspace}`)).json(); }
async function setup(page: Page) {
  await loginIsolatedAccount(page, 'raw');
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `원본 검증 ${Date.now()}`, default_brand_filter: 'brizzi.kr' } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  await page.goto('/app/raw-data'); await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name); await expect(live(page).getByRole('button', { name: 'JSON 가져오기', exact: true })).toBeEnabled(); return ws;
}
async function seoFile(page: Page, workspace: string) {
  await invoke(page, 'keywords-collect', workspace, { keywords: ['원본 검색 검증'] }); const [kw] = await rows(page, workspace, 'keywords');
  return '\uFEFF' + JSON.stringify({ schema_version: 1, kind: 'seo', source: { provider: 'e2e-source', url: 'https://source.example/export' }, records: [{ source_id: 'seo-1', keyword_id: kw.id, keyword_text: kw.keyword, language: kw.language, country: kw.country, engine: 'google', captured_at: new Date().toISOString(), search_volume: 777, keyword_difficulty: 42, top_results: [{ url: 'https://brizzi.kr/evidence', rank: 2, title: '수입 원본 😀' }], ai_overview_detected: false }] }, null, 2) + '\n';
}
async function upload(page: Page, contents: string, title = '원본 가져오기 검증') {
  await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await live(page).getByRole('button', { name: 'JSON 가져오기', exact: true }).click(); await modal(page).getByLabel('가져오기 이름').fill(title); await modal(page).getByLabel('원본 JSON 파일').setInputFiles({ name: '원본.json', mimeType: 'application/json', buffer: Buffer.from(contents) }); await expect(modal(page)).toContainText('bytes');
}

test('raw SEO imports exact bytes, edits metadata, filters/details/downloads actual ZIP, then deletes only imported measurements', async ({ page }) => {
  const ws = await setup(page);
  try {
    const contents = await seoFile(page, ws.id); const beforeImport = await (await page.request.get(`/api/v1/analyses?workspace_id=${ws.id}&kind=seo`)).json(); await upload(page, contents);
    const templateEvent = page.waitForEvent('download'); await modal(page).getByRole('button', { name: 'JSON 양식 다운로드' }).click(); const template = JSON.parse(await readFile((await (await templateEvent).path())!, 'utf8')); expect(template.kind).toBe('seo');
    // Validate the downloadable template independently of upload contents.
    const templated = await page.request.get(endpoint(ws.id, 'seo', { mode: 'template', entity_id: (await rows(page, ws.id, 'keywords'))[0].id })); expect((await templated.json()).source.provider).toBe('replace-with-source-name');
    await save(page, '가져오기'); await expect(live(page)).toContainText('1 / 1개 측정값 보관'); expect((await (await page.request.get(`/api/v1/analyses?workspace_id=${ws.id}&kind=seo`)).json()).summary.average_rank).toBe(2);
    const sourceEvent = page.waitForEvent('download'); await live(page).getByRole('button', { name: '가져온 JSON 다운로드' }).click(); const source = await sourceEvent; expect(source.suggestedFilename()).toBe('원본.json'); expect(await readFile((await source.path())!, 'utf8')).toBe(contents);
    await live(page).getByRole('button', { name: '가져오기 편집' }).click(); await modal(page).getByLabel('가져오기 이름').fill('수정된 출처 이름'); await modal(page).getByLabel('가져오기 메모').fill('원본 확인 완료'); await save(page); await page.reload(); await live(page).getByRole('button', { name: '가져오기 내역', exact: true }).click(); await expect(live(page)).toContainText('원본 확인 완료');
    const [batch] = await rows(page, ws.id, 'raw_import_batches'); expect((await page.request.post('/api/v1/functions/raw-import-update', { data: { workspace_id: ws.id, batch_id: batch.id, expected_revision: 1, title: 'stale' } })).status()).toBe(409); expect((await page.request.patch(`/api/v1/rest/raw_import_batches?id=eq.${batch.id}`, { data: { title: 'bypass' } })).status()).toBe(403);
    await live(page).getByRole('button', { name: '원본 목록에서 보기' }).click(); await expect(live(page).getByRole('heading', { name: '다운로드 대상 1개' })).toBeVisible(); await live(page).getByRole('button', { name: '원본 상세', exact: true }).click(); await modal(page).getByText('serp_results · 1개', { exact: true }).click(); await expect(modal(page)).toContainText('수입 원본 😀');
    const detailEvent = page.waitForEvent('download'); await modal(page).getByRole('button', { name: '상세 JSON 다운로드' }).click(); const detail = JSON.parse(await readFile((await (await detailEvent).path())!, 'utf8')); expect(detail.tables.serp_results[0].rank).toBe(2); await modal(page).getByRole('button', { name: '닫기' }).click();
    const zipEvent = page.waitForEvent('download'); await live(page).getByRole('button', { name: 'ZIP 다운로드' }).click(); const zipPath = (await (await zipEvent).path())!; expect(execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' })).toContain('No errors'); expect(execFileSync('unzip', ['-p', zipPath, 'serp_results.csv'], { encoding: 'utf8' })).toContain('수입 원본');
    const outsiders = await page.context().browser()!.newContext({ storageState: path.join(__dirname, '.auth', 'state.json') }); try { for (const params of ([{},{ mode: 'source', batch_id: batch.id }, { mode: 'download' }] as Record<string, string>[])) expect((await outsiders.request.get(endpoint(ws.id, 'seo', params))).status()).toBe(403); } finally { await outsiders.close(); }
    await live(page).getByLabel('원본 검색').fill('없는 원본'); await live(page).getByRole('button', { name: '필터 적용' }).click(); await expect(live(page)).toContainText('현재 조건에 맞는 원본 자료가 없습니다'); await expect(live(page).getByRole('button', { name: 'ZIP 다운로드' })).toBeDisabled();
    await live(page).getByRole('button', { name: '가져오기 내역', exact: true }).click(); await live(page).getByRole('button', { name: '가져오기 삭제' }).click(); await save(page, '삭제'); expect((await rows(page, ws.id, 'serp_snapshots')).filter((row: any) => row.import_batch_id)).toHaveLength(0); expect(await rows(page, ws.id, 'serp_snapshots')).toHaveLength(1); expect(await rows(page, ws.id, 'keywords')).toHaveLength(1); expect((await (await page.request.get(`/api/v1/analyses?workspace_id=${ws.id}&kind=seo`)).json()).summary).toEqual(beforeImport.summary);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('GEO raw import preserves answer/citation evidence and batch deletion leaves the collected run', async ({ page }) => {
  const ws = await setup(page);
  try {
    await invoke(page, 'geo-run', ws.id, { prompt_text: '원본 답변 검증', engines: ['openai'] }); const [prompt] = await rows(page, ws.id, 'geo_prompts'); await live(page).getByRole('button', { name: '프롬프트 Raw' }).click();
    const contents = JSON.stringify({ schema_version: 1, kind: 'geo', source: { provider: 'e2e-geo' }, records: [{ source_id: 'geo-1', prompt_id: prompt.id, prompt_text: prompt.prompt_text, language_code: prompt.language_code, location_code: prompt.location_code, engine: 'openai', finished_at: new Date().toISOString(), brand_domain: 'brizzi.kr', answer_text: '검증할 실제 원문 😀\n두 번째 줄', metrics: { brand_mentioned: true, is_cited: true }, citations: [{ url: 'https://brizzi.kr/source', position: 1, is_ours: true, is_competitor: false }] }] }); await upload(page, contents); await save(page, '가져오기'); await live(page).getByRole('button', { name: '원본 목록에서 보기' }).click(); await expect(live(page).getByRole('heading', { name: '다운로드 대상 1개' })).toBeVisible(); await live(page).getByRole('button', { name: '원본 상세' }).click(); await modal(page).getByText('geo_answers_raw · 1개', { exact: true }).click(); await expect(modal(page)).toContainText('검증할 실제 원문 😀'); await modal(page).getByText('geo_citations · 1개', { exact: true }).click(); await expect(modal(page)).toContainText('https://brizzi.kr/source'); await modal(page).getByRole('button', { name: '닫기' }).click();
    await live(page).getByRole('button', { name: '가져오기 내역', exact: true }).click(); await live(page).getByRole('button', { name: '가져오기 삭제' }).click(); await save(page, '삭제'); expect(await rows(page, ws.id, 'geo_prompt_runs')).toHaveLength(1); expect((await rows(page, ws.id, 'geo_citations')).some((row: any) => row.import_batch_id)).toBe(false);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('imported audit exposes score/source/issues and unmeasured details, without starting a crawl', async ({ page }) => {
  const ws = await setup(page);
  try {
    const { target } = await invoke(page, 'audit-target-create', ws.id, { name: '가져오기 진단', target_url: 'https://brizzi.kr/', max_pages: 5, max_depth: 1, scope_rules: { include_paths: [], exclude_paths: [] }, notes: '' }); await live(page).getByRole('button', { name: '사이트 진단 Raw' }).click();
    const contents = JSON.stringify({ schema_version: 1, kind: 'audit', source: { provider: 'e2e-audit' }, records: [{ source_id: 'audit-1', target_id: target.id, completed_at: new Date().toISOString(), pages: [{ url: target.target_url, status_code: 200, title: '가져온 페이지', html_score: 81, issues: [{ code: 'title-short', severity: 'notice', title: '제목 확인', description: '원본에서 발견한 제목 항목', fix_recommendation: '내용을 확인하세요.' }] }] }] }); await upload(page, contents); await save(page, '가져오기'); const [scan] = await rows(page, ws.id, 'site_audit_scans');
    await page.goto(`/app/site-audit/${scan.id}`); await expect(live(page)).toContainText('가져온 자료 · import:e2e-audit'); await expect(live(page).getByText('HTML 점검 점수', { exact: false })).toContainText('81'); await expect(live(page)).toContainText('원본에서 발견한 제목 항목'); await live(page).getByRole('button', { name: '수집 페이지 (1)' }).click(); await live(page).getByText('페이지 상세', { exact: true }).click(); await expect(live(page)).toContainText('이미지 미측정 / alt 누락 미측정');
    await page.goto('/app/raw-data'); await live(page).getByRole('button', { name: '사이트 진단 Raw' }).click(); await live(page).getByRole('button', { name: '가져오기 내역', exact: true }).click(); await live(page).getByRole('button', { name: '가져오기 삭제' }).click(); await save(page, '삭제'); for (const table of ['site_audit_scans', 'site_audit_pages', 'site_audit_issues']) expect(await rows(page, ws.id, table)).toHaveLength(0); expect(await rows(page, ws.id, 'site_audit_targets')).toHaveLength(1);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('raw upload/download failures preserve input, recover, and mobile filters and import history scroll', async ({ page }) => {
  const ws = await setup(page);
  try {
    const contents = await seoFile(page, ws.id); await upload(page, contents); await page.route('**/api/v1/functions/raw-import-create', route => route.fulfill({ status: 503, json: { error: '가져오기 일시 중단' } })); await modal(page).getByRole('button', { name: '가져오기', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await expect(modal(page).getByLabel('가져오기 이름')).toHaveValue('원본 가져오기 검증'); await expect(modal(page)).toContainText('원본.json'); await page.unroute('**/api/v1/functions/raw-import-create');
    await modal(page).getByLabel('원본 JSON 파일').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') }); await expect(modal(page)).toContainText('invalid.json · 1 bytes'); await modal(page).getByRole('button', { name: '가져오기', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('JSON 파일 구문'); await expect(modal(page).getByLabel('가져오기 이름')).toHaveValue('원본 가져오기 검증'); await modal(page).getByLabel('원본 JSON 파일').setInputFiles({ name: '원본.json', mimeType: 'application/json', buffer: Buffer.from(contents) }); await expect(modal(page)).toContainText('원본.json ·'); await save(page, '가져오기');
    await live(page).getByRole('button', { name: '원본 목록에서 보기' }).click(); await page.route('**/api/v1/raw-data?**', route => new URL(route.request().url()).searchParams.get('mode') === 'download' ? route.fulfill({ status: 503, json: { error: '다운로드 일시 중단' } }) : route.continue()); await live(page).getByRole('button', { name: 'ZIP 다운로드' }).click(); await expect(live(page).getByRole('alert')).toContainText('다운로드 일시 중단'); expect(new URL(page.url()).pathname).toBe('/app/raw-data'); await page.unroute('**/api/v1/raw-data?**');
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.mouse.move(195, 400); await page.mouse.wheel(0, 950); await expect.poll(() => live(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0); await live(page).getByRole('button', { name: '가져오기 내역', exact: true }).click(); await live(page).getByRole('button', { name: '가져오기 편집' }).click(); await modal(page).getByLabel('가져오기 메모').fill('모바일 수정'); await save(page); await expect(live(page)).toContainText('모바일 수정');
    await live(page).getByRole('button', { name: '모니터링 Raw' }).click(); await expect(live(page)).toContainText('GSC·GA4는 연동 설정에서 Google 계정을 연결한 뒤 동기화할 수 있습니다'); await expect(live(page).getByRole('button', { name: 'JSON 가져오기', exact: true })).toBeDisabled();
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
