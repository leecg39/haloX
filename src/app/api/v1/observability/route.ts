import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { readDashboard } from '@/lib/backend/observation-model';
import { readMonitoring } from '@/lib/backend/monitor-service';
import { readReports } from '@/lib/backend/report-service';
export async function GET(request: NextRequest) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  const params = request.nextUrl.searchParams, workspace = params.get('workspace_id'), kind = params.get('kind');
  if (!workspace || !['dashboard', 'monitoring', 'reports'].includes(kind || '')) return NextResponse.json({ error: '조회 화면과 워크스페이스를 선택해 주세요.' }, { status: 400 });
  try {
    return NextResponse.json(await haloxStore.read(db => (db.assertWorkspaceAccess(workspace, auth.actor, kind === 'dashboard' ? 'dashboard' : 'monitoring'), kind === 'dashboard' ? readDashboard(db, workspace, auth.actor) : kind === 'monitoring' ? readMonitoring(db, workspace, auth.actor) : readReports(db, workspace, auth.actor, params.get('report_id') || undefined))), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '자료를 불러오지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
