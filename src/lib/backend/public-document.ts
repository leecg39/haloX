import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { load } from 'cheerio';
import { MAX_CONTENT_LENGTH } from '../api/content.ts';

export type ImportedDocument = { title: string; content_md: string; meta_title: string; meta_description: string; url: string; fetched_at: string };
type Address = { address: string; family: number };
type DocumentResponse = { status: number; location?: string; contentType: string; body: Buffer };
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const excluded = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) excluded.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) excluded.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !excluded.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !excluded.check(address, 'ipv6');
}

export function publicDocumentUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('올바른 공개 URL을 입력해 주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 2000) throw new Error('표준 포트의 공개 http/https URL만 가져올 수 있습니다.');
  url.hash = '';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (isIP(host) && !isPublicAddress(host))) throw new Error('내부 네트워크 주소는 가져올 수 없습니다.');
  return url;
}

/** The socket uses the exact validated address; DNS is never repeated by the HTTP client. */
export async function requestPinnedDocument(url: URL, address: Address, signal: AbortSignal): Promise<DocumentResponse> {
  return new Promise((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family);
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      agent: false, lookup: pinnedLookup, family: address.family, signal, maxHeaderSize: 16 * 1024,
      headers: { Accept: 'text/html, text/plain, text/markdown', 'Accept-Encoding': 'identity', 'User-Agent': 'HaloX-Content-Import/1.0' },
    }, response => {
      const status = response.statusCode || 0, contentType = String(response.headers['content-type'] || '').toLowerCase();
      if ([301, 302, 303, 307, 308].includes(status)) { response.destroy(); resolve({ status, contentType, location: response.headers.location, body: Buffer.alloc(0) }); return; }
      if (status < 200 || status >= 300) { response.destroy(); reject(new Error(`원문 서버가 HTTP ${status}을 반환했습니다.`)); return; }
      if (!/^text\/(html|plain|markdown)(?:;|$)/.test(contentType)) { response.destroy(); reject(new Error('HTML 또는 텍스트 페이지를 입력해 주세요.')); return; }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(new Error('압축 응답을 지원하지 않는 원문입니다. 본문을 직접 입력해 주세요.')); return; }
      if (Number(response.headers['content-length'] || 0) > MAX_DOCUMENT_BYTES) { response.destroy(); reject(new Error('원문은 2MB 이하여야 합니다.')); return; }
      let size = 0; const chunks: Buffer[] = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_DOCUMENT_BYTES) { response.destroy(new Error('원문은 2MB 이하여야 합니다.')); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks) }));
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('원문 다운로드가 중단되었습니다.')));
    });
    req.on('error', reject);
  });
}

export function parsePublicDocument(body: Buffer, contentType: string, url: string): ImportedDocument {
  if (body.length > MAX_DOCUMENT_BYTES) throw new Error('원문은 2MB 이하여야 합니다.');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { throw new Error('UTF-8 원문만 가져올 수 있습니다. 본문을 직접 입력해 주세요.'); }
  let title = new URL(url).hostname, content = source, description = '';
  if (contentType.startsWith('text/html')) {
    const $ = load(source);
    title = $('title').first().text().trim() || $('h1').first().text().trim() || title;
    description = $('meta[name=description]').first().attr('content')?.trim() || '';
    $('script,style,noscript,iframe,svg,nav,header,footer,form,[hidden],[aria-hidden="true"]').remove();
    const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
    root.find('h1,h2,h3,h4,h5,h6').each((_index, el) => { $(el).replaceWith(`\n\n${'#'.repeat(Number(el.tagName.slice(1)))} ${$(el).text().trim()}\n\n`); });
    root.find('br').replaceWith('\n');
    root.find('p,div,section,li,pre,tr').each((_index, el) => { $(el).append('\n\n'); });
    content = root.text().replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (!content.trim() || content.length > MAX_CONTENT_LENGTH) throw new Error('가져온 본문은 1~100,000자여야 합니다. JavaScript 전용 페이지는 본문을 직접 입력해 주세요.');
  return { title: title.slice(0, 200), content_md: content, meta_title: title.slice(0, 200), meta_description: description.slice(0, 1000), url, fetched_at: new Date().toISOString() };
}

export async function fetchPublicDocument(value: string, dependencies: {
  resolve?: (host: string) => Promise<Address[]>;
  request?: typeof requestPinnedDocument;
  timeoutMs?: number;
} = {}): Promise<ImportedDocument> {
  const resolve = dependencies.resolve || (host => lookup(host, { all: true })), request = dependencies.request || requestPinnedDocument;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8000);
  const interrupted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('원문 요청 시간이 초과되었습니다.')), { once: true }));
  try {
    return await Promise.race([(async () => {
      let url = publicDocumentUrl(value);
      for (let hop = 0; hop <= 3; hop++) {
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
        controller.signal.throwIfAborted();
        if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('내부 네트워크 주소는 가져올 수 없습니다.');
        const response = await request(url, addresses[0], controller.signal);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.location || hop === 3) throw new Error('원문 리디렉션을 완료하지 못했습니다.');
          url = publicDocumentUrl(new URL(response.location, url).href); continue;
        }
        return parsePublicDocument(response.body, response.contentType, url.href);
      }
      throw new Error('원문을 가져오지 못했습니다.');
    })(), interrupted]);
  } finally { clearTimeout(timeout); }
}
