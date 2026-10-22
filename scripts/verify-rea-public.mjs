import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';

// Offline semantic comparison of the retained REA observations, not a live-browser test.
const directory = 'docs/rea/public-site';
const bundle = JSON.parse(gunzipSync(await fs.readFile(`${directory}/evidence-bundle.json.gz`)));
const ids = {
  sourceHome: 'ev_fba0bcc3c3ef08de41b3bbd7a893199ecb8e460c0f2caa1573f44eeab2090a3a',
  localHome: 'ev_b90be2111ab504697b27184efe34c953fcf434ad96dde6a7f70dcc4bf76032ac',
  sourcePricing: 'ev_a280163865f73434ad6cd2cab1651194dae6e9e70e88949544d510fdd28034fa',
  localPricing: 'ev_9419702b1907a6ab1267ab9e328312f0fbfeff47341832ffb38983e6eef9643b',
};
const records = Object.fromEntries(Object.entries(ids).map(([name, id]) => {
  const record = bundle.records.find(item => item.evidence_id === id);
  assert(record, `Missing evidence: ${id}`);
  const result = record.normalized_result;
  assert.equal(result.completeness.status, 'complete', `${name}: incomplete capture`);
  assert(result.steps.every(step => step.status === 'completed'), `${name}: scenario failed`);
  return [name, result];
}));
function page(record, stepId) {
  const step = record.steps.find(item => item.step_id === stepId);
  const artifact = step?.artifacts.dom;
  assert.equal(artifact?.state, 'captured', `${stepId}: DOM missing`);
  const { text, bytes, sha256 } = artifact.value;
  assert.equal(Buffer.byteLength(text), bytes);
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'), sha256);
  return cheerio.load(text);
}
const checks = [];
function compare(name, original, clone) {
  assert.deepEqual(clone, original, name);
  checks.push({ name, source: original, local: clone, passed: true });
}
for (const [step, selected] of [['seo-preview', '+ SEO'], ['geo-preview', '+ GEO'], ['content-preview', 'Content']]) {
  const read = record => {
    const $ = page(record, step);
    return $('button').filter((_, button) => ['Content', '+ SEO', '+ GEO'].includes($(button).text().trim()) && $(button).hasClass('bg-background')).map((_, button) => $(button).text().trim()).get();
  };
  compare(step, read(records.sourceHome), read(records.localHome));
  assert.deepEqual(read(records.localHome), [selected]);
}
for (const [step, count] of [['faq-ai-open', 1], ['faq-free-open', 1], ['faq-free-close', 0]]) {
  const read = record => {
    const $ = page(record, step);
    return $('main button[aria-expanded=true]').map((_, button) => ({
      question: $(button).text().replace(/\s+/g, ''),
      answer: $(button).next().text().replace(/\s+/g, ''),
    })).get();
  };
  compare(step, read(records.sourceHome), read(records.localHome));
  assert.equal(read(records.localHome).length, count);
}
const prices = record => {
  const $ = page(record, 'matrix-anchor');
  return $('#estimate .tabular-nums').map((_, item) => $(item).text()).get();
};
compare('pricing-101-keywords-100-prompts-3-engines', prices(records.sourcePricing), prices(records.localPricing));
assert(prices(records.localPricing).at(-1).includes('1,350,000'));
const anchor = record => {
  const url = new URL(record.steps.at(-1).after_url.url);
  return url.pathname + url.hash;
};
compare('pricing-section-anchor', anchor(records.sourcePricing), anchor(records.localPricing));
const $ = page(records.localHome, 'faq-free-close');
compare('no-unexpected-dialog', 0, $('[role=dialog]').length);

// Verify Blog (/ko/blog, /en/blog) category filter pills & count container structure
const manifest = JSON.parse(await fs.readFile('public/clone/manifest.json', 'utf8'));
for (const [blogRoute, expectedCategories] of [
  ['/ko/blog', ['전체', 'GEO', 'SEO', '콘텐츠 전략', 'AI 트렌드']],
  ['/en/blog', ['All', 'GEO', 'SEO', 'Content Strategy', 'AI Trends', 'geo']],
]) {
  const entry = manifest.find(item => item.route === blogRoute);
  assert(entry, `Missing manifest route: ${blogRoute}`);
  const pageData = JSON.parse(await fs.readFile(`public/clone/pages/${entry.file}`, 'utf8'));
  const $blog = cheerio.load(pageData.html);
  const pillLabels = $blog('main div.flex.items-center.gap-2 button')
    .map((_, b) => $blog(b).text().trim())
    .get();
  compare(`blog-categories-${blogRoute}`, expectedCategories, pillLabels);
  assert($blog('main div.mb-5 > span.text-sm.font-bold').length === 1, `${blogRoute}: missing count label`);
}

// Verify Glossary (/ko/glossary, /en/glossary) combobox aria-controls="glossary-search-listbox" and public-lists.ts handler
const publicListsSource = await fs.readFile('src/components/public-lists.ts', 'utf8');
assert(publicListsSource.includes('glossary-search-listbox'), 'public-lists.ts missing glossary-search-listbox');
assert(publicListsSource.includes('ArrowDown') && publicListsSource.includes('ArrowUp'), 'public-lists.ts missing keyboard navigation');
assert(publicListsSource.includes('initializeBlog'), 'public-lists.ts missing initializeBlog');
for (const glossaryRoute of ['/ko/glossary', '/en/glossary']) {
  const entry = manifest.find(item => item.route === glossaryRoute);
  assert(entry, `Missing manifest route: ${glossaryRoute}`);
  const pageData = JSON.parse(await fs.readFile(`public/clone/pages/${entry.file}`, 'utf8'));
  const $glossary = cheerio.load(pageData.html);
  const combobox = $glossary('main input[role="combobox"][aria-controls="glossary-search-listbox"]');
  compare(`glossary-combobox-${glossaryRoute}`, 1, combobox.length);
}

const report = {
  method: 'Derived semantic assertions over complete REA controlled-replay records and captured public list DOM; DOM byte lengths and SHA-256 verified.',
  scope: 'Homepage tabs, single-open FAQ, pricing totals and same-page anchor, blog category filters/pagination, and glossary combobox autocomplete.',
  evidence: ids,
  passed: checks.length,
  checks,
};
await fs.writeFile(`${directory}/conformance.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: checks.length, report: `${directory}/conformance.json` }));
