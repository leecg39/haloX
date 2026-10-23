import type { Row } from './database.ts';
import { CONTENT_STATUS, MAX_CONTENT_LENGTH } from '../api/content.ts';

export class ContentConflictError extends Error {
  readonly code = 'CONTENT_CONFLICT';
  readonly status = 409;
  constructor() { super('다른 곳에서 콘텐츠가 변경되었습니다. 입력한 내용은 유지했습니다. 최신 버전을 확인한 뒤 다시 저장해 주세요.'); }
}

export function contentText(value: unknown, label: string, max: number, required = false, preserve = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw new Error(`${label}: ${required ? '1~' : '최대 '}${max}자로 입력해 주세요.`);
  return preserve ? value : value.trim();
}

export function validateContentBody(input: Row) {
  return {
    title: contentText(input.title, '제목', 200, true),
    content_md: contentText(input.content_md, '본문', MAX_CONTENT_LENGTH, true, true),
    meta_title: contentText(input.meta_title, '검색 제목', 200),
    meta_description: contentText(input.meta_description, '검색 설명', 1000),
  };
}

/** Sections are a derived view of a saved version; the markdown remains the source of truth. */
export function contentSections(markdown: string): { heading: string; content: string; position: number }[] {
  const sections: { heading: string; content: string; position: number }[] = [];
  let heading = '도입', lines: string[] = [], fence = '';
  const flush = () => { if (lines.length || heading !== '도입') sections.push({ heading, content: lines.join('\n'), position: sections.length }); };
  for (const line of markdown.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''; }
    const match = !fence && line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (match) { flush(); heading = match[1]; lines = []; } else lines.push(line);
  }
  flush(); return sections;
}

export function validateContentRecord(table: string, input: Row, tables: Map<string, Row[]>): Row {
  if (!['content_jobs', 'content_drafts', 'content_compositions'].includes(table)) return input;
  const row = { ...input };
  const reference = (field: string, parent: string, optional = false) => {
    if (!row[field] && optional) { row[field] = null; return; }
    const found = (tables.get(parent) || []).find(other => other.id === row[field] && other.workspace_id === row.workspace_id);
    if (!found) throw new Error(`${field}: 같은 워크스페이스의 항목만 연결할 수 있습니다.`);
    return found;
  };
  if (table === 'content_jobs') {
    row.title = contentText(row.title, '제목', 200, true);
    row.target_keyword = contentText(row.target_keyword, '주제', 200, true);
    row.notes = contentText(row.notes, '작업 메모', 5000);
    row.status ??= 'draft';
    if (!Object.hasOwn(CONTENT_STATUS, String(row.status))) throw new Error('작업 상태를 확인해 주세요.');
    reference('keyword_id', 'keywords', true); reference('geo_prompt_id', 'geo_prompts', true);
    const draft = reference('current_draft_id', 'content_drafts', true);
    if (draft && draft.content_job_id !== row.id) throw new Error('다른 콘텐츠의 버전은 선택할 수 없습니다.');
    row.source_url = contentText(row.source_url, '원문 URL', 2000);
    if (row.source_url) {
      try { const url = new URL(String(row.source_url)); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); row.source_url = url.href; }
      catch { throw new Error('원문 URL은 http 또는 https 주소로 입력해 주세요.'); }
    }
  }
  if (table === 'content_drafts') {
    reference('content_job_id', 'content_jobs'); Object.assign(row, validateContentBody(row));
    if (!Number.isSafeInteger(row.version) || Number(row.version) < 1) throw new Error('올바른 버전 번호가 필요합니다.');
    if ((tables.get(table) || []).some(other => other.id !== row.id && other.content_job_id === row.content_job_id && other.version === row.version)) throw new Error('이미 존재하는 콘텐츠 버전입니다.');
    if (typeof row.is_selected !== 'boolean') throw new Error('버전 선택 여부를 확인해 주세요.');
  }
  if (table === 'content_compositions') {
    const draft = reference('content_draft_id', 'content_drafts');
    if (draft?.content_job_id !== row.content_job_id) throw new Error('본문 구성의 콘텐츠 연결이 일치하지 않습니다.');
  }
  return row;
}
