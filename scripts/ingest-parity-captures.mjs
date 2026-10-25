// P8 원본 1:1 — 2026-10-25 Ego 세션 재캡처 HTML을 캡처 스토어에 반영한다.
// 실행: node scripts/ingest-parity-captures.mjs [--dry-run]
// 원본: docs/design-references/haloxlabs.ai/routes-20261025/*.html (1920x939 세션, 읽기 전용 이동)
// 대상: public/clone/pages/<hash>.json + public/clone/manifest.json
// 규칙: 기존 캡처 파일은 유지하고 새 파일을 만들어 manifest가 가리키게 한다.
//       tabs(탭 내비게이션)는 기존 캡처의 label->route 맵을 라벨(개수 접미사 제외) 매칭으로 재사용한다.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const SRC = 'docs/design-references/haloxlabs.ai/routes-20261025';
const CLONE_DIR = 'public/clone';
const DRY = process.argv.includes('--dry-run');

// slug -> manifest route (query 포함). app-login은 로그인 리다이렉트가 캡처되어 제외.
const ROUTES = [
  ['app-geo-analysis', '/app/geo/analysis'],
  ['app-geo-analysis-tab-matrix', '/app/geo/analysis?tab=matrix'],
  ['app-geo-analysis-tab-fan-out', '/app/geo/analysis?tab=fan-out'],
  ['app-geo-analysis-tab-products', '/app/geo/analysis?tab=products'],
  ['app-geo-analysis-tab-sources', '/app/geo/analysis?tab=sources'],
  ['app-geo-analysis-tab-mentions', '/app/geo/analysis?tab=mentions'],
  ['app-geo-analysis-tab-platforms', '/app/geo/analysis?tab=platforms'],
  ['app-geo-analysis-tab-prompts', '/app/geo/analysis?tab=prompts'],
  ['app-geo-analysis-tab-competitors', '/app/geo/analysis?tab=competitors'],
  ['app-geo', '/app/geo'],
  ['app-monitoring', '/app/monitoring'],
  ['app-seo-insights', '/app/seo/insights'],
  ['app', '/app'],
  ['app-keywords', '/app/keywords'],
  ['app-geo-prompts', '/app/geo/prompts'],
  ['app-gap', '/app/gap'],
  ['app-strategy-map', '/app/strategy-map'],
  ['app-site-audit', '/app/site-audit'],
  ['app-factory', '/app/factory'],
  ['app-optimize', '/app/optimize'],
  ['app-exports', '/app/exports'],
  ['app-reports', '/app/reports'],
  ['app-reports-weekly', '/app/reports/weekly'],
  ['app-personas', '/app/personas'],
  ['app-knowledgehub', '/app/knowledgehub'],
  ['app-raw-data', '/app/raw-data'],
  ['app-settings', '/app/settings'],
];

const stripCount = (label) => label.replace(/\s*\([^)]*\)\s*$/, '').trim();

const manifest = JSON.parse(await fs.readFile(path.join(CLONE_DIR, 'manifest.json'), 'utf8'));
const oldCapture = new Map();
for (const entry of manifest) {
  try {
    const capture = JSON.parse(await fs.readFile(path.join(CLONE_DIR, 'pages', entry.file), 'utf8'));
    if (capture.tabs?.length) oldCapture.set(entry.route, capture.tabs);
  } catch { /* 손상 항목은 건너뛴다 */ }
}

function buildTabs(route, tabLabels) {
  const oldTabs = oldCapture.get(route.split('?')[0]) || [];
  if (!tabLabels.length) return [];
  const byBase = new Map(oldTabs.map((t) => [stripCount(t.label), t.route]));
  return tabLabels
    .map((label) => ({ label, route: byBase.get(stripCount(label)) || '' }))
    .filter((t) => t.route);
}

function extractControls($) {
  const controls = [];
  let n = 0;
  const push = (tag, el) => {
    const node = $(el);
    const text = (node.text() || '').replace(/\s+/g, ' ').trim();
    controls.push({
      id: 'c' + n++,
      tag,
      text: text || null,
      label: node.attr('aria-label') || null,
      role: node.attr('role') || null,
      href: node.attr('href') || null,
      placeholder: node.attr('placeholder') || null,
      state: node.attr('aria-expanded') ? (node.attr('aria-expanded') === 'true' ? 'open' : 'closed') : null,
      controls: node.attr('aria-controls') || null,
    });
  };
  $('button, a[href], input, select, textarea, [role=combobox], [role=menuitem]').each((_, el) => {
    push((el.tagName || '').toUpperCase(), el);
  });
  return controls;
}

// geo-analysis 기본 탭 캡처에서 공용 탭 막대를 뽑아 모든 변형에 재사용한다.
let geoTabs = null;

const updates = [];
for (const [slug, route] of ROUTES) {
  const file = path.join(SRC, slug + '.html');
  const html = await fs.readFile(file, 'utf8');
  const $ = cheerio.load(html);
  const tabLabels = $('[role=tab]').map((_, el) => ($(el).text() || '').replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  let tabs;
  if (route.startsWith('/app/geo/analysis')) {
    if (!geoTabs) geoTabs = buildTabs('/app/geo/analysis', tabLabels);
    tabs = geoTabs;
  } else {
    tabs = buildTabs(route, tabLabels);
  }
  const capture = {
    route,
    url: 'https://haloxlabs.ai' + route,
    title: $('title').text() || 'HaloX',
    html: $('body').html() || '',
    bodyClass: $('body').attr('class') || '',
    htmlClass: $('html').attr('class') || '',
    text: ($('body').text() || '').replace(/\s+/g, ' ').trim(),
    controls: extractControls($),
    tabs,
  };
  const name = crypto.createHash('sha256').update('p8-20261025:' + route).digest('hex').slice(0, 16) + '.json';
  updates.push({ route, name, capture });
}

if (DRY) {
  for (const u of updates) {
    console.log(u.route, '->', u.name, '| tabs:', u.capture.tabs.length, '| text:', u.capture.text.length, '| html:', u.capture.html.length);
  }
  console.log('dry run: ' + updates.length + ' captures prepared, nothing written');
} else {
  for (const u of updates) await fs.writeFile(path.join(CLONE_DIR, 'pages', u.name), JSON.stringify(u.capture));
  for (const u of updates) {
    const entry = manifest.find((e) => e.route === u.route);
    if (!entry) throw new Error('manifest missing route: ' + u.route);
    entry.file = u.name;
    entry.title = u.capture.title;
    entry.textLength = u.capture.text.length;
    entry.status = 'captured';
  }
  await fs.writeFile(path.join(CLONE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('ingested ' + updates.length + ' captures; manifest updated');
  for (const u of updates) console.log(u.route, '->', u.name, '| tabs:', u.capture.tabs.length);
}
