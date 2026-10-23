import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { readExportFile } from '@/lib/backend/export-service';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try {
    const { id } = await context.params;
    const file = await haloxStore.read(db => readExportFile(db, id, auth.actor));
    if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
    return new NextResponse(Buffer.from(String(file.base64), 'base64'), { headers: {
      'Content-Type': String(file.mime_type), 'Content-Length': String(file.byte_size),
      'Content-Disposition': `attachment; filename="content.${String(file.filename).split('.').at(-1)}"; filename*=UTF-8''${encodeURIComponent(String(file.filename)).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '파일을 내려받지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 });
  }
}
