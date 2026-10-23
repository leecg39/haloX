import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { accountBody } from '@/lib/api/account-http';
import { billingCommand, billingView } from '@/lib/backend/billing-service';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { ExternalServiceError } from '@/lib/backend/public-json';
import { ContentConflictError } from '@/lib/backend/content-model';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  const status = error instanceof ExternalServiceError || error instanceof RlsAccessDeniedError ? error.status : error instanceof ContentConflictError ? 409 : error instanceof StorageUnavailableError ? 503 : 400;
  return NextResponse.json({ error: error instanceof Error ? error.message : '결제 요청을 처리하지 못했습니다.', ...('code' in Object(error) ? { code: (error as { code?: string }).code } : {}) }, { status, headers });
}
export async function GET(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { return NextResponse.json(await haloxStore.read(db => billingView(db, new URL(request.url).searchParams.get('workspace_id') || '', auth.actor)), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try {
    if (request.headers.get('origin') && new URL(request.headers.get('origin')!).host !== (request.headers.get('host') || new URL(request.url).host)) throw new RlsAccessDeniedError('같은 사이트에서 요청해 주세요.');
    return NextResponse.json(await billingCommand(haloxStore, auth.actor, await accountBody(request)), { headers });
  } catch (error) { return failure(error); }
}
