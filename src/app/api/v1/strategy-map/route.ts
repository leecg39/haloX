import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { readStrategyData } from '@/lib/backend/strategy-model';

export async function GET(request: NextRequest) {
  const auth = authenticate(request); if (auth.response) return auth.response;
  const workspace = request.nextUrl.searchParams.get('workspace_id');
  if (!workspace) return NextResponse.json({ error: '워크스페이스를 선택해 주세요.' }, { status: 400 });
  try { return NextResponse.json(await haloxStore.read(db => readStrategyData(db, workspace, auth.actor)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '전략맵을 불러오지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
