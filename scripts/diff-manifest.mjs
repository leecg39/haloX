import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

/**
 * Compare two HaloX route manifests (baseline vs target) and report
 * structural, status, title, URL, and content-length diffs.
 */
export function diffManifests(baselineEntries, targetEntries) {
  const baseMap = new Map(baselineEntries.map(entry => [entry.route, entry]));
  const targetMap = new Map(targetEntries.map(entry => [entry.route, entry]));

  const addedRoutes = [];
  const removedRoutes = [];
  const statusChanges = [];
  const titleChanges = [];
  const sourceUrlChanges = [];
  const textLengthChanges = [];
  const fileChanges = [];

  for (const [route, target] of targetMap.entries()) {
    const base = baseMap.get(route);
    if (!base) {
      addedRoutes.push({
        route,
        status: target.status,
        title: target.title,
        sourceUrl: target.sourceUrl,
      });
      continue;
    }
    if (base.status !== target.status) {
      statusChanges.push({ route, from: base.status, to: target.status });
    }
    if ((base.title || '') !== (target.title || '')) {
      titleChanges.push({ route, from: base.title || '', to: target.title || '' });
    }
    if ((base.sourceUrl || '') !== (target.sourceUrl || '')) {
      sourceUrlChanges.push({ route, from: base.sourceUrl || '', to: target.sourceUrl || '' });
    }
    if ((base.textLength ?? 0) !== (target.textLength ?? 0)) {
      textLengthChanges.push({
        route,
        from: base.textLength ?? 0,
        to: target.textLength ?? 0,
        delta: (target.textLength ?? 0) - (base.textLength ?? 0),
      });
    }
    if (base.file !== target.file) {
      fileChanges.push({ route, from: base.file, to: target.file });
    }
  }

  for (const [route, base] of baseMap.entries()) {
    if (!targetMap.has(route)) {
      removedRoutes.push({
        route,
        status: base.status,
        title: base.title,
        sourceUrl: base.sourceUrl,
      });
    }
  }

  addedRoutes.sort((a, b) => a.route.localeCompare(b.route));
  removedRoutes.sort((a, b) => a.route.localeCompare(b.route));
  statusChanges.sort((a, b) => a.route.localeCompare(b.route));
  titleChanges.sort((a, b) => a.route.localeCompare(b.route));
  sourceUrlChanges.sort((a, b) => a.route.localeCompare(b.route));
  textLengthChanges.sort((a, b) => a.route.localeCompare(b.route));
  fileChanges.sort((a, b) => a.route.localeCompare(b.route));

  const hasBreakingDrift =
    removedRoutes.length > 0 ||
    statusChanges.some(change => change.from === 'captured' && change.to === 'source-404');

  return {
    summary: {
      baselineCount: baselineEntries.length,
      targetCount: targetEntries.length,
      added: addedRoutes.length,
      removed: removedRoutes.length,
      statusChanged: statusChanges.length,
      titleChanged: titleChanges.length,
      sourceUrlChanged: sourceUrlChanges.length,
      textLengthChanged: textLengthChanges.length,
      fileChanged: fileChanges.length,
      hasBreakingDrift,
    },
    addedRoutes,
    removedRoutes,
    statusChanges,
    titleChanges,
    sourceUrlChanges,
    textLengthChanges,
    fileChanges,
  };
}

export function runManifestDiffSelfTest() {
  const sampleBase = [
    { route: '/app', file: 'a.json', title: 'HaloX App', sourceUrl: 'https://haloxlabs.ai/app', status: 'captured', textLength: 1000 },
    { route: '/app/keywords', file: 'b.json', title: 'Keywords', sourceUrl: 'https://haloxlabs.ai/app/keywords', status: 'captured', textLength: 500 },
    { route: '/legacy', file: 'c.json', title: 'Legacy', sourceUrl: 'https://haloxlabs.ai/legacy', status: 'captured', textLength: 200 },
  ];
  const sampleTarget = [
    { route: '/app', file: 'a.json', title: 'HaloX App v2', sourceUrl: 'https://haloxlabs.ai/app', status: 'captured', textLength: 1200 },
    { route: '/app/keywords', file: 'b.json', title: 'Keywords', sourceUrl: 'https://haloxlabs.ai/app/keywords', status: 'source-404', textLength: 100 },
    { route: '/app/new-feature', file: 'd.json', title: 'New Feature', sourceUrl: 'https://haloxlabs.ai/app/new-feature', status: 'captured', textLength: 800 },
  ];
  const diff = diffManifests(sampleBase, sampleTarget);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.statusChanged, 1);
  assert.equal(diff.summary.titleChanged, 1);
  assert.equal(diff.summary.textLengthChanged, 2);
  assert.equal(diff.summary.hasBreakingDrift, true);
  assert.equal(diff.addedRoutes[0].route, '/app/new-feature');
  assert.equal(diff.removedRoutes[0].route, '/legacy');
  assert.deepEqual(diff.statusChanges[0], { route: '/app/keywords', from: 'captured', to: 'source-404' });
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, fallback) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
  };
  const baselinePath = getArg('--baseline', 'docs/clone/manifest-baseline.json');
  const targetPath = getArg('--target', 'public/clone/manifest.json');
  const outPath = getArg('--out', 'docs/clone/manifest-diff.json');
  const updateBaseline = args.includes('--update-baseline');
  const failOnDrift = args.includes('--fail-on-drift');

  const selfTestPassed = runManifestDiffSelfTest();

  const targetRaw = await fs.readFile(targetPath, 'utf8');
  const targetEntries = JSON.parse(targetRaw);
  const targetSha256 = crypto.createHash('sha256').update(targetRaw).digest('hex');

  let baselineRaw;
  try {
    if (updateBaseline) throw new Error('force update');
    baselineRaw = await fs.readFile(baselinePath, 'utf8');
  } catch {
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.writeFile(baselinePath, JSON.stringify(targetEntries, null, 2) + '\n', 'utf8');
    baselineRaw = await fs.readFile(baselinePath, 'utf8');
  }

  const baselineEntries = JSON.parse(baselineRaw);
  const baselineSha256 = crypto.createHash('sha256').update(baselineRaw).digest('hex');
  const diff = diffManifests(baselineEntries, targetEntries);

  const report = {
    generatedAt: new Date().toISOString(),
    baselinePath,
    targetPath,
    baselineSha256,
    targetSha256,
    selfTestPassed,
    ...diff,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ outPath, selfTestPassed, summary: report.summary }));

  if (failOnDrift && diff.summary.hasBreakingDrift) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
