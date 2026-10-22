import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_USER_ID,
  haloxDb,
  QuotaExceededError,
  RlsAccessDeniedError,
} from '@/lib/backend/database';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ name: string }> }
) {
  const { name } = await context.params;
  const userId = req.headers.get('x-halox-user-id') || DEFAULT_USER_ID;

  try {
    let payload: Record<string, unknown> = {};
    const text = await req.text();
    if (text.trim()) {
      payload = JSON.parse(text) as Record<string, unknown>;
    }
    const result = await haloxDb.invokeEdgeFunction(name, payload, userId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof RlsAccessDeniedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    if (error instanceof QuotaExceededError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 429 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Edge function failed' },
      { status: 400 }
    );
  }
}
