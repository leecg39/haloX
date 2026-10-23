import crypto from 'node:crypto';
import { contentText } from './content-model.ts';
import { publicDocumentUrl } from './public-document.ts';
import type { Row } from './database.ts';
import type { EarnedValues } from '../api/earned.ts';
export const EARNED_FIELDS = ['url', 'title', 'channel', 'published_at', 'notes'] as const;
export function earnedUrl(value: unknown): string {
  const text = contentText(value, '등록 URL', 2000, true);
  if (/[\u0000-\u0020\u007f]/.test(text)) throw new Error('URL에 공백이나 제어 문자를 넣을 수 없습니다.');
  return publicDocumentUrl(text).href;
}
export function earnedValues(input: Row): EarnedValues {
  const url = earnedUrl(input.url), published_at = contentText(input.published_at, '발행일', 10);
  if (published_at && (!/^\d{4}-\d{2}-\d{2}$/.test(published_at) || !Number.isFinite(Date.parse(published_at)) || new Date(published_at).toISOString().slice(0, 10) !== published_at)) throw new Error('발행일은 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.');
  return { url, title: contentText(input.title, '제목', 200), channel: contentText(input.channel, '채널', 60) || new URL(url).hostname.slice(0, 60), published_at, notes: contentText(input.notes, '메모', 5000, false, true) };
}
export const earnedHash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const earnedStamp = (rows: Row[]) => earnedHash(rows.map(row => [row.id, row.revision, row.url]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/** Strict CSV: quoted commas/newlines and doubled quotes; bounded before parsing. */
export function parseEarnedCsv(value: unknown): EarnedValues[] {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024 * 1024 || !value.trim()) throw new Error('CSV는 UTF-8, 1MiB 이하로 업로드해 주세요.');
  const input = value.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > 5) throw new Error('CSV 열은 최대 5개입니다.'); };
  const pushRow = () => { pushCell(); if (row.some(item => item !== '')) rows.push(row); row = []; if (rows.length > 501) throw new Error('한 번에 최대 500개 URL을 가져올 수 있습니다.'); };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) { if (char === '"') { if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += char; }
    else if (char === ',') pushCell();
    else if (char === '\r' || char === '\n') { if (char === '\r' && input[i + 1] === '\n') i++; pushRow(); }
    else if (closed) throw new Error('CSV 닫는 따옴표 뒤에는 구분자만 올 수 있습니다.');
    else if (char === '"') { if (cell) throw new Error('CSV 따옴표는 셀 시작에 사용해 주세요.'); quoted = true; }
    else cell += char;
    if (cell.length > 5000) throw new Error('CSV 셀은 최대 5,000자입니다.');
  }
  if (quoted) throw new Error('CSV의 닫히지 않은 따옴표를 확인해 주세요.');
  if (cell || row.length || closed) pushRow();
  const headers = rows.shift()?.map(item => item.trim());
  if (!headers || !headers.includes('url') || new Set(headers).size !== headers.length || headers.some(item => !EARNED_FIELDS.includes(item as typeof EARNED_FIELDS[number]))) throw new Error('CSV 헤더는 url(필수), title, channel, published_at, notes만 사용할 수 있습니다.');
  if (!rows.length) throw new Error('가져올 URL이 없습니다.');
  const seen = new Set<string>();
  return rows.map((cells, i) => {
    try {
      if (cells.length !== headers.length) throw new Error('헤더와 열 수가 다릅니다.');
      const result = earnedValues(Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
      if (seen.has(result.url)) throw new Error('파일 안의 URL이 중복되었습니다.'); seen.add(result.url); return result;
    } catch (error) { throw new Error(`데이터 ${i + 1}행: ${error instanceof Error ? error.message : '입력 오류'}`); }
  });
}
