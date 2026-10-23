import { ExternalServiceError } from './public-json.ts';
import type { Row } from './database.ts';

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly'];
export const GOOGLE_PAGE_SIZE = 1000;
export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type GoogleTokens = { access_token: string; refresh_token?: string; expires_at: number; scope?: string };
export type GoogleResources = { sites: { id: string; name: string }[]; properties: { id: string; name: string }[] };
export type GoogleReport = { rows: Row[]; more: boolean; metadata: Row };
export const GOOGLE_TABLES = ['gsc_daily_totals', 'gsc_daily_keywords', 'gsc_daily_pages', 'ga4_page_stats'] as const;
export type GoogleTable = typeof GOOGLE_TABLES[number];
export type GoogleClient = ReturnType<typeof createGoogleClient>;
const fail = (message: string, code = 'GOOGLE_REQUEST_FAILED', status = 502) => new ExternalServiceError(message, code, status, false);
export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) throw fail('서버의 Google OAuth 설정이 필요합니다.', 'GOOGLE_NOT_CONFIGURED', 503);
  let uri: URL; try { uri = new URL(GOOGLE_REDIRECT_URI); } catch { throw fail('Google 콜백 주소 설정을 확인해 주세요.', 'GOOGLE_NOT_CONFIGURED', 503); }
  if ((uri.protocol !== 'https:' && !(uri.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(uri.hostname))) || uri.username || uri.password || uri.search || uri.hash || uri.pathname !== '/api/v1/google/callback') throw fail('Google 콜백 주소 설정을 확인해 주세요.', 'GOOGLE_NOT_CONFIGURED', 503);
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_REDIRECT_URI };
}
export function googleReady() { try { googleConfig(); return true; } catch { return false; } }
const list = (value: unknown): Row[] => value === undefined ? [] : Array.isArray(value) && value.every(row => row && typeof row === 'object' && !Array.isArray(row)) ? value : (() => { throw fail('Google 응답 형식이 올바르지 않습니다.'); })();
const number = (value: unknown) => { const n = Number(value); if (value == null || !Number.isFinite(n) || n < 0) throw fail('Google 측정값 형식이 올바르지 않습니다.'); return n; };
const text = (value: unknown, max = 8192) => { if (typeof value !== 'string' || value.length > max) throw fail('Google 응답 형식이 올바르지 않습니다.'); return value; };
export function googleDate(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('날짜 형식을 확인해 주세요.'); return value; }

