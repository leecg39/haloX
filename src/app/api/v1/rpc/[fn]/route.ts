import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import {
  QuotaExceededError,
  RlsAccessDeniedError,
} from '@/lib/backend/database';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ fn: string }> }
) {
  const { fn } = await context.params;
  const auth = authenticate(req);
  if (auth.response) return auth.response;
  const userId = auth.actor;
  // Quota reservations are part of server-side domain transactions. Allowing
  // clients to release committed reservations would reset their own usage.
  if (['reserve_unit_with_bypass', 'commit_reservation', 'release_reservation'].includes(fn)) {
    return NextResponse.json({ error: '사용량 예약은 서버 작업을 통해서만 변경할 수 있습니다.', code: 'RLS_ACCESS_DENIED' }, { status: 403 });
  }

  try {
    let args: Record<string, unknown> = {};
    const text = await req.text();
    if (text.trim()) {
      args = JSON.parse(text) as Record<string, unknown>;
    }
    const result = await haloxStore.write(db => db.callRpc(fn, args, userId));
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    if (error instanceof RlsAccessDeniedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    if (error instanceof QuotaExceededError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 429 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RPC execution failed' },
      { status: 400 }
    );
  }
}
