import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { reportDownload } from '@/lib/backend/report-service';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request); if (auth.response) return auth.response;
  try {
    const { id } = await context.params;
    const file = await haloxStore.read(db => reportDownload(db, id, auth.actor, request.nextUrl.searchParams.get('format') || 'json'));
    if (!file) return NextResponse.json({ error: '리포트를 찾을 수 없습니다.' }, { status: 404 });
    return new NextResponse(file.body, { headers: { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '다운로드 실패' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
