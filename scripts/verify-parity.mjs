// P8 패리티 비교 — REA compareScreenshots 엔진 호출
// 실행: node scripts/verify-parity.mjs
// 원본: docs/design-references/haloxlabs.ai/routes-20261025 (Ego 세션, 1920x939)
// 클론: docs/design-references/clone/routes-20261025 (시드 데모 계정, 1920x939)
// 픽셀 비교는 REA 웹스크린샷 비교 엔진(자체 검증 PNG 아티팩트), 텍스트/DOM 비교는 파생 지표(DER).

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

async function loadRea() {
  const globalRoot = execSync('npm root -g').toString().trim();
  const dist = path.join(globalRoot, 'rea-agents', 'dist');
  const provider = await import('file://' + path.join(dist, 'browser', 'CdpBrowserProvider.js'));
  const service = await import('file://' + path.join(dist, 'application', 'BrowserObservationService.js'));
  return { CdpBrowserProvider: provider.CdpBrowserProvider, compareWebScreenshotEvidence: service.compareWebScreenshotEvidence };
}

const ORIG = 'docs/design-references/haloxlabs.ai/routes-20261025';
const CLONE = 'docs/design-references/clone/routes-20261025';
const EVIDENCE_DIR = 'docs/rea/evidence/p8-compare';
const MATRIX_JSON = 'docs/clone/parity-matrix.json';
const MATRIX_MD = 'docs/clone/parity-matrix.md';
const CHANNEL_THRESHOLD = 8;

const routes = [
  'app-geo-analysis', 'app-geo-analysis-tab-matrix', 'app-geo-analysis-tab-fan-out',
  'app-geo-analysis-tab-products', 'app-geo-analysis-tab-sources', 'app-geo-analysis-tab-mentions',
  'app-geo-analysis-tab-platforms', 'app-geo-analysis-tab-prompts', 'app-geo-analysis-tab-competitors',
  'app-geo', 'app-monitoring', 'app-seo-insights', 'app', 'app-keywords', 'app-geo-prompts',
  'app-gap', 'app-strategy-map', 'app-site-audit', 'app-factory', 'app-optimize', 'app-exports',
  'app-reports', 'app-reports-weekly', 'app-personas', 'app-knowledgehub', 'app-raw-data',
  'app-settings', 'app-login',
];

async function artifact(pngPath) {
  const data = await fs.readFile(pngPath);
  return {
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    bytes: data.byteLength,
    media_type: 'image/png',
    data_base64: data.toString('base64'),
  };
}

function normalizeText(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/g, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return body.split(/\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
}

function domProfile(html) {
  const counts = {};
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b/gi)) {
    const tag = m[1].toLowerCase();
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  return inter / (setA.size + setB.size - inter);
}

function grade(row) {
  if (row.pixel_status === 'dimension_mismatch') return '치수불일치';
  if (row.text_similarity >= 0.9 && row.changed_ratio <= 0.02) return '일치';
  if (row.text_similarity >= 0.75 && row.changed_ratio <= 0.08) return '사소';
  if (row.text_similarity >= 0.5 && row.changed_ratio <= 0.2) return '중간';
  return '주요';
}

const { CdpBrowserProvider, compareWebScreenshotEvidence } = await loadRea();
await fs.mkdir(EVIDENCE_DIR, { recursive: true });

