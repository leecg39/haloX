import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'public/clone/manifest.json');
const outputPath = path.join(root, 'docs/clone/crud-coverage.json');

const domains = {
  'public-site': { models: ['site_pages', 'site_posts', 'site_taxonomies', 'site_translations', 'contact_requests'], apis: ['src/app/api/v1/site-content/route.ts', 'src/app/api/v1/contact/route.ts'], tests: ['e2e/site-content.spec.ts'], docs: ['docs/clone/public-site-content-crud.md'] },
  auth: { models: ['profiles', 'account_sessions', 'phone_verification', 'account_credentials'], apis: ['src/app/api/v1/auth/route.ts', 'src/app/api/v1/auth/signup/route.ts', 'src/app/api/v1/auth/recovery/route.ts'], tests: ['e2e/auth.spec.ts', 'e2e/signup.spec.ts', 'e2e/account.spec.ts'], docs: ['docs/clone/account-security-crud.md'] },
  dashboard: { models: ['dashboard_preferences', 'serp_snapshots', 'geo_prompt_runs', 'site_audit_scans'], apis: ['src/app/api/v1/observability/route.ts'], tests: ['e2e/observability.spec.ts'], docs: ['docs/clone/observability-crud.md'] },
  keywords: { models: ['keywords', 'keyword_sets', 'keyword_ideas', 'keyword_prompt_links'], apis: ['src/app/api/v1/keywords/route.ts'], tests: ['e2e/keywords.spec.ts'], docs: ['docs/clone/keyword-crud.md'] },
  prompts: { models: ['geo_prompts', 'geo_prompt_sets', 'geo_prompt_runs'], apis: ['src/app/api/v1/prompts/route.ts'], tests: ['e2e/prompts.spec.ts'], docs: ['docs/clone/prompt-crud.md'] },
  analyses: { models: ['saved_analyses', 'serp_snapshots', 'geo_prompt_runs', 'geo_answers_raw'], apis: ['src/app/api/v1/analyses/route.ts'], tests: ['e2e/analyses.spec.ts'], docs: ['docs/clone/analysis-gap-crud.md'] },
  gaps: { models: ['geo_prompt_candidates', 'opportunity_decisions', 'keywords', 'geo_prompts'], apis: ['src/app/api/v1/gaps/route.ts'], tests: ['e2e/gaps.spec.ts'], docs: ['docs/clone/analysis-gap-crud.md'] },
  library: { models: ['writing_style_profiles', 'writing_style_samples', 'knowledge_entities', 'knowledge_entity_sources'], apis: ['src/app/api/v1/library/route.ts'], tests: ['e2e/library.spec.ts'], docs: ['docs/clone/library-crud.md'] },
  content: { models: ['content_jobs', 'content_drafts', 'content_compositions'], apis: ['src/app/api/v1/content/route.ts'], tests: ['e2e/content.spec.ts'], docs: ['docs/clone/content-crud.md'] },
  optimization: { models: ['content_review_runs', 'content_change_items', 'content_drafts'], apis: ['src/app/api/v1/optimization/route.ts'], tests: ['e2e/optimization.spec.ts'], docs: ['docs/clone/optimization-crud.md'] },
  exports: { models: ['export_history', 'article_translations', 'export_destinations', 'export_publications'], apis: ['src/app/api/v1/exports/route.ts'], tests: ['e2e/exports.spec.ts', 'e2e/translation.spec.ts', 'e2e/wordpress.spec.ts'], docs: ['docs/clone/export-crud.md', 'docs/clone/wordpress-crud.md'] },
  'site-audit': { models: ['site_audit_targets', 'site_audit_scans', 'site_audit_pages', 'site_audit_issues'], apis: ['src/app/api/v1/site-audit/route.ts'], tests: ['e2e/site-audit.spec.ts', 'e2e/site-policy.spec.ts'], docs: ['docs/clone/site-audit-crud.md', 'docs/clone/site-policy-crud.md'] },
  strategy: { models: ['keyword_clusters', 'keyword_cluster_members', 'cluster_stats_history'], apis: ['src/app/api/v1/strategy-map/route.ts'], tests: ['e2e/strategy.spec.ts'], docs: ['docs/clone/strategy-crud.md'] },
  observability: { models: ['monitor_rules', 'geo_alerts', 'report_snapshots', 'report_action_items'], apis: ['src/app/api/v1/observability/route.ts'], tests: ['e2e/observability.spec.ts'], docs: ['docs/clone/observability-crud.md'] },
  'raw-data': { models: ['raw_import_batches', 'serp_snapshots', 'geo_answers_raw', 'site_audit_scans'], apis: ['src/app/api/v1/raw-data/route.ts'], tests: ['e2e/raw-data.spec.ts'], docs: ['docs/clone/raw-data-crud.md'] },
  portal: { models: ['referral_codes', 'referral_invites', 'feedback_threads', 'feedback_replies'], apis: ['src/app/api/v1/portal/route.ts'], tests: ['e2e/portal.spec.ts'], docs: ['docs/clone/referral-feedback-crud.md'] },
  account: { models: ['profiles', 'account_sessions', 'account_deletion_requests'], apis: ['src/app/api/v1/account/route.ts', 'src/app/api/v1/account/deletion/route.ts'], tests: ['e2e/account.spec.ts', 'e2e/account-deletion.spec.ts'], docs: ['docs/clone/account-security-crud.md', 'docs/clone/account-deletion-crud.md'] },
  workspace: { models: ['workspaces', 'workspace_members', 'workspace_invitations'], apis: ['src/app/api/v1/workspace-management/route.ts', 'src/app/api/v1/workspaces/route.ts'], tests: ['e2e/workspace-management.spec.ts', 'e2e/workspaces.spec.ts'], docs: ['docs/clone/workspace-settings-crud.md'] },
  tags: { models: ['workspace_tags', 'workspace_tag_groups', 'keyword_tag_assignments', 'geo_prompt_tag_assignments'], apis: ['src/app/api/v1/tag-settings/route.ts'], tests: ['e2e/tag-settings.spec.ts'], docs: ['docs/clone/tag-settings-crud.md'] },
  brand: { models: ['brands', 'brand_products', 'brand_domain_aliases', 'brand_reclassify_jobs'], apis: ['src/app/api/v1/brand-settings/route.ts'], tests: ['e2e/brand-settings.spec.ts'], docs: ['docs/clone/brand-tracking-crud.md'] },
  earned: { models: ['earned_publications', 'serp_snapshots', 'geo_answers_raw'], apis: ['src/app/api/v1/earned/route.ts'], tests: ['e2e/earned.spec.ts'], docs: ['docs/clone/earned-urls-crud.md'] },
  google: { models: ['workspace_google_connections', 'google_sync_jobs', 'gsc_daily_totals', 'ga4_page_stats'], apis: ['src/app/api/v1/google/route.ts'], tests: ['e2e/google-integrations.spec.ts'], docs: ['docs/clone/google-integrations-crud.md'] },
  notifications: { models: ['notification_preferences', 'notification_deliveries', 'notification_inbox'], apis: ['src/app/api/v1/notifications/route.ts'], tests: ['e2e/notifications.spec.ts'], docs: ['docs/clone/notifications-crud.md'] },
  billing: { models: ['subscriptions', 'workspace_plans', 'workspace_credit_balances', 'workspace_credit_ledger'], apis: ['src/app/api/v1/billing/route.ts', 'src/app/api/v1/credits/route.ts'], tests: ['e2e/billing.spec.ts', 'e2e/credits.spec.ts'], docs: ['docs/clone/billing-crud.md', 'docs/clone/credits-rewards-crud.md'] },
  api: { models: ['workspace_api_keys', 'api_key_usage', 'workspace_api_limits'], apis: ['src/app/api/v1/api-settings/route.ts', 'src/app/api/v1/mcp/route.ts'], tests: ['e2e/api-settings.spec.ts'], docs: ['docs/clone/api-keys-crud.md'] },
  general: { models: ['workspaces', 'profiles', 'geo_prompts', 'keywords'], apis: ['src/app/api/v1/general-settings/route.ts'], tests: ['e2e/general-settings.spec.ts'], docs: ['docs/clone/general-settings-crud.md'] },
};

