import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { readReferral } from '@/lib/backend/referral-service';
import { readFeedback } from '@/lib/backend/feedback-service';
export async function GET(request: NextRequest) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try {
    const p = request.nextUrl.searchParams, kind = p.get('kind');
    if (kind !== 'referral' && kind !== 'feedback') throw new Error('페이지 종류를 확인해 주세요.');
    const result = await haloxStore.read(db => kind === 'referral' ? readReferral(db, auth.actor) : readFeedback(db, auth.actor, p.get('view') || 'mine', p.get('thread_id') || undefined));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '조회 실패' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
