import type { Row } from './database.ts';
import { publicDocumentUrl } from './public-document.ts';
import { publicJsonRequest, ExternalServiceError } from './public-json.ts';
import { validateTranslationBody } from './translation-model.ts';

export type WordPressCredentials = { site_url: string; username: string; password: string };
export type WordPressPost = { id: number; url: string; status: string };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function wordpressSiteUrl(value: string) {
  const url = publicDocumentUrl(value);
  if (url.protocol !== 'https:' || url.search || /[%\\]/.test(url.pathname) || value.includes('#')) throw new Error('WordPress 설치 경로의 공개 HTTPS 주소를 입력해 주세요.');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url.href;
}

/** Explicit, escaped HTML preserves paragraphs/headings without executing raw markup. */
export function wordpressContent(source: Row) {
  const body = validateTranslationBody(source); let fenced = false;
  const lines = body.content_md.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return ''; }
    const heading = !fenced && line.match(/^(#{1,6})\s+(.+)$/);
    return heading ? `<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>` : line ? `<p>${escape(line)}</p>` : '';
  });
  return { title: escape(body.title), content: lines.join('\n'), excerpt: escape(body.meta_description) };
}

export function createWordPressClient(request = publicJsonRequest) {
  async function send(credentials: WordPressCredentials, path: string, body?: Row) {
    const url = new URL('wp-json/wp/v2/' + path, wordpressSiteUrl(credentials.site_url));
    const response = await request(url.href, { method: body ? 'POST' : 'GET', authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64'), body });
    if (response.status < 200 || response.status >= 300) throw new ExternalServiceError(`WordPress가 요청을 거절했습니다 (HTTP ${response.status}).`, 'WORDPRESS_REJECTED', 502, !(response.status >= 400 && response.status < 500));
    return response.body;
  }
  function post(value: unknown, credentials: WordPressCredentials): WordPressPost {
    const row = value as Row;
    if (!row || !Number.isSafeInteger(row.id) || Number(row.id) < 1 || typeof row.link !== 'string' || !['draft', 'publish', 'pending', 'private', 'future'].includes(String(row.status))) throw new ExternalServiceError('WordPress 게시 결과를 확인할 수 없습니다.');
    let url: URL;
    try { url = new URL(row.link); if (url.origin !== new URL(credentials.site_url).origin || url.username || url.password) throw new Error(); } catch { throw new ExternalServiceError('WordPress 게시 주소를 확인할 수 없습니다.'); }
    return { id: Number(row.id), status: String(row.status), url: url.href };
  }
  return {
    async verify(credentials: WordPressCredentials) {
      const user = await send(credentials, 'users/me?context=edit&_fields=id,name,capabilities') as Row;
      if (!user || !Number.isSafeInteger(user.id) || Number(user.id) < 1 || (user.capabilities as Row)?.edit_posts !== true) throw new ExternalServiceError('WordPress에서 글을 작성할 수 있는 계정이 필요합니다.', 'WORDPRESS_PERMISSION', 400, false);
      return { remote_user_id: user.id, can_publish: (user.capabilities as Row).publish_posts === true };
    },
    async publish(credentials: WordPressCredentials, source: Row, status: 'draft' | 'publish', slug: string) {
      return post(await send(credentials, 'posts', { ...wordpressContent(source), status, slug, comment_status: 'closed', ping_status: 'closed' }), credentials);
    },
    async find(credentials: WordPressCredentials, slug: string) {
      const rows = await send(credentials, 'posts?' + new URLSearchParams({ slug, context: 'edit', status: 'draft,publish,pending,private,future', per_page: '2', _fields: 'id,link,status,slug' })) as Row[];
      if (!Array.isArray(rows) || rows.length > 1) throw new ExternalServiceError('WordPress 게시 이력을 확인할 수 없습니다.');
      return rows.length === 1 && rows[0].slug === slug ? post(rows[0], credentials) : null;
    },
  };
}
