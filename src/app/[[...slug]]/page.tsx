import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCapture } from '@/lib/content';
import ClonePage from '@/components/ClonePage';
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
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
async function resolveRoute(props: Props) {
  const { slug = [] } = await props.params;
  const query = await props.searchParams, q = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) q.set(key, Array.isArray(value) ? value[0] : value);
  return '/' + slug.join('/') + (q.size ? '?' + q : '');
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const route = await resolveRoute(props), pathname = route.split('?')[0];
  const portalTitle = pathname === '/app/referral' ? '추천 프로그램' : /^\/app\/feedback(?:\/[^/]+)?$/.test(pathname) ? '피드백' : undefined;
  if (portalTitle) return { title: `${portalTitle} | HaloX`, robots: { index: false, follow: false } };
  const data = await getCapture(route);
  return { title: data?.title || 'HaloX', robots: { index: false, follow: false } };
}
export default async function Page(props: Props) {
  const route = await resolveRoute(props), pathname = route.split('?')[0];
  if (pathname === '/app/workspaces') return <Workspaces />;
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
  if (pathname === '/app/gap') { shellRoute = pathname; children = <GapPage />; }
  if (pathname === '/app/referral') { shellRoute = pathname; children = <ReferralPage />; }
  if (/^\/app\/feedback(?:\/[^/]+)?$/.test(pathname)) { shellRoute = '/app/feedback'; children = <FeedbackPage threadId={pathname.split('/')[3]} support={new URLSearchParams(route.split('?')[1]).get('view') === 'support'} />; }
  if (pathname === '/app/raw-data') { shellRoute = pathname; children = <RawDataPage />; }
  if (pathname === '/app') { shellRoute = '/app'; children = <DashboardPage />; }
  if (pathname === '/app/monitoring') { shellRoute = pathname; children = <MonitoringPage />; }
  if (/^\/app\/reports(?:\/[^/]+)?$/.test(pathname)) { shellRoute = '/app/reports/weekly'; children = <ReportsPage reportId={pathname.split('/')[3] === 'weekly' ? undefined : pathname.split('/')[3]} />; }
  const data = await getCapture(shellRoute || route);
  if (!data) notFound();
  return <ClonePage key={route} data={data} requestedRoute={route}>{children}</ClonePage>;
}