function settingsDomain(search) {
  return ({ api: 'api', billing: 'billing', plan: 'billing', 'brand-tracking': 'brand', earned: 'earned', export: 'exports', integrations: 'google', members: 'workspace', notifications: 'notifications', tags: 'tags', workspace: 'workspace', profile: 'account', general: 'general' })[search.get('tab') || 'general'] || 'general';
}

function domainFor(route) {
  const url = new URL(route, 'https://halox.local');
  const p = url.pathname;
  if (p === '/' || /^\/(ko|en)(?:\/|$)/.test(p)) return 'public-site';
  if (['/app/login', '/app/signup', '/app/forgot-password'].includes(p)) return 'auth';
  if (p === '/app') return 'dashboard';
  if (p.startsWith('/app/keywords')) return 'keywords';
  if (p.startsWith('/app/geo/prompts')) return 'prompts';
  if (p === '/app/geo' || p.startsWith('/app/geo/analysis') || p.startsWith('/app/seo/insights')) return 'analyses';
  if (p.startsWith('/app/gap')) return 'gaps';
  if (p.startsWith('/app/personas') || p.startsWith('/app/knowledgehub')) return 'library';
  if (p.startsWith('/app/factory')) return 'content';
  if (p.startsWith('/app/optimize')) return 'optimization';
  if (p.startsWith('/app/exports')) return 'exports';
  if (p.startsWith('/app/site-audit')) return 'site-audit';
  if (p.startsWith('/app/strategy-map')) return 'strategy';
  if (p.startsWith('/app/monitoring') || p.startsWith('/app/reports')) return 'observability';
  if (p.startsWith('/app/raw-data')) return 'raw-data';
  if (p.startsWith('/app/referral') || p.startsWith('/app/feedback')) return 'portal';
  if (p === '/app/settings') return settingsDomain(url.searchParams);
  return null;
}

