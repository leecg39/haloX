import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { EarnedConflictError, readEarned, runEarnedCommand } from '@/lib/backend/earned-service';
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : '등록 URL 요청을 처리하지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof EarnedConflictError ? 409 : error instanceof StorageUnavailableError ? 503 : 400, headers: { 'Cache-Control': 'no-store' } }); }
export async function GET(request: NextRequest) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { const p = request.nextUrl.searchParams, workspace = p.get('workspace_id'); if (!workspace) throw new Error('워크스페이스를 선택해 주세요.'); const period = Object.fromEntries(['start', 'end'].flatMap(key => p.has(key) ? [[key, p.get(key)!]] : [])); return NextResponse.json(await haloxStore.read(db => readEarned(db, workspace, auth.actor, period)), { headers: { 'Cache-Control': 'private, no-store' } }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { const raw = await request.text(); if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('입력 내용이 너무 큽니다.'); const body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('요청 형식을 확인해 주세요.'); const result = body.action === 'preview' ? await haloxStore.read(db => runEarnedCommand(db, auth.actor, body)) : await haloxStore.write(db => runEarnedCommand(db, auth.actor, body)); return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } }); } catch (error) { return failure(error); }
}
