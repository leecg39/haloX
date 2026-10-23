import { lookup } from 'node:dns/promises';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { isPublicAddress, publicDocumentUrl } from './public-document.ts';

export type JsonRequest = { method: 'GET' | 'POST'; authorization: string; body?: unknown };
export type JsonResponse = { status: number; body: unknown };
type Address = { address: string; family: number };
export type JsonTransport = (url: URL, address: Address, options: JsonRequest, signal: AbortSignal) => Promise<JsonResponse>;
const MAX_BYTES = 2 * 1024 * 1024;

export class ExternalServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly uncertain: boolean;
  constructor(message: string, code = 'EXTERNAL_REQUEST_FAILED', status = 502, uncertain = true) {
    super(message); this.code = code; this.status = status; this.uncertain = uncertain;
  }
}

/** Credential-bearing requests never follow redirects or repeat DNS resolution. */
export const requestPinnedJson: JsonTransport = async (url, address, options, signal) => {
  const payload = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
  if (payload && payload.byteLength > MAX_BYTES) throw new ExternalServiceError('전송할 내용이 너무 큽니다.', 'REQUEST_TOO_LARGE', 400, false);
  return new Promise((resolve, reject) => {
    const pinned: LookupFunction = (_host, lookupOptions, callback) => lookupOptions.all ? callback(null, [address]) : callback(null, address.address, address.family);
    const request = https.request(url, { method: options.method, agent: false, lookup: pinned, family: address.family, signal, maxHeaderSize: 16384,
      headers: { Authorization: options.authorization, Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'HaloX-Exports/1.0', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.byteLength) } : {}) },
    }, response => {
      const status = response.statusCode || 0;
      if (status < 200 || status >= 300) { response.destroy(); resolve({ status, body: null }); return; }
      if (!/^application\/json(?:;|$)/i.test(String(response.headers['content-type'])) || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity' || Number(response.headers['content-length'] || 0) > MAX_BYTES) {
        response.destroy(); reject(new ExternalServiceError('외부 서비스의 응답 형식을 확인할 수 없습니다.')); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) response.destroy(new Error('Response too large')); else chunks.push(Buffer.from(chunk)); });
      response.on('end', () => { try { resolve({ status, body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }); } catch { reject(new ExternalServiceError('외부 서비스의 응답을 읽을 수 없습니다.')); } });
      response.on('error', () => reject(new ExternalServiceError('외부 서비스의 응답이 중단되었습니다.')));
      response.on('aborted', () => reject(new ExternalServiceError('외부 서비스의 응답이 중단되었습니다.')));
    });
    request.on('error', () => reject(new ExternalServiceError('외부 서비스의 요청 결과를 확인할 수 없습니다.')));
    request.end(payload);
  });
};

export async function publicJsonRequest(value: string, options: JsonRequest, dependencies: { resolve?: (host: string) => Promise<Address[]>; request?: JsonTransport; timeoutMs?: number } = {}): Promise<JsonResponse> {
  const url = publicDocumentUrl(value);
  if (url.protocol !== 'https:') throw new ExternalServiceError('외부 연결은 공개 HTTPS 주소만 지원합니다.', 'INVALID_SERVICE_URL', 400, false);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 10000);
  const interrupted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new ExternalServiceError('외부 서비스 응답 시간이 초과되었습니다.')), { once: true }));
  try {
    return await Promise.race([(async () => {
      const host = url.hostname.replace(/^\[|\]$/g, ''), addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await (dependencies.resolve || (name => lookup(name, { all: true })))(host);
      controller.signal.throwIfAborted();
      if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new ExternalServiceError('내부 네트워크로 연결할 수 없습니다.', 'INVALID_SERVICE_URL', 400, false);
      return await (dependencies.request || requestPinnedJson)(url, addresses[0], options, controller.signal);
    })(), interrupted]);
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    throw new ExternalServiceError('외부 서비스에 연결하지 못했습니다.');
  } finally { clearTimeout(timeout); }
}