const manifestText = await fs.readFile(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const routes = [];
for (const item of manifest) {
  const excluded = item.status === 'source-404' || item.status === 'redirect';
  const domain = excluded ? null : domainFor(item.route);
  if (!excluded) assert.ok(domain, `CRUD 도메인 매핑 누락: ${item.route}`);
  routes.push({ route: item.route, source_status: item.status, excluded_from_completion: excluded, ...(excluded ? { exclusion_reason: item.status === 'source-404' ? '원본 서버가 404를 반환한 캡처 경로' : '리디렉션 전용 경로' } : { domain }) });
}

const supplementalRoutes = [
  { route: '/app/site-content', domain: 'public-site', reason: '캡처 이후 추가한 운영자 CMS 경로' },
  { route: '/app/settings?tab=profile', domain: 'account', reason: '캡처 이후 추가한 계정 프로필·보안 탭' },
  { route: '/app/settings?tab=credits', domain: 'billing', reason: '서버 크레딧 원장 탭' },
  { route: '/app/restore-account', domain: 'account', reason: '탈퇴 유예 계정 복원 경로' },
  { route: '/app/invite?token=:token', domain: 'workspace', reason: '워크스페이스 초대 수락 경로' },
  { route: '/app/geo/prompts/:id', domain: 'prompts', reason: '프롬프트 동적 상세 경로' },
  { route: '/app/personas/:id', domain: 'library', reason: '페르소나 동적 상세 경로' },
  { route: '/app/knowledgehub/:id', domain: 'library', reason: '지식 자료 동적 상세 경로' },
  { route: '/app/factory/:id', domain: 'content', reason: '콘텐츠 동적 상세 경로' },
  { route: '/app/optimize/:id', domain: 'optimization', reason: '최적화 동적 상세 경로' },
  { route: '/app/site-audit/:id', domain: 'site-audit', reason: '사이트 진단 동적 상세 경로' },
  { route: '/app/strategy-map/:id', domain: 'strategy', reason: '전략 그룹 동적 상세 경로' },
  { route: '/app/reports/:id', domain: 'observability', reason: '리포트 동적 상세 경로' },
  { route: '/app/feedback/:id', domain: 'portal', reason: '피드백 대화 동적 상세 경로' },
];
const usedDomains = [...new Set([...routes.flatMap(row => row.domain ? [row.domain] : []), ...supplementalRoutes.map(row => row.domain)])];
const backendDirectory = path.join(root, 'src/lib/backend');
const backendSource = (await Promise.all((await fs.readdir(backendDirectory)).filter(file => file.endsWith('.ts')).map(file => fs.readFile(path.join(backendDirectory, file), 'utf8')))).join('\n');
for (const name of usedDomains) {
  const definition = domains[name]; assert.ok(definition, `도메인 정의 누락: ${name}`);
  for (const model of definition.models) assert.ok(backendSource.includes(`'${model}'`) || backendSource.includes(`\"${model}\"`), `실제 모델 참조 누락: ${name}.${model}`);
  for (const filename of [...definition.apis, ...definition.tests, ...definition.docs]) await fs.access(path.join(root, filename));
}

const included = routes.filter(row => !row.excluded_from_completion);
const excluded = routes.filter(row => row.excluded_from_completion);
const report = {
  schema_version: 1,
  manifest_sha256: crypto.createHash('sha256').update(manifestText).digest('hex'),
  summary: {
    manifest_routes: routes.length,
    included_routes: included.length,
    excluded_routes: excluded.length,
    source_404_routes: excluded.filter(row => row.source_status === 'source-404').length,
    redirect_routes: excluded.filter(row => row.source_status === 'redirect').length,
    mapped_domains: usedDomains.length,
    unmapped_included_routes: 0,
  },
  quality_contract: {
    shared_ui: ['API 실패 시 오류와 재시도', '로딩 상태 role=status', '빈 데이터 안내', '권한 없음 안내', '모달 포커스·ESC·키보드 제출'],
    domain_e2e: ['저장·새로고침', '실패 시 입력 보존', '사용자·워크스페이스 격리', '모바일 스크롤·조작'],
    metric_invariants: ['총계는 저장 레코드 길이여서 0 이상', '점수와 비율은 0~100', '음수는 직전 기간 대비 변화(%p)에만 허용'],
  },
  domains: Object.fromEntries(usedDomains.sort().map(name => [name, domains[name]])),
  supplemental_routes: supplementalRoutes,
  routes,
};
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`CRUD coverage verified: ${included.length} included, ${excluded.length} excluded, ${usedDomains.length} domains, 0 unmapped`);