/** Only fixed Google origins. No redirect following, response/token logging or client-supplied URLs. */
export function createGoogleClient(fetcher: typeof fetch = fetch) {
  async function request(url: string, token?: string, body?: Row | URLSearchParams): Promise<Row> {
    const parsed = new URL(url);
    if (!['https://oauth2.googleapis.com', 'https://openidconnect.googleapis.com', 'https://www.googleapis.com', 'https://analyticsadmin.googleapis.com', 'https://analyticsdata.googleapis.com'].includes(parsed.origin)) throw fail('지원하지 않는 Google API 주소입니다.');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json' } : {}) }, ...(body ? { body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) } : {}) });
      const reader = response.body?.getReader(); let result = '', size = 0; const decoder = new TextDecoder();
      if (reader) for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4_000_000) { await reader.cancel(); throw fail('Google 응답이 너무 큽니다. 기간을 줄여 주세요.'); } result += decoder.decode(value, { stream: true }); }
      let json: Row; try { json = JSON.parse(result + decoder.decode()); } catch { throw fail('Google 응답을 읽지 못했습니다.'); }
      if (!response.ok) {
        if (response.status === 401 || json.error === 'invalid_grant') throw fail('Google 인증이 만료되었거나 철회되었습니다. 연결을 해제한 뒤 다시 연결해 주세요.', 'GOOGLE_REAUTHORIZE', 401);
        if (response.status === 403) throw fail('Google 접근 권한 또는 API 활성화 설정을 확인해 주세요.', 'GOOGLE_FORBIDDEN', 403);
        if (response.status === 429) throw fail('Google 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.', 'GOOGLE_RATE_LIMIT', 429);
        throw fail('Google 요청을 처리하지 못했습니다. 설정과 선택한 속성을 확인해 주세요.');
      }
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw fail('Google 응답 형식이 올바르지 않습니다.');
      return json;
    } catch (error) { if (error instanceof ExternalServiceError) throw error; throw fail('Google 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    finally { clearTimeout(timeout); }
  }
  async function token(config: GoogleConfig, values: Record<string, string>): Promise<GoogleTokens> {
    const row = await request('https://oauth2.googleapis.com/token', undefined, new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...values }));
    if (row.token_type !== 'Bearer' || !row.access_token || number(row.expires_in) < 1) throw fail('Google 인증 응답을 확인하지 못했습니다.');
    return { access_token: text(row.access_token), ...(row.refresh_token ? { refresh_token: text(row.refresh_token) } : {}), expires_at: Date.now() + number(row.expires_in) * 1000, ...(row.scope ? { scope: text(row.scope) } : {}) };
  }
  return {
    exchange: (code: string, config: GoogleConfig) => token(config, { code, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }),
    refresh: (refreshToken: string, config: GoogleConfig) => token(config, { refresh_token: refreshToken, grant_type: 'refresh_token' }),
    async identity(accessToken: string) {
      const row = await request('https://openidconnect.googleapis.com/v1/userinfo', accessToken);
      if (row.email_verified !== true || !row.sub || !row.email) throw fail('확인된 Google 계정 이메일이 필요합니다.');
      return { sub: text(row.sub, 255), email: text(row.email, 320) };
    },
    async resources(accessToken: string): Promise<GoogleResources> {
      const sites = list((await request('https://www.googleapis.com/webmasters/v3/sites', accessToken)).siteEntry).filter(row => row.permissionLevel !== 'siteUnverifiedUser').map(row => ({ id: text(row.siteUrl), name: text(row.siteUrl) }));
      const properties: GoogleResources['properties'] = []; let page = '';
      for (let i = 0; i < 20; i++) {
        const result = await request(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${new URLSearchParams({ pageSize: '200', ...(page ? { pageToken: page } : {}) })}`, accessToken);
        for (const account of list(result.accountSummaries)) for (const item of list(account.propertySummaries)) { const id = text(item.property); if (!/^properties\/\d+$/.test(id)) throw fail('GA4 속성 형식이 올바르지 않습니다.'); properties.push({ id, name: text(item.displayName || id) }); }
        if (!result.nextPageToken) return { sites, properties };
        page = text(result.nextPageToken);
      }
      throw fail('Google 속성 목록이 조회 한도를 넘었습니다. 계정 접근 범위를 줄여 주세요.');
    },
    async report(accessToken: string, table: GoogleTable, resource: string, start: string, end: string, offset: number): Promise<GoogleReport> {
      if (table !== 'ga4_page_stats') {
        const dimensions = table === 'gsc_daily_totals' ? ['date'] : ['date', table === 'gsc_daily_keywords' ? 'query' : 'page'];
        const result = await request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(resource)}/searchAnalytics/query`, accessToken, { startDate: start, endDate: end, dimensions, type: 'web', dataState: 'final', rowLimit: GOOGLE_PAGE_SIZE, startRow: offset });
        const rows = list(result.rows).map(row => { if (!Array.isArray(row.keys) || row.keys.length !== dimensions.length) throw fail('Search Console 차원 형식이 올바르지 않습니다.'); const date = googleDate(row.keys[0]); if (date < start || date > end) throw fail('수집 기간 밖의 응답입니다.'); return { date, ...(dimensions[1] ? { [dimensions[1] === 'query' ? 'keyword' : 'page_url']: text(row.keys[1]) } : {}), clicks: number(row.clicks), impressions: number(row.impressions), ctr: number(row.ctr) * 100, avg_position: number(row.position) }; });
        return { rows, more: rows.length === GOOGLE_PAGE_SIZE, metadata: { timezone: 'America/Los_Angeles', coverage: 'Search Console API 상위 행·최종 데이터', search_type: 'web' } };
      }
      if (!/^properties\/\d+$/.test(resource)) throw fail('GA4 속성을 확인해 주세요.');
      const dimensions = ['date', 'landingPagePlusQueryString', 'sessionSource', 'sessionDefaultChannelGroup'], metrics = ['sessions', 'keyEvents'];
      const result = await request(`https://analyticsdata.googleapis.com/v1beta/${resource}:runReport`, accessToken, { dateRanges: [{ startDate: start, endDate: end }], dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })), orderBys: dimensions.map(dimensionName => ({ dimension: { dimensionName } })), offset: String(offset), limit: String(GOOGLE_PAGE_SIZE) });
      if (JSON.stringify(list(result.dimensionHeaders).map(row => row.name)) !== JSON.stringify(dimensions) || JSON.stringify(list(result.metricHeaders).map(row => row.name)) !== JSON.stringify(metrics)) throw fail('GA4 응답의 차원 또는 측정항목이 다릅니다.');
      const rows = list(result.rows).map(row => {
        const d = list(row.dimensionValues).map(item => text(item.value)), m = list(row.metricValues).map(item => number(item.value));
        if (d.length !== 4 || m.length !== 2 || !/^\d{8}$/.test(d[0])) throw fail('GA4 측정값 형식이 올바르지 않습니다.');
        const date = googleDate(`${d[0].slice(0, 4)}-${d[0].slice(4, 6)}-${d[0].slice(6)}`); if (date < start || date > end) throw fail('수집 기간 밖의 응답입니다.');
        const ai = /^(?:[a-z0-9-]+\.)*(?:chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/i.test(d[2]);
        return { date, page_path: d[1], session_source: d[2], channel_group: d[3], sessions: m[0], organic_sessions: d[3] === 'Organic Search' ? m[0] : 0, ai_sessions: ai ? m[0] : 0, conversions: m[1] };
      });
      const count = number(result.rowCount ?? 0); if (offset + rows.length < count && !rows.length) throw fail('GA4 페이지를 모두 수집하지 못했습니다.');
      return { rows, more: offset + rows.length < count, metadata: result.metadata && typeof result.metadata === 'object' ? result.metadata as Row : {} };
    },
  };
}
