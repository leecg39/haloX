import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { creditView } from '@/lib/backend/credit-service';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { const workspace = new URL(request.url).searchParams.get('workspace_id') || ''; return NextResponse.json(await haloxStore.read(db => creditView(db, workspace, auth.actor)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '크레딧 내역을 불러오지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
