import crypto from 'node:crypto';
import type { Row } from './database.ts';
import { EXPORT_FORMATS, type ExportFormat } from '../api/exports.ts';
import { validateContentBody } from './content-model.ts';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function exportFormat(value: unknown): ExportFormat {
  if (typeof value !== 'string' || !Object.hasOwn(EXPORT_FORMATS, value)) throw new Error('내보내기 형식을 선택해 주세요.');
  return value as ExportFormat;
}

/** Downloadable HTML treats the source as text, including all embedded HTML and URLs. */
export function createExportFile(input: Row, format: ExportFormat, includeMetadata: boolean, prefix: string) {
  const body = validateContentBody(input);
  const metadata = { title: body.title, meta_title: body.meta_title, meta_description: body.meta_description };
  const mimeTypes = { md: 'text/markdown', txt: 'text/plain', html: 'text/html', json: 'application/json' };
  let result: string;
  if (format === 'json') result = JSON.stringify(includeMetadata ? body : { title: body.title, content_md: body.content_md }, null, 2) + '\n';
  else if (format === 'html') result = '<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>' + escapeHtml(body.title) + '</title>' + (includeMetadata ? '<meta name="description" content="' + escapeHtml(body.meta_description) + '">' : '') + '<style>body{max-width:800px;margin:40px auto;padding:0 24px;font-family:system-ui,sans-serif}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.7}</style></head><body><h1>' + escapeHtml(body.title) + '</h1><pre>' + escapeHtml(body.content_md) + '</pre></body></html>\n';
  else result = (includeMetadata ? (format === 'md' ? '---\n' + Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + '\n---\n\n' : `${body.title}\n검색 제목: ${body.meta_title}\n검색 설명: ${body.meta_description}\n\n`) : '') + body.content_md;
  const bytes = Buffer.from(result, 'utf8');
  const stem = (prefix + body.title).normalize('NFC').replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, '').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80).replace(/[\uD800-\uDBFF]$/, '') || 'content';
  return { filename: `${stem}.${format}`, mime_type: mimeTypes[format] + '; charset=utf-8', byte_size: bytes.byteLength, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') };
}
