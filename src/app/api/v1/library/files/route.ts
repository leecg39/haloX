import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { MAX_LIBRARY_FILE_BYTES } from '@/lib/api/library';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';

/** Bound multipart bytes before parsing; a missing Content-Length is not a bypass. */
export async function POST(request: NextRequest) {
  const auth = authenticate(request);
  if (auth.response) return auth.response;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('파일을 선택해 주세요.');
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_LIBRARY_FILE_BYTES + 64 * 1024) { await reader.cancel(); return NextResponse.json({ error: '파일 크기는 5MB 이하로 제한됩니다.' }, { status: 413 }); }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks);
    const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('파일을 선택해 주세요.');
    const workspaceId = String(form.get('workspace_id') || '');
    const entityId = String(form.get('knowledge_entity_id') || '');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const source = await haloxStore.write(db => db.uploadKnowledgeFile(workspaceId, entityId, String(form.get('title') || ''), file.name, bytes, auth.actor));
    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '업로드하지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 });
  }
}
