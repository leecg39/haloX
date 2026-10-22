import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function parsePngMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw new Error('Invalid PNG buffer: too short');
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature');
  }
  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new Error(`Expected IHDR chunk, got ${chunkType}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { width, height, bitDepth, colorType, bytes: buffer.length, sha256 };
}

export function verifyCssTokens(cssText, expectedTokens) {
  const missingTokens = [];
  const mismatchedTokens = [];
  for (const [token, expectedValue] of Object.entries(expectedTokens)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}\\s*:\\s*([^;!}]+)`, 'i');
    const match = cssText.match(regex);
    if (!match) {
      missingTokens.push(token);
      continue;
    }
    const actualValue = match[1].trim();
    const norm = v => v.replace(/\s+/g, ' ').replace(/^0\./, '.').trim();
    if (norm(actualValue) !== norm(expectedValue)) {
      mismatchedTokens.push({ token, expected: expectedValue, actual: actualValue });
    }
  }
  return {
    totalExpected: Object.keys(expectedTokens).length,
    missingTokens,
    mismatchedTokens,
    passed: missingTokens.length === 0 && mismatchedTokens.length === 0,
  };
}

export function extractLayoutSignature(route, pageData) {
  const $ = cheerio.load(pageData.html || '', {}, false);
  const isApp = route.startsWith('/app');
  const classes = new Set();
  $('[class]').each((_, el) => {
    for (const cls of ($(el).attr('class') || '').split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  });
  const classList = [...classes];
  const hasResponsiveBreakpoints = classList.some(c => /^(sm:|md:|lg:|xl:)/.test(c));
  return {
    route,
    kind: isApp ? 'app' : 'public',
    title: pageData.title || '',
    hasMain: $('main,[role="main"]').length > 0,
    hasHeaderOrNav: $('header,nav,aside,[data-sidebar]').length > 0,
    tableCount: $('table').length,
    buttonCount: $('button,[role="button"]').length,
    inputCount: $('input,textarea,select').length,
    headingCount: $('h1,h2,h3').length,
    hasResponsiveBreakpoints,
    publicAccordions: pageData.publicInteractions?.accordions?.length ?? 0,
    publicTabs: pageData.publicInteractions?.tabs?.length ?? 0,
    publicMenus: pageData.publicInteractions?.menus?.length ?? 0,
  };
}

export function runVisualRegressionSelfTest() {
  // Positive token check
  const okTokens = verifyCssTokens(':root { --background: 0 0% 100%; --radius: .5rem; }', {
    '--background': '0 0% 100%',
    '--radius': '0.5rem',
  });
  assert.equal(okTokens.passed, true);

  // Negative token check (missing & mismatch)
  const badTokens = verifyCssTokens(':root { --background: 0 0% 0%; }', {
    '--background': '0 0% 100%',
    '--missing': '10px',
  });
  assert.equal(badTokens.passed, false);
  assert.equal(badTokens.missingTokens.length, 1);
  assert.equal(badTokens.mismatchedTokens.length, 1);

  // Negative PNG check
  assert.throws(() => parsePngMetadata(Buffer.from('not-a-png')), /Invalid PNG/);
  return true;
}

const REPRESENTATIVE_ROUTES = [
  '/app',
  '/app/keywords',
  '/app/seo/insights',
  '/app/geo/prompts',
  '/app/geo/analysis',
  '/app/gap',
  '/app/strategy-map',
  '/app/site-audit',
  '/app/factory',
  '/app/settings',
  '/ko',
  '/ko/pricing',
  '/ko/faq',
  '/ko/glossary',
];

const COMPARISON_PAIRS = [
  {
    id: 'app-desktop',
    viewport: 'desktop',
    source: 'docs/design-references/haloxlabs.ai/app-captured-desktop.png',
    clone: 'docs/design-references/haloxlabs.ai/clone-app-desktop-final.png',
  },
  {
    id: 'app-mobile',
    viewport: 'mobile-390',
    source: 'docs/design-references/haloxlabs.ai/source-app-mobile-final.png',
    clone: 'docs/design-references/haloxlabs.ai/clone-app-mobile-final.png',
  },
  {
    id: 'public-home-desktop',
    viewport: 'desktop-1440',
    source: 'docs/rea/public-site/source-home.png',
    clone: 'docs/rea/public-site/local-home.png',
  },
  {
    id: 'public-home-mobile',
    viewport: 'mobile-390',
    source: 'docs/design-references/haloxlabs.ai/public-mobile-menu-390.png',
    clone: 'docs/design-references/haloxlabs.ai/clone-public-mobile-menu-final.png',
  },
  {
    id: 'keyword-dialog',
    viewport: 'dialog-1908',
    source: 'docs/design-references/haloxlabs.ai/keyword-dialog.png',
    clone: 'docs/design-references/haloxlabs.ai/clone-keyword-dialog.png',
  },
  {
    id: 'keyword-dialog-1440',
    viewport: 'dialog-1440',
    source: 'docs/design-references/haloxlabs.ai/app-captured-desktop.png',
    clone: 'docs/design-references/haloxlabs.ai/clone-keyword-dialog-fixed.png',
  },
];

async function main() {
  const selfTestPassed = runVisualRegressionSelfTest();

  // 1. Verify CSS design tokens against REA Phase 4 evidence
  const tokenEvidence = JSON.parse(await fs.readFile('docs/rea/evidence/p4-css-tokens.json', 'utf8'));
  const originalCss = await fs.readFile('public/clone/original.css', 'utf8');
  const runtimeCss = await fs.readFile('public/clone/runtime.css', 'utf8');
  const tokenCheck = verifyCssTokens(originalCss + '\n' + runtimeCss, tokenEvidence.root_tokens);
  assert.equal(tokenCheck.passed, true, `CSS token mismatch: ${JSON.stringify(tokenCheck)}`);

  // 2. Verify representative route layout signatures
  const manifest = JSON.parse(await fs.readFile('public/clone/manifest.json', 'utf8'));
  const routeSignatures = [];
  for (const route of REPRESENTATIVE_ROUTES) {
    const entry = manifest.find(item => item.route === route);
    assert(entry, `Representative route missing from manifest: ${route}`);
    const pageData = JSON.parse(await fs.readFile(path.join('public/clone/pages', entry.file), 'utf8'));
    const sig = extractLayoutSignature(route, pageData);
    assert(sig.hasMain || sig.headingCount > 0, `Route ${route} lacks main content`);
    assert(sig.hasHeaderOrNav, `Route ${route} lacks navigation/header shell`);
    assert(sig.hasResponsiveBreakpoints, `Route ${route} lacks responsive breakpoint classes`);
    routeSignatures.push(sig);
  }

  // 3. Verify dialog templates
  const keywordDialog = JSON.parse(await fs.readFile('public/clone/keyword-dialog.json', 'utf8'));
  const dialogTemplates = JSON.parse(await fs.readFile('public/clone/dialog-templates.json', 'utf8'));
  assert(keywordDialog.html.includes('role="dialog"'), 'Keyword dialog missing role="dialog"');
  assert.equal(dialogTemplates.length, 8, 'Expected 8 captured dialog templates');

  // 4. Verify desktop/mobile visual reference pairs & route screenshots
  const pairResults = [];
  for (const pair of COMPARISON_PAIRS) {
    const sourceMeta = parsePngMetadata(await fs.readFile(pair.source));
    const cloneMeta = parsePngMetadata(await fs.readFile(pair.clone));
    assert.equal(cloneMeta.width, sourceMeta.width, `${pair.id}: viewport width mismatch (${cloneMeta.width} vs ${sourceMeta.width})`);
    assert(cloneMeta.height > 0 && sourceMeta.height > 0, `${pair.id}: invalid image height`);
    pairResults.push({
      id: pair.id,
      viewport: pair.viewport,
      source: { path: pair.source, ...sourceMeta },
      clone: { path: pair.clone, ...cloneMeta },
      widthMatched: cloneMeta.width === sourceMeta.width,
      passed: true,
    });
  }

  const routeScreenshotsDir = 'docs/design-references/haloxlabs.ai/routes';
  const routeFiles = (await fs.readdir(routeScreenshotsDir)).filter(f => f.endsWith('.png')).sort();
  const routeImageChecks = [];
  for (const file of routeFiles) {
    const fullPath = path.join(routeScreenshotsDir, file);
    const meta = parsePngMetadata(await fs.readFile(fullPath));
    assert(meta.width >= 1280 && meta.height >= 720, `Route screenshot ${file} has unexpected dimensions: ${meta.width}x${meta.height}`);
    routeImageChecks.push({ file, path: fullPath, ...meta });
  }

  // 5. Compare against or initialize visual-baseline.json
  const baselinePath = 'docs/clone/visual-baseline.json';
  const currentSnapshot = {
    cssTokenCount: tokenCheck.totalExpected,
    pairDigests: Object.fromEntries(pairResults.map(p => [p.id, { sourceSha256: p.source.sha256, cloneSha256: p.clone.sha256, width: p.clone.width, height: p.clone.height }])),
    routeImageDigests: Object.fromEntries(routeImageChecks.map(r => [r.file, { sha256: r.sha256, width: r.width, height: r.height }])),
    routeSignatures: Object.fromEntries(routeSignatures.map(s => [s.route, { tableCount: s.tableCount, buttonCount: s.buttonCount, inputCount: s.inputCount, headingCount: s.headingCount }])),
  };

  let baseline;
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  } catch {
    await fs.writeFile(baselinePath, JSON.stringify(currentSnapshot, null, 2) + '\n', 'utf8');
    baseline = currentSnapshot;
  }

  assert.deepEqual(currentSnapshot, baseline, 'Visual regression baseline mismatch detected');

  const report = {
    generatedAt: new Date().toISOString(),
    selfTestPassed,
    tokenCheck,
    representativeRoutesChecked: routeSignatures.length,
    dialogTemplatesChecked: dialogTemplates.length + 1,
    comparisonPairsChecked: pairResults.length,
    routeScreenshotsChecked: routeImageChecks.length,
    baselineMatched: true,
    pairResults,
    routeSignatures,
  };

  await fs.writeFile('docs/clone/visual-regression.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    passed: true,
    selfTestPassed,
    tokens: tokenCheck.totalExpected,
    routes: routeSignatures.length,
    pairs: pairResults.length,
    routeScreenshots: routeImageChecks.length,
    report: 'docs/clone/visual-regression.json',
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
