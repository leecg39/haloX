import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { AUDIT_TABLES } from '@/lib/api/site-audit';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth.response) return auth.response;
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: '워크스페이스를 선택해 주세요.' }, { status: 400 });
  try {
    const data = await haloxStore.read(db => {
      db.assertWorkspaceMember(workspaceId, auth.actor);
      return Object.fromEntries(AUDIT_TABLES.map(table => [table, db.queryTable(table, { filters: { workspace_id: `eq.${workspaceId}` }, order: 'created_at.desc' }, auth.actor).data]));
    });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '사이트 진단을 불러오지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 });
  }
}
