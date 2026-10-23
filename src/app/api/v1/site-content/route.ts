import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { readPublicSiteContent, readSiteContentAdmin, runSiteContentCommand } from '@/lib/backend/site-content-service';
export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get('admin') === '1') { const auth = await authenticate(request); if (auth.response) return auth.response; return NextResponse.json(await haloxStore.read(db => readSiteContentAdmin(db, auth.actor)), { headers: { 'Cache-Control': 'private, no-store' } }); }
    const route = request.nextUrl.searchParams.get('route') || ''; return NextResponse.json(await haloxStore.read(db => readPublicSiteContent(db, route)), { headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '조회 실패' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
export async function POST(request: NextRequest) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { const body = await request.json(); const result = await haloxStore.write(db => runSiteContentCommand(db, auth.actor, String(body.action || ''), body)); return NextResponse.json(result); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '저장 실패' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : /변경되었습니다/.test(error instanceof Error ? error.message : '') ? 409 : 400 }); }
}
