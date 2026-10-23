import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { readTagSettings, runTagCommand, TagConflictError } from '@/lib/backend/tag-settings';
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : '태그 요청을 처리하지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof TagConflictError ? 409 : error instanceof StorageUnavailableError ? 503 : 400, headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(request: NextRequest) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try {
    const workspace = request.nextUrl.searchParams.get('workspace_id'); if (!workspace) throw new Error('워크스페이스를 선택해 주세요.');
    return NextResponse.json(await haloxStore.read(db => readTagSettings(db, workspace, auth.actor)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try {
    const raw = await request.text(); if (raw.length > 450000) throw new Error('입력 내용이 너무 깁니다.');
    const body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('요청 형식을 확인해 주세요.');
    return NextResponse.json(await haloxStore.write(db => runTagCommand(db, auth.actor, body)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
