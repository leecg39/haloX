import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import {
  haloxDb,
  QuotaExceededError,
  RlsAccessDeniedError,
} from '@/lib/backend/database';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ fn: string }> }
) {
  const { fn } = await context.params;
  const auth = authenticate(req);
  if (auth.response) return auth.response;
  const userId = auth.actor;

  try {
    let args: Record<string, unknown> = {};
    const text = await req.text();
    if (text.trim()) {
      args = JSON.parse(text) as Record<string, unknown>;
    }
    const result = haloxDb.callRpc(fn, args, userId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
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
