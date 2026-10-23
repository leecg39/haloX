import { createHash } from 'node:crypto';
import { MAX_LIBRARY_FILE_BYTES } from '../api/library.ts';

export function prepareLibraryFile(filename: string, bytes: Uint8Array) {
  if (!filename || filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(filename)) throw new Error('파일 이름을 확인해 주세요.');
  if (!bytes.byteLength || bytes.byteLength > MAX_LIBRARY_FILE_BYTES) throw new Error('파일 크기는 1바이트 이상 5MB 이하로 제한됩니다.');
  const extension = filename.toLowerCase().split('.').at(-1);
  let content = '', mimeType: string;
  if (extension === 'pdf') {
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('올바른 PDF 파일을 선택해 주세요.');
    mimeType = 'application/pdf';
  } else if (extension === 'txt' || extension === 'md') {
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('텍스트 파일은 UTF-8로 저장해 주세요.'); }
    if (content.includes('\0') || content.length > 100000) throw new Error('텍스트 파일은 바이너리 문자가 없는 10만 자 이하의 UTF-8 문서여야 합니다.');
    mimeType = extension === 'md' ? 'text/markdown' : 'text/plain';
  } else throw new Error('PDF, TXT, MD 파일만 업로드할 수 있습니다.');
  return { filename, mime_type: mimeType, byte_size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), content, base64: Buffer.from(bytes).toString('base64') };
}
