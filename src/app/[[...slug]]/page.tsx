import { NotificationsPage } from '@/components/live/NotificationsPage';
import { BillingPage } from '@/components/live/BillingPage';
import { CreditsPage } from '@/components/live/CreditsPage';
import { IntegrationsPage } from '@/components/live/IntegrationsPage';
import { RestoreAccountPage } from '@/components/AccountDeletion';
import { GeneralSettingsPage } from '@/components/live/GeneralSettingsPage';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCapture } from '@/lib/content';
import ClonePage from '@/components/ClonePage';
import { WorkspaceSettingsPage } from '@/components/live/WorkspaceSettingsPage';
import { EarnedPage } from '@/components/live/EarnedPage';
import { TagSettingsPage } from '@/components/live/TagSettingsPage';
import { ApiSettingsPage } from '@/components/live/ApiSettingsPage';
import { BrandSettingsPage } from '@/components/live/BrandSettingsPage';
import { WorkspaceInvitePage } from '@/components/WorkspaceInvitePage';
import { AccountPage } from '@/components/live/AccountPage';
import { PasswordRecoveryPage } from '@/components/AccountSecurityForms';
import { ReferralPage } from '@/components/live/ReferralPage';
import { FeedbackPage } from '@/components/live/FeedbackPage';
import { RawDataPage } from '@/components/live/RawDataPage';
import { DashboardPage } from '@/components/live/DashboardPage';
import { MonitoringPage } from '@/components/live/MonitoringPage';
import { ReportsPage } from '@/components/live/ReportsPage';
import { Workspaces } from '@/components/Workspaces';
import { KeywordsPage } from '@/components/live/KeywordsPage';
import { PromptsPage } from '@/components/live/PromptsPage';
import { PersonasPage } from '@/components/live/PersonasPage';
import { OptimizationPage } from '@/components/live/OptimizationPage';
import { SiteAuditPage } from '@/components/live/SiteAuditPage';
import { StrategyPage } from '@/components/live/StrategyPage';
import { AnalysesPage } from '@/components/live/AnalysesPage';
import { GapPage } from '@/components/live/GapPage';
import { ExportsPage } from '@/components/live/ExportsPage';
import { ContentPage } from '@/components/live/ContentPage';
import { KnowledgePage } from '@/components/live/KnowledgePage';
import { SiteContentPage } from '@/components/live/SiteContentPage';
import { PublicManagedContent } from '@/components/PublicManagedContent';
import { haloxStore } from '@/lib/backend/store';
import { readPublicSiteContent } from '@/lib/backend/site-content-service';
import { cookies } from 'next/headers';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// 표시 모드: 'original' = 캡처한 원본 화면을 그대로 렌더링(1:1 표시), 'live' = 라이브 CRUD 화면.
// 우선순위: halox_display 쿠키 > HALOX_DEFAULT_DISPLAY_MODE 환경변수(기본 original).
const ALWAYS_LIVE = new Set([
  '/app/login', '/app/signup', '/app/forgot-password', '/app/reset-password',
  '/app/restore-account', '/app/invite', '/app/workspaces', '/app/site-content',
]);
export async function resolveDisplayMode(pathname: string): Promise<'original' | 'live'> {
  if (ALWAYS_LIVE.has(pathname)) return 'live';
  const jar = await cookies();
  const cookie = jar.get('halox_display')?.value;
  if (cookie === 'live' || cookie === 'original') return cookie;
  return process.env.HALOX_DEFAULT_DISPLAY_MODE === 'live' ? 'live' : 'original';
}
async function resolveRoute(props: Props) {
  const { slug = [] } = await props.params;
  const query = await props.searchParams, q = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) q.set(key, Array.isArray(value) ? value[0] : value);
  return '/' + slug.join('/') + (q.size ? '?' + q : '');
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const route = await resolveRoute(props), pathname = route.split('?')[0];
  if (['/app/forgot-password', '/app/reset-password'].includes(pathname)) return { title: '비밀번호 재설정 | HaloX', robots: { index: false, follow: false } };
  if (pathname === '/app/restore-account') return { title: '계정 복원 | HaloX', robots: { index: false, follow: false } };
  if (pathname === '/app/invite') return { title: '워크스페이스 초대 | HaloX', robots: { index: false, follow: false }, referrer: 'no-referrer' };
  const portalTitle = pathname === '/app/settings' && new URLSearchParams(route.split('?')[1]).get('tab') === 'profile' ? '내 프로필과 보안' : pathname === '/app/referral' ? '추천 프로그램' : /^\/app\/feedback(?:\/[^/]+)?$/.test(pathname) ? '피드백' : undefined;
  if (portalTitle) return { title: `${portalTitle} | HaloX`, robots: { index: false, follow: false } };
  if (!pathname.startsWith('/app')) { try { const managed = await haloxStore.read(db => readPublicSiteContent(db, pathname)); if (managed.content) return { title: String(managed.content.seo_title || managed.content.title), description: String(managed.content.excerpt || '') }; } catch {} }
  const data = await getCapture(route);
  return { title: data?.title || 'HaloX', robots: { index: false, follow: false } };
}
export default async function Page(props: Props) {
  const route = await resolveRoute(props), pathname = route.split('?')[0];
  if (['/app/forgot-password', '/app/reset-password'].includes(pathname)) return <PasswordRecoveryPage />;
  if (pathname === '/app/restore-account') return <RestoreAccountPage />;
  if (pathname === '/app/invite') return <WorkspaceInvitePage />;
  if (pathname === '/app/workspaces') return <Workspaces />;
  if (pathname === '/app/site-content') { const data = await getCapture('/app'); if (!data) notFound(); return <ClonePage data={data} requestedRoute={route}><SiteContentPage /></ClonePage>; }
  if (!pathname.startsWith('/app')) {
    const managed = await haloxStore.read(db => readPublicSiteContent(db, pathname));
    if (managed.deleted) notFound();
    const captured = await getCapture(route);
    const shell = managed.content && !managed.captured_fallback ? await getCapture(`/${String(managed.content.locale)}/about`) : null;
    const data = captured || shell; if (!data) notFound();
    return <ClonePage key={route} data={data} requestedRoute={route}>{managed.content && !managed.captured_fallback ? <PublicManagedContent content={managed.content} /> : undefined}</ClonePage>;
  }
  // 표시 모드: original이면 캡처된 원본 화면을 그대로 렌더링하고 라이브 CRUD는 생략한다.
  // 캡처가 없는 상세 경로는 라이브 렌더링으로 되돌아간다(내부 링크 유지).
  const requestedMode = await resolveDisplayMode(pathname);
  if (requestedMode === 'original') {
    const originalData = await getCapture(route);
    if (originalData) return <ClonePage key={route} data={originalData} requestedRoute={route} displayMode="original" />;
  }
  let shellRoute: string | undefined;
  let children;
  if (/^\/app\/keywords(?:\/[^/]+)?$/.test(pathname)) {
    shellRoute = '/app/keywords'; children = <KeywordsPage keywordId={pathname.split('/')[3]} />;
  } else if (pathname === '/app/geo' || /^\/app\/geo\/prompts(?:\/[^/]+)?$/.test(pathname)) {
    shellRoute = '/app/geo/prompts'; children = <PromptsPage overview={pathname === '/app/geo'} promptId={pathname.split('/')[4]} />;
  } else if (/^\/app\/(personas|knowledgehub)(?:\/[^/]+)?$/.test(pathname)) {
    const section = pathname.split('/')[2]; shellRoute = '/app/' + section;
    children = section === 'personas' ? <PersonasPage personaId={pathname.split('/')[3]} /> : <KnowledgePage entityId={pathname.split('/')[3]} />;
  } else if (/^\/app\/factory(?:\/[^/]+)?$/.test(pathname)) {
    shellRoute = '/app/factory'; children = <ContentPage jobId={pathname.split('/')[3]} />;
  }
  if (/^\/app\/optimize(?:\/[^/]+)?$/.test(pathname)) {
    shellRoute = '/app/optimize'; children = <OptimizationPage reviewId={pathname.split('/')[3]} initialJobId={new URLSearchParams(route.split('?')[1]).get('job') || undefined} />;
  }
  if (pathname === '/app/exports' || pathname === '/app/settings' && new URLSearchParams(route.split('?')[1]).get('tab') === 'export') {
    shellRoute = '/app/exports'; children = <ExportsPage initialTab={pathname === '/app/settings' ? 'settings' : 'history'} initialJobId={new URLSearchParams(route.split('?')[1]).get('job') || undefined} />;
  }
  if (/^\/app\/site-audit(?:\/[^/]+)?$/.test(pathname)) {
    shellRoute = '/app/site-audit'; children = <SiteAuditPage scanId={pathname.split('/')[3]} />;
  }
  if (/^\/app\/strategy-map(?:\/[^/]+)?$/.test(pathname)) {
    shellRoute = '/app/strategy-map'; children = <StrategyPage clusterId={pathname.split('/')[3]} />;
  }
  if (pathname === '/app/seo/insights' || pathname === '/app/geo/analysis') {
    shellRoute = pathname; children = <AnalysesPage kind={pathname.includes('/seo/') ? 'seo' : 'geo'} initialTab={new URLSearchParams(route.split('?')[1]).get('tab') || undefined} />;
  }
  const settingsTab = new URLSearchParams(route.split('?')[1]).get('tab');
  if (pathname === '/app/settings' && settingsTab === 'notifications') { shellRoute = '/app'; children = <NotificationsPage />; }
  if (pathname === '/app/settings' && (settingsTab === 'billing' || settingsTab === 'plan')) { shellRoute = '/app'; children = <BillingPage current={settingsTab} />; }
  if (pathname === '/app/settings' && settingsTab === 'credits') { shellRoute = '/app'; children = <CreditsPage />; }
  if (pathname === '/app/settings' && settingsTab === 'integrations') { shellRoute = '/app'; children = <IntegrationsPage />; }
  if (pathname === '/app/settings' && (!settingsTab || settingsTab === 'general')) { shellRoute = '/app'; children = <GeneralSettingsPage />; }
  if (pathname === '/app/settings' && settingsTab === 'earned') { shellRoute = '/app'; children = <EarnedPage />; }
  if (pathname === '/app/settings' && settingsTab === 'api') { shellRoute = '/app'; children = <ApiSettingsPage />; }
  if (pathname === '/app/settings' && settingsTab === 'tags') { shellRoute = '/app'; children = <TagSettingsPage />; }
  if (pathname === '/app/settings' && settingsTab === 'brand-tracking') { shellRoute = '/app'; children = <BrandSettingsPage />; }
  if (pathname === '/app/settings' && (settingsTab === 'workspace' || settingsTab === 'members')) { shellRoute = '/app'; children = <WorkspaceSettingsPage tab={settingsTab} />; }
  if (pathname === '/app/settings' && new URLSearchParams(route.split('?')[1]).get('tab') === 'profile') { shellRoute = '/app'; children = <AccountPage />; }
  if (pathname === '/app/gap') { shellRoute = pathname; children = <GapPage />; }
  if (pathname === '/app/referral') { shellRoute = pathname; children = <ReferralPage />; }
  if (/^\/app\/feedback(?:\/[^/]+)?$/.test(pathname)) { shellRoute = '/app/feedback'; children = <FeedbackPage threadId={pathname.split('/')[3]} support={new URLSearchParams(route.split('?')[1]).get('view') === 'support'} />; }
  if (pathname === '/app/raw-data') { shellRoute = pathname; children = <RawDataPage />; }
  if (pathname === '/app') { shellRoute = '/app'; children = <DashboardPage />; }
  if (pathname === '/app/monitoring') { shellRoute = pathname; children = <MonitoringPage />; }
  if (/^\/app\/reports(?:\/[^/]+)?$/.test(pathname)) { shellRoute = '/app/reports/weekly'; children = <ReportsPage reportId={pathname.split('/')[3] === 'weekly' ? undefined : pathname.split('/')[3]} />; }
  const data = await getCapture(shellRoute || route);
  if (!data) notFound();
  return <ClonePage key={route} data={data} requestedRoute={route} displayMode="live">{children}</ClonePage>;
}
