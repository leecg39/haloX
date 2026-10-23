import { openAITranslationConfigured } from '@/lib/backend/openai-translation';
import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { EXPORT_TABLES } from '@/lib/api/exports';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth.response) return auth.response;
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: '워크스페이스를 선택해 주세요.' }, { status: 400 });
  try {
    const data = await haloxStore.read(db => {
      db.assertWorkspaceAccess(workspaceId, auth.actor, 'execution');
      const member = db.queryTable('workspace_members', { filters: { workspace_id: `eq.${workspaceId}`, user_id: `eq.${auth.actor}` } }, auth.actor).data[0];
      return { translation_configured: openAITranslationConfigured(), can_manage_connections: ['owner', 'admin'].includes(String(member?.role)), ...Object.fromEntries(EXPORT_TABLES.map(table => [table, db.queryTable(table, { filters: { workspace_id: `eq.${workspaceId}` }, order: 'created_at.desc' }, auth.actor).data])) };
    });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '내보내기를 불러오지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 });
  }
}
