import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { analysisKind, readAnalysisData } from '@/lib/backend/analysis-model';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  const workspace = request.nextUrl.searchParams.get('workspace_id');
  if (!workspace) return NextResponse.json({ error: '워크스페이스를 선택해 주세요.' }, { status: 400 });
  try {
    const kind = analysisKind(request.nextUrl.searchParams.get('kind')), filters = JSON.parse(request.nextUrl.searchParams.get('filters') || '{}');
    return NextResponse.json(await haloxStore.read(db => (db.assertWorkspaceAccess(workspace, auth.actor, 'analysis'), readAnalysisData(db, workspace, auth.actor, kind, filters))), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '분석을 불러오지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
