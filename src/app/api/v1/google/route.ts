import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { accountBody } from '@/lib/api/account-http';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { ContentConflictError } from '@/lib/backend/content-model';
import { ExternalServiceError } from '@/lib/backend/public-json';
import { AuthRequiredError } from '@/lib/backend/session';
import { googleView, googleCommand, startGoogleOAuth } from '@/lib/backend/google-service';
const headers = { 'Cache-Control': 'private, no-store' };
export const runtime = 'nodejs';
function errorResponse(error: unknown) {
  const status = error instanceof ExternalServiceError || error instanceof RlsAccessDeniedError || error instanceof AuthRequiredError ? error.status : error instanceof ContentConflictError ? 409 : error instanceof StorageUnavailableError ? 503 : 400;
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Google 연동 요청을 처리하지 못했습니다.' }, { status, headers });
}
export async function GET(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { return NextResponse.json(await haloxStore.read(db => googleView(db, new URL(request.url).searchParams.get('workspace_id') || '', auth.actor)), { headers }); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try {
    if (request.headers.get('origin') && new URL(request.headers.get('origin')!).host !== (request.headers.get('host') || new URL(request.url).host)) throw new RlsAccessDeniedError('같은 사이트에서 요청해 주세요.');
    const input = await accountBody(request);
    const result = input.action === 'connect' ? await startGoogleOAuth(haloxStore, String(input.workspace_id || ''), auth.actor, auth.sessionId!) : await googleCommand(haloxStore, auth.actor, input);
    return NextResponse.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}
