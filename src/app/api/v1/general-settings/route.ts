import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { ContentConflictError } from '@/lib/backend/content-model';
import { readGeneralSettings, updateGeneralSettings } from '@/lib/backend/general-settings-service';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : '설정을 처리하지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof ContentConflictError ? 409 : error instanceof StorageUnavailableError ? 503 : 400, headers }); }
export async function GET(request: NextRequest) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { const workspace = request.nextUrl.searchParams.get('workspace_id'); if (!workspace) throw new Error('워크스페이스를 선택해 주세요.'); return NextResponse.json(await haloxStore.read(db => readGeneralSettings(db, workspace, auth.actor)), { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { const raw = await request.text(); if (raw.length > 4000) throw new Error('설정 입력이 너무 큽니다.'); const body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('설정 형식을 확인해 주세요.'); return NextResponse.json(await haloxStore.write(db => updateGeneralSettings(db, auth.actor, body)), { headers }); } catch (error) { return failure(error); }
}
