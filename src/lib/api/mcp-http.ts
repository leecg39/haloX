import { NextResponse } from 'next/server';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { MCP_PROTOCOLS, runMcpRequest } from '@/lib/backend/mcp-service';
import type { Row } from '@/lib/backend/database';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export async function serveMcp(request: Request, options: { legacy?: boolean; tool?: string } = {}) {
  let id: unknown = null;
  const fail = (message: string, status: number) => NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32600, message } }, { status, headers });
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return fail('허용되지 않는 요청 출처입니다.', 403);
    const protocol = request.headers.get('mcp-protocol-version');
    if (protocol && !MCP_PROTOCOLS.includes(protocol)) return fail('지원하지 않는 MCP 프로토콜 버전입니다.', 400);
    const raw = await request.text(); if (Buffer.byteLength(raw) > 150000) return fail('요청 본문은 150KB 이하여야 합니다.', 413);
    const body = JSON.parse(raw || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('단일 JSON 객체 요청이 필요합니다.', 400);
    id = body.id ?? null;
    const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const secret = bearer || request.headers.get('x-api-key') || (options.legacy && typeof body.api_key === 'string' ? body.api_key : '');
    const message: Row = options.tool ? { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: options.tool, arguments: body } } : options.legacy ? { ...body, id: body.id ?? 1 } : body;
    if (!options.legacy && !options.tool && (body.jsonrpc !== '2.0' || typeof body.method !== 'string' || !body.method.startsWith('notifications/') && !['string', 'number'].includes(typeof body.id))) return fail('유효한 JSON-RPC 2.0 요청이 필요합니다.', 400);
    const result = await haloxStore.write(db => runMcpRequest(db, String(secret), message));
    const responseHeaders = { ...headers, ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {}) };
    if (!result.body) return new NextResponse(null, { status: result.status, headers: responseHeaders });
    const error = result.body.error as Row | undefined;
    if (!options.tool && error && ['API_TOOL_FAILED', 'API_CONFLICT'].includes(String((error.data as Row)?.code))) return NextResponse.json({ jsonrpc: '2.0', id: result.body.id, result: { content: [{ type: 'text', text: error.message }], isError: true } }, { status: 200, headers: responseHeaders });
    const response = options.tool && result.status === 200 ? (result.body.result as Row).data : result.body;
    return NextResponse.json(response, { status: result.status, headers: responseHeaders });
  } catch (error) {
    return fail(error instanceof StorageUnavailableError ? error.message : '요청을 처리하지 못했습니다. JSON 형식을 확인해 주세요.', error instanceof StorageUnavailableError ? 503 : 400);
  }
}

export function rejectMcpStream(request: Request) {
  const origin = request.headers.get('origin');
  return new Response(null, { status: origin && origin !== new URL(request.url).origin ? 403 : 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
}