const rows = [];
for (const slug of routes) {
  const origPng = path.join(ORIG, slug + '.png');
  const clonePng = path.join(CLONE, slug + '.png');
  const origHtmlPath = path.join(ORIG, slug + '.html');
  const cloneHtmlPath = path.join(CLONE, slug + '.html');
  try {
    const before = await artifact(origPng);
    const after = await artifact(clonePng);
    const ev = await compareWebScreenshotEvidence(new CdpBrowserProvider(), {
      before,
      after,
      channel_threshold: CHANNEL_THRESHOLD,
    });
    if (!ev.ok) throw new Error('compare failed: ' + JSON.stringify(ev.error).slice(0, 200));
    const evidence = ev.value;
    const diff = evidence.normalized_result;
    await fs.writeFile(
      path.join(EVIDENCE_DIR, slug + '.json'),
      JSON.stringify(evidence),
    );
    const origHtml = await fs.readFile(origHtmlPath, 'utf8');
    const cloneHtml = await fs.readFile(cloneHtmlPath, 'utf8');
    const row = {
      slug,
      pixel_status: diff.status,
      changed_ratio: diff.changed_ratio,
      changed_pixels: diff.changed_pixels,
      compared_pixels: diff.compared_pixels,
      mean_abs_channel_delta: diff.mean_absolute_channel_delta,
      text_similarity: Number(jaccard(normalizeText(origHtml), normalizeText(cloneHtml)).toFixed(4)),
      dom_similarity: Number(jaccard(Object.entries(domProfile(origHtml)).flat(), Object.entries(domProfile(cloneHtml)).flat()).toFixed(4)),
      evidence_id: evidence.evidence_id,
      evidence_file: EVIDENCE_DIR + '/' + slug + '.json',
    };
    row.grade = grade(row);
    rows.push(row);
    console.log(slug, row.grade, 'pixel=' + (row.changed_ratio ?? 'n/a'), 'text=' + row.text_similarity, 'dom=' + row.dom_similarity);
  } catch (err) {
    rows.push({ slug, error: String(err).slice(0, 200) });
    console.log(slug, 'ERROR', String(err).slice(0, 120));
  }
}

const summary = {
  generated_at: new Date().toISOString(),
  original_source: 'Ego Lite session, https://haloxlabs.ai, 1920x939, deployment psr2.534e5cd0 (2026-10-25)',
  clone_source: 'localhost:3000, seed demo@halox.local workspace, 1920x939, REA-free Playwright capture',
  pixel_engine: 'rea compare_web_screenshots (channel_threshold=' + CHANNEL_THRESHOLD + ')',
  rows,
};
await fs.writeFile(MATRIX_JSON, JSON.stringify(summary, null, 1));

const order = ['일치', '사소', '중간', '주요', '치수불일치'];
const table = rows
  .slice()
  .sort((a, b) => order.indexOf(a.grade ?? '주요') - order.indexOf(b.grade ?? '주요'))
  .map((r) =>
    '| ' + r.slug + ' | ' + (r.grade ?? '-') + ' | ' +
    (r.changed_ratio !== undefined ? (r.changed_ratio * 100).toFixed(2) + '%' : '-') + ' | ' +
    (r.text_similarity !== undefined ? (r.text_similarity * 100).toFixed(1) + '%' : '-') + ' | ' +
    (r.dom_similarity !== undefined ? (r.dom_similarity * 100).toFixed(1) + '%' : '-') + ' |'
  );
const counts = {};
for (const r of rows) counts[r.grade ?? '오류'] = (counts[r.grade ?? '오류'] || 0) + 1;

const md = [
  '# P8 패리티 매트릭스 — 원본(haloxlabs.ai) vs 클론(localhost:3000), 2026-10-25',
  '',
  '뷰포트 1920x939. 픽셀 비교는 REA compare_web_screenshots(채널 임계값 ' + CHANNEL_THRESHOLD + '), 텍스트/DOM 유사도는 파생 지표(DER).',
  '원본은 사용자 Trial 워크스페이스, 클론은 시드 데모 워크스페이스이므로 데이터 영역 차이는 등급에 일부 반영된다.',
  '',
  '## 요약',
  '',
  ...Object.entries(counts).map(([g, n]) => '- ' + g + ': ' + n + '개 라우트'),
  '',
  '## 라우트별 상세',
  '',
  '| 라우트 | 등급 | 픽셀 변화 | 텍스트 유사 | DOM 유사 |',
  '|---|---|---|---|---|',
  ...table,
  '',
  '개별 REA Evidence: docs/rea/evidence/p8-compare/(로컬 보관, git 제외). 기계 판독: parity-matrix.json.',
].join('\n');
await fs.writeFile(MATRIX_MD, md);
console.log('summary:', JSON.stringify(counts));
console.log('wrote ' + MATRIX_JSON + ' and ' + MATRIX_MD);
