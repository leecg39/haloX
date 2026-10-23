import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { downloadRawData, rawKind, readRawData, readRawDetail } from '@/lib/backend/raw-data-model';
import { rawImportTemplate } from '@/lib/backend/raw-import-format';
import { readRawImportFile } from '@/lib/backend/raw-import-service';
function file(bytes: Uint8Array, filename: string, mime: string) {
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': mime, 'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="halox-raw.${filename.endsWith('.zip') ? 'zip' : 'json'}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}
export async function GET(request: NextRequest) {
  const auth = authenticate(request); if (auth.response) return auth.response;
  const params = request.nextUrl.searchParams, workspace = params.get('workspace_id'); if (!workspace) return NextResponse.json({ error: '워크스페이스를 선택해 주세요.' }, { status: 400 });
  try {
    const kind = rawKind(params.get('kind')), mode = params.get('mode') || 'list';
    if (mode === 'source') { const result = await haloxStore.read(db => readRawImportFile(db, workspace, auth.actor, params.get('batch_id') || '')); return file(result.bytes, result.filename, 'application/json'); }
    if (mode === 'template') { const result = await haloxStore.read(db => rawImportTemplate(db, workspace, auth.actor, kind, params.get('entity_id') || '')); return file(Buffer.from(result), `halox-${kind}-import-template.json`, 'application/json'); }
    if (mode === 'detail') { const result = await haloxStore.read(db => readRawDetail(db, workspace, auth.actor, kind, params.get('record_id') || '', params.get('record_table') || undefined)); return params.get('format') === 'json' ? file(Buffer.from(JSON.stringify(result, null, 2)), `halox-${kind}-record.json`, 'application/json') : NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } }); }
    const filters = JSON.parse(params.get('filters') || '{}');
    if (mode === 'download') { const result = await haloxStore.read(db => downloadRawData(db, workspace, auth.actor, kind, filters)); return file(result.bytes, result.filename, 'application/zip'); }
    if (mode !== 'list') throw new Error('지원하지 않는 원본 자료 작업입니다.');
    return NextResponse.json(await haloxStore.read(db => readRawData(db, workspace, auth.actor, kind, filters)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '원본 자료를 처리하지 못했습니다.' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
