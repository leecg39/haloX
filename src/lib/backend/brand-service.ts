import crypto from 'node:crypto';
import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { contentText } from './content-model.ts';
import { BrandConflictError, brandTextKey, classifyBrandEvidence, urlHost, validateBrandConfig, type BrandConfig, type Brand, type Product, type Alias } from './brand-model.ts';

export const brandWhere = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id === undefined ? {} : { id: `eq.${id}` }) });
const rows = (db: HaloXDatabase, workspace: string, actor: string, table: string) => db.queryTable(table, { filters: brandWhere(workspace) }, actor).data;
export function readBrandConfig(db: HaloXDatabase, workspace: string, actor: string): BrandConfig {
  const setting = rows(db, workspace, actor, 'brand_tracking_settings')[0];
  return { revision: Number(setting?.revision || 0), enabled: setting?.enabled === true, mode: setting?.mode === 'full' ? 'full' : 'root', brands: rows(db, workspace, actor, 'brands') as Brand[], products: rows(db, workspace, actor, 'brand_products') as Product[], aliases: rows(db, workspace, actor, 'brand_domain_aliases') as Alias[] };
}
const rawRows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const finiteRank = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
/** Rebuild only derived fields; raw URLs, raw responses, imports and provider metadata stay intact. */
export function reclassifyBrandData(db: HaloXDatabase, workspace: string, actor: string, scope: { keyword_id?: unknown; run_id?: unknown; import_batch_id?: unknown } = {}) {
  const config = readBrandConfig(db, workspace, actor); if (!config.enabled) return { seo_count: 0, geo_count: 0 };
  db.assertWorkspaceAccess(workspace, actor, 'analysis', 'write');
  const keywords = rows(db, workspace, actor, 'keywords'), citations = rows(db, workspace, actor, 'geo_citations'), metrics = rows(db, workspace, actor, 'geo_run_metrics');
  let seo_count = 0, geo_count = 0;
  for (const snapshot of rows(db, workspace, actor, 'serp_snapshots')) {
    if (scope.run_id || scope.keyword_id && snapshot.keyword_id !== scope.keyword_id || scope.import_batch_id && snapshot.import_batch_id !== scope.import_batch_id) continue;
    const keyword = keywords.find(row => row.id === snapshot.keyword_id);
    const source = rawRows(snapshot.top_results_json), classification = classifyBrandEvidence(config, source.length ? source.map(row => `${row.title || ''} ${row.description || row.snippet || ''}`).join('\n') : null, source, keyword?.keyword_set_id);
    const ranks = classification.sources.filter(row => row.is_ours && finiteRank(row.rank)).map(row => Number(row.rank)), rank = ranks.length ? Math.min(...ranks) : null;
    const overview = (snapshot.ai_overview_json as Row | undefined)?.cited_domains;
    const aio = Array.isArray(overview) ? classifyBrandEvidence(config, null, overview.map(domain => ({ url: /^https?:\/\//i.test(String(domain)) ? domain : `https://${domain}` })), keyword?.keyword_set_id).cited : null;
    const derived = { ...classification, rank, rank_measured: classification.domains.length > 0 && Array.isArray(snapshot.top_results_json), aio_cited: aio, classified_at: new Date().toISOString() };
    db.updateTable('serp_snapshots', { brand_classification: derived, provider_analysis_json: Object.hasOwn(snapshot, 'provider_analysis_json') ? snapshot.provider_analysis_json : snapshot.serp_analysis_json ?? null, serp_analysis_json: { ...(snapshot.serp_analysis_json as Row || {}), our_rank: rank, aio_cited: aio, top10: derived.rank_measured ? rank !== null && rank <= 10 : null } }, brandWhere(workspace, snapshot.id), actor); seo_count++;
  }
  for (const run of rows(db, workspace, actor, 'geo_prompt_runs')) {
    if (scope.keyword_id || scope.run_id && run.id !== scope.run_id || scope.import_batch_id && run.import_batch_id !== scope.import_batch_id || run.status !== 'completed') continue;
    const source = citations.filter(row => row.run_id === run.id), classification = classifyBrandEvidence(config, typeof run.answer_text === 'string' ? run.answer_text : null, source);
    const derived = { ...classification, classified_at: new Date().toISOString() }, measured = classification.cited !== null;
    const own = classification.sources.filter(row => row.is_ours).length, competitors = classification.sources.filter(row => row.is_competitor).length;
    for (const citation of classification.sources) {
      const original = source.find(row => row.id === citation.id)!;
      db.updateTable('geo_citations', { is_ours: citation.is_ours, is_competitor: citation.is_competitor, brand_id: citation.brand_id, provider_classification: Object.hasOwn(original, 'provider_classification') ? original.provider_classification : { is_ours: original.is_ours ?? null, is_competitor: original.is_competitor ?? null } }, brandWhere(workspace, citation.id), actor);
    }
    const current = metrics.find(row => row.run_id === run.id);
    const values = { brand_mentioned: classification.mentioned, is_cited: classification.cited, our_citation_count: measured ? own : null, competitor_citation_count: competitors, other_citation_count: source.length - own - competitors, citation_rate: measured ? (source.length ? 100 * own / source.length : 0) : null, source_but_not_cited: measured && classification.mentioned !== null ? classification.mentioned && !classification.cited : null, citation_rank_score: null, mention_rank_score: null };
    if (current) db.updateTable('geo_run_metrics', { ...values, provider_classification: Object.hasOwn(current, 'provider_classification') ? current.provider_classification : Object.fromEntries(Object.keys(values).map(key => [key, current[key] ?? null])) }, brandWhere(workspace, current.id), actor);
    else db.insertTable('geo_run_metrics', { ...values, workspace_id: workspace, run_id: run.id, provider_classification: null }, actor);
    db.updateTable('geo_prompt_runs', { brand_classification: derived }, brandWhere(workspace, run.id), actor); geo_count++;
  }
  return { seo_count, geo_count };
}
export function readBrandSettings(db: HaloXDatabase, workspace: string, actor: string, now = Date.now()) {
  db.assertWorkspaceAccess(workspace, actor, 'other'); db.assertWorkspaceAccess(workspace, actor, 'analysis');
  const config = readBrandConfig(db, workspace, actor), permission = db.workspacePermissions(workspace, actor);
  const recent = rows(db, workspace, actor, 'geo_prompt_runs').filter(run => run.status === 'completed' && Date.parse(String(run.finished_at)) >= now - 28 * 86400000 && Date.parse(String(run.finished_at)) <= now);
  const counts = (field: string, id: string) => recent.filter(run => Array.isArray((run.brand_classification as Row | undefined)?.[field]) && ((run.brand_classification as Row)[field] as unknown[]).includes(id)).length;
  const observed = new Map<string, Set<string>>();
  const recordHost = (host: string, id: string) => { if (host) { const found = observed.get(host) || new Set<string>(); found.add(id); observed.set(host, found); } };
  for (const citation of rows(db, workspace, actor, 'geo_citations')) if (recent.some(run => run.id === citation.run_id)) recordHost(urlHost(citation.cited_url), String(citation.run_id));
  for (const snapshot of rows(db, workspace, actor, 'serp_snapshots')) if (Date.parse(String(snapshot.captured_at)) >= now - 28 * 86400000 && Date.parse(String(snapshot.captured_at)) <= now) for (const source of rawRows(snapshot.top_results_json)) recordHost(urlHost(source.url), String(snapshot.id));
  return { config, editable: ['owner', 'admin'].includes(permission.role), keyword_sets: rows(db, workspace, actor, 'keyword_sets').map(row => ({ id: row.id, name: row.name })),
    jobs: rows(db, workspace, actor, 'brand_reclassify_jobs').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    brand_counts: Object.fromEntries(config.brands.map(brand => [brand.id, config.enabled ? counts('brand_ids', brand.id) : null])), product_counts: Object.fromEntries(config.products.map(product => [product.id, config.enabled ? counts('product_ids', product.id) : null])),
    observed_domains: [...observed].map(([domain, ids]) => ({ domain, records: ids.size })).sort((a, b) => b.records - a.records || a.domain.localeCompare(b.domain)).slice(0, 30) };
}
function manager(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'other', 'write'); db.assertWorkspaceAccess(workspace, actor, 'analysis', 'write');
  if (!['owner', 'admin'].includes(db.workspacePermissions(workspace, actor).role)) throw new RlsAccessDeniedError('브랜드 설정과 과거 데이터 재분류는 소유자 또는 관리자만 변경할 수 있습니다.');
}
function syncRows(db: HaloXDatabase, workspace: string, actor: string, table: string, desired: Row[]) {
  const previous = rows(db, workspace, actor, table);
  for (const row of previous) if (!desired.some(item => item.id === row.id)) db.deleteTable(table, brandWhere(workspace, row.id), actor);
  for (const row of desired) { const old = previous.find(item => item.id === row.id); if (!old) db.insertTable(table, { ...row, workspace_id: workspace }, actor); else if (JSON.stringify(old) !== JSON.stringify(row)) db.updateTable(table, row, brandWhere(workspace, row.id), actor); }
}
export function runBrandCommand(db: HaloXDatabase, actor: string, payload: Row): Row {
  const workspace = contentText(payload.workspace_id, '워크스페이스', 100, true); manager(db, workspace, actor);
  const action = String(payload.action), initial = readBrandConfig(db, workspace, actor), config = structuredClone(initial);
  if (['job-update', 'job-delete'].includes(action)) {
    const job = rows(db, workspace, actor, 'brand_reclassify_jobs').find(row => row.id === payload.id); if (!job) throw new Error('재계산 기록이 없습니다.');
    if (payload.expected_revision !== Number(job.revision || 0)) throw new BrandConflictError();
    if (action === 'job-delete') db.deleteTable('brand_reclassify_jobs', brandWhere(workspace, job.id), actor);
    else db.updateTable('brand_reclassify_jobs', { notes: contentText(payload.notes, '재계산 메모', 2000), revision: Number(job.revision || 0) + 1 }, brandWhere(workspace, job.id), actor);
    return { ok: true };
  }
  const receipts = db.getServerRecords('brand_reclassify_requests');
  if (action === 'recalculate') {
    contentText(payload.idempotency_key, '요청 키', 100, true);
    const receipt = receipts.find(row => row.workspace_id === workspace && row.key === payload.idempotency_key);
    if (receipt) { if (receipt.config_revision !== payload.expected_revision) throw new BrandConflictError(); const job = rows(db, workspace, actor, 'brand_reclassify_jobs').find(row => row.id === receipt.job_id); if (!job) throw new Error('이미 실행한 뒤 삭제한 요청입니다. 새 요청으로 실행해 주세요.'); return { ok: true, job, replayed: true }; }
  }
  if (!Number.isSafeInteger(payload.expected_revision) || payload.expected_revision !== initial.revision) throw new BrandConflictError();
  const find = <T extends Row>(list: T[]) => { const row = list.find(row => row.id === payload.id); if (!row) throw new Error('현재 워크스페이스에서 항목을 찾을 수 없습니다.'); return row; };
  const id = crypto.randomUUID();
  if (action === 'policy-update') config.mode = payload.mode as BrandConfig['mode'];
  else if (action === 'brand-create' || action === 'brand-update') {
    const value = Object.fromEntries(['brand_name', 'role', 'mentions', 'domains', 'keyword_set_ids'].filter(key => key in payload).map(key => [key, payload[key]]));
    if (action === 'brand-create') config.brands.push({ ...value, id } as Brand); else Object.assign(find(config.brands), value);
  } else if (action === 'brand-delete') { const brand = find(config.brands); config.brands = config.brands.filter(row => row.id !== brand.id); config.products = config.products.filter(product => product.brand_id !== brand.id); }
  else if (action === 'brand-merge') {
    const source = find(config.brands), target = config.brands.find(row => row.id === payload.target_id);
    if (!target || target.id === source.id || target.role !== source.role) throw new Error('같은 종류의 다른 브랜드를 병합 대상으로 선택해 주세요.');
    const unique = (items: string[]) => [...new Map(items.map(item => [brandTextKey(item), item])).values()];
    target.mentions = unique([...target.mentions, source.brand_name, ...source.mentions]); target.domains = unique([...target.domains, ...source.domains]); target.keyword_set_ids = unique([...target.keyword_set_ids, ...source.keyword_set_ids]);
    for (const product of config.products) if (product.brand_id === source.id) product.brand_id = target.id;
    config.brands = config.brands.filter(row => row.id !== source.id);
  } else if (action === 'product-create' || action === 'product-update') {
    const value = Object.fromEntries(['brand_id', 'name', 'mentions', 'category', 'url', 'description'].filter(key => key in payload).map(key => [key, payload[key]]));
    if (action === 'product-create') config.products.push({ ...value, id } as Product); else Object.assign(find(config.products), value);
  } else if (action === 'product-delete') { find(config.products); config.products = config.products.filter(row => row.id !== payload.id); }
  else if (action === 'alias-create' || action === 'alias-update') { const value = Object.fromEntries(['source', 'target'].filter(key => key in payload).map(key => [key, payload[key]])); if (action === 'alias-create') config.aliases.push({ ...value, id } as Alias); else Object.assign(find(config.aliases), value); }
  else if (action === 'alias-delete') { find(config.aliases); config.aliases = config.aliases.filter(row => row.id !== payload.id); }
  else if (action !== 'recalculate') throw new Error('지원하지 않는 브랜드 작업입니다.');
  const next = validateBrandConfig(config, rows(db, workspace, actor, 'keyword_sets'));
  for (const brand of next.brands) Object.assign(brand, { target_domain: brand.domains[0] || '', self_roots: brand.role === 'self' ? brand.domains : [], competitor_domains: next.brands.filter(other => other.role === 'competitor').flatMap(other => other.domains) });
  next.enabled = true; next.revision += action === 'recalculate' && initial.enabled ? 0 : 1;
  syncRows(db, workspace, actor, 'brands', next.brands); syncRows(db, workspace, actor, 'brand_products', next.products); syncRows(db, workspace, actor, 'brand_domain_aliases', next.aliases);
  const setting = rows(db, workspace, actor, 'brand_tracking_settings')[0], values = { mode: next.mode, enabled: true, revision: next.revision };
  if (setting) db.updateTable('brand_tracking_settings', values, brandWhere(workspace, setting.id), actor); else db.insertTable('brand_tracking_settings', { ...values, workspace_id: workspace }, actor);
  const counts = reclassifyBrandData(db, workspace, actor);
  const [job] = db.insertTable('brand_reclassify_jobs', { workspace_id: workspace, status: 'completed', reason: action, config_revision: next.revision, config_snapshot: next, ...counts, created_by: actor, notes: '', revision: 1, finished_at: new Date().toISOString() }, actor);
  if (action === 'recalculate') db.setServerRecords('brand_reclassify_requests', [...receipts, { workspace_id: workspace, key: payload.idempotency_key, config_revision: payload.expected_revision, job_id: job.id }]);
  return { ok: true, config_revision: next.revision, job };
}
