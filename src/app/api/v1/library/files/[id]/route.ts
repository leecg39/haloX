import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  try {
    const file = await haloxStore.read(db => db.readKnowledgeFile(id, auth.actor));
    if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
    return new Response(Buffer.from(String(file.base64), 'base64'), { headers: {
      'Content-Type': String(file.mime_type), 'Content-Length': String(file.byte_size),
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(String(file.filename))}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '파일을 불러오지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 });
  }
}
