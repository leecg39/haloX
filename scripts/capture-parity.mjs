// P8 패리티 캡처 — 클론(localhost) 라우트 스크린샷·HTML 수집
// 실행: node scripts/capture-parity.mjs [--port 3000] [--out docs/design-references/clone/routes-20261025]
// 자격 증명은 playwright.config.ts와 동일하게 @next/env로 .env.local을 내부 로드한다(셸 환경변수 미사용).
// 원본 캡처(docs/design-references/haloxlabs.ai/routes-20261025)와 동일한 뷰포트 1920x939를 사용한다.

import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { chromium, request } from '@playwright/test';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PORT = Number(arg('port', '3000'));
const OUT = path.resolve(arg('out', 'docs/design-references/clone/routes-20261025'));
const BASE = `http://localhost:${PORT}`;
const EMAIL = 'demo@halox.local';
const PASSWORD = process.env.HALOX_DEMO_PASSWORD;
if (!PASSWORD) throw new Error('HALOX_DEMO_PASSWORD is not set (create .env.local from .env.example)');

// 원본 캡처와 동일한 라우트 집합(드리프트 화면 우선)
const routes = [
  ['app-geo-analysis', '/app/geo/analysis', []],
  ['app-geo-analysis-tab-matrix', '/app/geo/analysis', [['tab', 'matrix']]],
  ['app-geo-analysis-tab-fan-out', '/app/geo/analysis', [['tab', 'fan-out']]],
  ['app-geo-analysis-tab-products', '/app/geo/analysis', [['tab', 'products']]],
  ['app-geo-analysis-tab-sources', '/app/geo/analysis', [['tab', 'sources']]],
  ['app-geo-analysis-tab-mentions', '/app/geo/analysis', [['tab', 'mentions']]],
  ['app-geo-analysis-tab-platforms', '/app/geo/analysis', [['tab', 'platforms']]],
  ['app-geo-analysis-tab-prompts', '/app/geo/analysis', [['tab', 'prompts']]],
  ['app-geo-analysis-tab-competitors', '/app/geo/analysis', [['tab', 'competitors']]],
  ['app-geo', '/app/geo', []],
  ['app-monitoring', '/app/monitoring', []],
  ['app-seo-insights', '/app/seo/insights', []],
  ['app', '/app', []],
  ['app-keywords', '/app/keywords', []],
  ['app-geo-prompts', '/app/geo/prompts', []],
  ['app-gap', '/app/gap', []],
  ['app-strategy-map', '/app/strategy-map', []],
  ['app-site-audit', '/app/site-audit', []],
  ['app-factory', '/app/factory', []],
  ['app-optimize', '/app/optimize', []],
  ['app-exports', '/app/exports', []],
  ['app-reports', '/app/reports', []],
  ['app-reports-weekly', '/app/reports/weekly', []],
  ['app-personas', '/app/personas', []],
  ['app-knowledgehub', '/app/knowledgehub', []],
  ['app-raw-data', '/app/raw-data', []],
  ['app-settings', '/app/settings', []],
];

await fs.mkdir(OUT, { recursive: true });

// 1) 로그인 — 저장소 자체 E2E 패턴과 동일한 API 사용
const loginCtx = await request.newContext({ baseURL: BASE });
const login = await loginCtx.post('/api/v1/auth', { data: { email: EMAIL, password: PASSWORD } });
if (login.status() !== 200) throw new Error(`login failed: HTTP ${login.status()} ${await login.text()}`);
const state = await loginCtx.storageState();
await loginCtx.dispose();
console.log(`login OK (${EMAIL}) cookies: ${state.cookies.length}`);

// 2) 캡처 — 1920x939, 로그인 세션 재사용
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 939 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  storageState: { cookies: state.cookies, origins: [] },
});
const page = await context.newPage();

const summary = [];
for (const [slug, pathname, query] of routes) {
  const url = BASE + pathname + (query.length ? '?' + query.map(([k, v]) => `${k}=${v}`).join('&') : '');
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1600);
    const finalUrl = page.url();
    await page.screenshot({ path: path.join(OUT, `${slug}.png`) });
    const html = await page.content();
    await fs.writeFile(path.join(OUT, `${slug}.html`), html);
    const redirected = finalUrl.replace(BASE, '') !== (pathname + (query.length ? '?' + query.map(([k, v]) => `${k}=${v}`).join('&') : '')) ? ` REDIRECT->${finalUrl}` : '';
    summary.push(`OK ${slug} (${(html.length / 1024).toFixed(0)}KB)${redirected}`);
  } catch (err) {
    summary.push(`FAIL ${slug} ${String(err).slice(0, 120)}`);
  }
}
// 로그인 화면(비인증 상태) — 세션 쿠키 없이 별도 컨텍스트
const anonCtx = await browser.newContext({ viewport: { width: 1920, height: 939 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const anonPage = await anonCtx.newPage();
try {
  await anonPage.goto(`${BASE}/app/login`, { waitUntil: 'load', timeout: 20000 });
  await anonPage.waitForTimeout(1200);
  await anonPage.screenshot({ path: path.join(OUT, 'app-login.png') });
  await fs.writeFile(path.join(OUT, 'app-login.html'), await anonPage.content());
  summary.push('OK app-login (anonymous)');
} catch (err) {
  summary.push(`FAIL app-login ${String(err).slice(0, 120)}`);
}
await anonCtx.close();
await context.close();
await browser.close();
console.log(summary.join('\n'));
const fails = summary.filter((s) => s.startsWith('FAIL')).length;
console.log(`done: ${summary.length - fails}/${summary.length} captured -> ${OUT}`);
