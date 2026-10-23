import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchPublicDocument, isPublicAddress, MAX_DOCUMENT_BYTES, parsePublicDocument, publicDocumentUrl, requestPinnedDocument } from './public-document.ts';

describe('public content import', () => {
  it('rejects non-public IPs, credentials, alternative ports and encoded loopback addresses', () => {
    for (const address of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.31.1.1', '192.168.1.2', '169.254.169.254', '100.64.1.1', '224.1.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPublicAddress(address), false, address);
    for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true);
    for (const url of ['file:///etc/passwd', 'ftp://example.com/a', 'http://localhost', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'https://example.com:9000', 'https://user:pass@example.com']) assert.throws(() => publicDocumentUrl(url));
  });
  it('validates every DNS answer and every redirect before contacting another host', async () => {
    let calls = 0;
    await assert.rejects(fetchPublicDocument('https://public.example', { resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], request: async () => { calls++; throw new Error('must not call'); } }), /내부 네트워크/);
    assert.equal(calls, 0);
    await assert.rejects(fetchPublicDocument('https://public.example', { resolve: async host => [{ address: host === 'public.example' ? '8.8.8.8' : '10.0.0.1', family: 4 }], request: async () => { calls++; return { status: 302, location: 'https://internal.example/secret', contentType: '', body: Buffer.alloc(0) }; } }), /내부 네트워크/);
    assert.equal(calls, 1);
  });
  it('pins the resolved address, extracts only readable content and follows a bounded public redirect', async () => {
    const addresses: string[] = [], hosts: string[] = [];
    const result = await fetchPublicDocument('https://public.example/start', { resolve: async () => [{ address: '8.8.8.8', family: 4 }], request: async (url, address) => {
      addresses.push(address.address); hosts.push(url.href);
      return hosts.length === 1 ? { status: 302, location: '/final', contentType: '', body: Buffer.alloc(0) } : { status: 200, contentType: 'text/html', body: Buffer.from('<html><title>원문 제목</title><meta name="description" content="원문 검색 설명"><nav>내비게이션</nav><article><h1>안내</h1><p>사용자가 읽는 내용</p><h2>근거</h2><p>출처 문구</p><script>secret()</script></article></html>') };
    } });
    assert.deepEqual(addresses, ['8.8.8.8', '8.8.8.8']); assert.equal(result.url, 'https://public.example/final'); assert.equal(result.title, '원문 제목'); assert.equal(result.meta_description, '원문 검색 설명'); assert.match(result.content_md, /## 근거/); assert.doesNotMatch(result.content_md, /secret|내비게이션/);
  });
  it('bounds redirects, DNS duration, bytes and decoded text size', async () => {
    const resolve = async () => [{ address: '8.8.8.8', family: 4 }]; let calls = 0;
    await assert.rejects(fetchPublicDocument('https://example.com', { resolve, request: async () => { calls++; return { status: 302, location: '/again', contentType: '', body: Buffer.alloc(0) }; } }), /리디렉션/); assert.equal(calls, 4);
    await assert.rejects(fetchPublicDocument('https://example.com', { timeoutMs: 10, resolve: () => new Promise(() => {}), request: async () => { throw new Error('must not call'); } }), /시간이 초과/);
    assert.throws(() => parsePublicDocument(Buffer.alloc(MAX_DOCUMENT_BYTES + 1), 'text/plain', 'https://example.com'), /2MB/);
    assert.throws(() => parsePublicDocument(Buffer.from('a'.repeat(100001)), 'text/plain', 'https://example.com'), /100,000/);
    assert.throws(() => parsePublicDocument(Buffer.from([0xff, 0xfe]), 'text/plain', 'https://example.com'), /UTF-8/);
  });
  it('the real HTTP transport uses its pinned lookup and rejects oversized streams, encoded bodies and non-text responses', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/oversize') { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end(Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 'a')); }
      else if (request.url === '/binary') { response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); response.end('no'); }
      else if (request.url === '/encoded') { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); response.end('compressed'); }
      else { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('원문 전송'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const request = (pathname: string) => requestPinnedDocument(new URL(`http://does-not-resolve.invalid:${port}${pathname}`), { address: '127.0.0.1', family: 4 }, AbortSignal.timeout(2000));
    try {
      assert.equal((await request('/ok')).body.toString(), '원문 전송');
      await assert.rejects(request('/oversize'), /2MB|중단/); await assert.rejects(request('/binary'), /HTML 또는 텍스트/); await assert.rejects(request('/encoded'), /압축 응답/);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
