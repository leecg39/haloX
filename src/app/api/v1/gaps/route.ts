import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { readGapData } from '@/lib/backend/gap-model';

export async function GET(request: NextRequest) {
  const auth = authenticate(request); if (auth.response) return auth.response;
  const workspace = request.nextUrl.searchParams.get('workspace_id');
  if (!workspace) return NextResponse.json({ error: '워크스페이스를 선택해 주세요.' }, { status: 400 });
  try { const filters = JSON.parse(request.nextUrl.searchParams.get('filters') || '{}'); return NextResponse.json(await haloxStore.read(db => readGapData(db, workspace, auth.actor, filters)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '기회 분석을 불러오지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
