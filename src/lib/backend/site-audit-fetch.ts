import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { isPublicAddress, publicDocumentUrl } from './public-document.ts';

export const AUDIT_AGENT = 'HaloXAudit';
type Address = { address: string; family: number };
export type AuditResponse = { url: string; status: number; content_type: string; body: string; robots_header: string; redirects: string[] };
type RawResponse = { status: number; type: string; body: Buffer; location?: string; robots: string };
export type AuditFetcher = (url: string, allowed: (url: string) => boolean) => Promise<AuditResponse>;
const MAX_BYTES = 2 * 1024 * 1024;
export async function requestAuditPage(url: URL, address: Address, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const pinned: LookupFunction = (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family);
    const request = (url.protocol === 'https:' ? https : http).get(url, { signal, agent: false, lookup: pinned, family: address.family, maxHeaderSize: 16384, headers: { 'User-Agent': `${AUDIT_AGENT}/1.0`, Accept: 'text/html, text/plain', 'Accept-Encoding': 'identity' } }, response => {
      const status = response.statusCode || 0, type = String(response.headers['content-type'] || '').toLowerCase(), robots = String(response.headers['x-robots-tag'] || '').slice(0, 1000);
      const finish = (body = Buffer.alloc(0)) => resolve({ status, type, robots, location: response.headers.location, body });
      if (status < 200 || status >= 300) { response.destroy(); finish(); return; }
      if (!/^text\/(html|plain)(?:;|$)/.test(type)) { response.destroy(); finish(); return; }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(new Error('압축된 응답을 읽을 수 없습니다.')); return; }
      if (Number(response.headers['content-length'] || 0) > MAX_BYTES) { response.destroy(); reject(new Error('페이지가 2MiB 제한을 초과했습니다.')); return; }
      let size = 0; const chunks: Buffer[] = [];
      response.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) response.destroy(new Error('페이지가 2MiB 제한을 초과했습니다.')); else chunks.push(Buffer.from(chunk)); });
      response.on('end', () => finish(Buffer.concat(chunks)));
      response.on('error', () => reject(new Error('페이지 응답이 중단되었거나 크기 제한을 초과했습니다.')));
      response.on('aborted', () => reject(new Error('페이지 응답이 중단되었습니다.')));
    });
    request.on('error', () => reject(new Error('페이지에 연결하지 못했습니다.')));
  });
}
export async function fetchAuditPage(value: string, allowed: (url: string) => boolean, dependencies: { resolve?: (host: string) => Promise<Address[]>; request?: typeof requestAuditPage; timeoutMs?: number } = {}): Promise<AuditResponse> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8000);
  const interrupted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('페이지 요청 시간이 초과되었습니다.')), { once: true }));
  try { return await Promise.race([(async () => {
    let url = publicDocumentUrl(value); const redirects: string[] = [];
    for (let hop = 0; hop <= 3; hop++) {
      if (!allowed(url.href)) throw new Error('리디렉션 또는 URL이 허용한 수집 범위/robots.txt 밖에 있습니다.');
      const hostname = url.hostname.replace(/^\[|\]$/g, ''), addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await (dependencies.resolve || (host => lookup(host, { all: true })))(hostname);
      controller.signal.throwIfAborted();
      if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) throw new Error('내부 네트워크로 연결할 수 없습니다.');
      const response = await (dependencies.request || requestAuditPage)(url, addresses[0], controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location || hop === 3) throw new Error('리디렉션 횟수 또는 대상 주소를 확인해 주세요.');
        redirects.push(url.href); url = publicDocumentUrl(new URL(response.location, url).href); continue;
      }
      if (response.body.length > MAX_BYTES) throw new Error('페이지가 2MiB 제한을 초과했습니다.');
      let body: string; try { body = new TextDecoder('utf-8', { fatal: true }).decode(response.body); } catch { throw new Error('UTF-8 페이지만 진단할 수 있습니다.'); }
      return { url: url.href, status: response.status, content_type: response.type, robots_header: response.robots, body, redirects };
    }
    throw new Error('페이지를 수집하지 못했습니다.');
  })(), interrupted]); } finally { clearTimeout(timer); }
}
