import type { Row } from './database.ts';
import { KNOWLEDGE_TYPES } from '../api/library.ts';

export const LIBRARY_EDITABLE_FIELDS: Record<string, readonly string[]> = {
  writing_style_profiles: ['name', 'description', 'audience', 'tone', 'forbidden_terms', 'is_default'],
  writing_style_samples: ['writing_style_profile_id', 'title', 'content', 'source_url'],
  knowledge_entities: ['name', 'description', 'body', 'knowledge_type', 'base_url'],
  knowledge_entity_sources: ['knowledge_entity_id', 'title', 'source_type', 'url', 'content'],
  evidence_contexts: ['knowledge_entity_id', 'source_id', 'title', 'content'],
  keyword_knowledge_entities: ['keyword_id', 'knowledge_entity_id'],
};

export function validateLibraryRecord(table: string, input: Row, tables: Map<string, Row[]>): Row {
  if (!LIBRARY_EDITABLE_FIELDS[table] && table !== 'content_jobs') return input;
  const row = { ...input };
  const text = (field: string, max: number, required = false) => {
    if (row[field] === undefined && !required) return;
    if (typeof row[field] !== 'string' || (required && !String(row[field]).trim()) || String(row[field]).length > max) throw new Error(`${field}: ${max}자 이내의 내용을 입력해 주세요.`);
    row[field] = String(row[field]).trim();
  };
  const url = (field: string, required = false) => {
    text(field, 2000, required);
    if (!row[field] && !required) return;
    try { const parsed = new URL(String(row[field])); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); row[field] = parsed.href; }
    catch { throw new Error(`${field}: http 또는 https URL을 입력해 주세요.`); }
  };
  const reference = (field: string, parent: string, required = true) => {
    if (!row[field] && !required) { row[field] = null; return; }
    const found = (tables.get(parent) || []).find(other => other.id === row[field] && other.workspace_id === row.workspace_id);
    if (!found) throw new Error(`${field}: 같은 워크스페이스의 항목만 연결할 수 있습니다.`);
    return found;
  };
  if (table === 'writing_style_profiles' || table === 'knowledge_entities') {
    text('name', 100, true); text('description', 2000);
    const normalized = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase();
    if ((tables.get(table) || []).some(other => other.id !== row.id && other.workspace_id === row.workspace_id && normalized(other.name) === normalized(row.name))) throw new Error('같은 이름의 항목이 이미 있습니다.');
    if (table === 'writing_style_profiles') {
      text('audience', 1000); text('tone', 1000); row.forbidden_terms ??= []; row.is_default ??= false;
      if (typeof row.is_default !== 'boolean') throw new Error('기본 페르소나 여부를 확인해 주세요.');
      if (!Array.isArray(row.forbidden_terms) || row.forbidden_terms.length > 50 || row.forbidden_terms.some(term => typeof term !== 'string' || !term.trim() || term.length > 100)) throw new Error('금지어는 100자 이하로 최대 50개까지 입력해 주세요.');
      row.forbidden_terms = [...new Set(row.forbidden_terms.map(term => String(term).trim()))];
    } else {
      row.knowledge_type ??= 'other'; text('body', 100000); url('base_url');
      if (!Object.hasOwn(KNOWLEDGE_TYPES, String(row.knowledge_type))) throw new Error('자료 유형을 확인해 주세요.');
      row.slug ??= `knowledge-${row.id}`;
    }
  }
  if (table === 'writing_style_samples') { reference('writing_style_profile_id', 'writing_style_profiles'); text('title', 100, true); text('content', 10000, true); url('source_url'); }
  if (['knowledge_entity_sources', 'evidence_contexts', 'keyword_knowledge_entities'].includes(table)) reference('knowledge_entity_id', 'knowledge_entities');
  if (table === 'knowledge_entity_sources') {
    text('title', 200, true); text('content', 100000); row.source_type ??= 'text';
    if (!['url', 'text', 'file'].includes(String(row.source_type))) throw new Error('출처 유형을 확인해 주세요.');
    url('url', row.source_type === 'url');
    if (row.source_type === 'text') text('content', 100000, true);
    const previous = (tables.get(table) || []).find(other => other.id === row.id);
    if (previous && previous.source_type !== row.source_type) throw new Error('출처 유형은 변경할 수 없습니다. 새 출처를 등록해 주세요.');
    if (previous && previous.knowledge_entity_id !== row.knowledge_entity_id) throw new Error('출처를 다른 자료로 이동할 수 없습니다.');
  }
  if (table === 'evidence_contexts') {
    text('title', 200, true); text('content', 20000, true);
    const source = reference('source_id', 'knowledge_entity_sources', false);
    if (source && source.knowledge_entity_id !== row.knowledge_entity_id) throw new Error('해당 자료에 속한 출처를 선택해 주세요.');
  }
  if (table === 'keyword_knowledge_entities') {
    reference('keyword_id', 'keywords');
    if ((tables.get(table) || []).some(other => other.id !== row.id && other.keyword_id === row.keyword_id && other.knowledge_entity_id === row.knowledge_entity_id)) throw new Error('이미 연결된 키워드입니다.');
  }
  if (table === 'content_jobs') {
    reference('writing_style_profile_id', 'writing_style_profiles', false);
    row.knowledge_entity_ids ??= [];
    if (!Array.isArray(row.knowledge_entity_ids) || row.knowledge_entity_ids.length > 20 || new Set(row.knowledge_entity_ids).size !== row.knowledge_entity_ids.length) throw new Error('자료는 중복 없이 최대 20개 선택해 주세요.');
    for (const id of row.knowledge_entity_ids) if (!(tables.get('knowledge_entities') || []).some(entity => entity.id === id && entity.workspace_id === row.workspace_id)) throw new Error('같은 워크스페이스의 자료만 사용할 수 있습니다.');
  }
  return row;
}
