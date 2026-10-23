import type { Row } from './database.ts';

export const KEYWORD_EDITABLE_FIELDS: Record<string, readonly string[]> = {
  keywords: ['keyword', 'keyword_set_id', 'language', 'country', 'is_active', 'is_paused'],
  keyword_sets: ['name', 'description', 'target_domain', 'language', 'country', 'is_default', 'is_active'],
  workspace_tags: ['name', 'color', 'group_id'],
  workspace_tag_groups: ['name'],
  keyword_tag_assignments: ['keyword_id', 'tag_id'],
  keyword_prompt_links: ['keyword_id', 'prompt_id'],
  keyword_ideas: ['keyword', 'notes', 'keyword_set_id', 'language', 'country'],
};

const normalized = (value: unknown) => String(value ?? '').trim().normalize('NFKC').toLocaleLowerCase();
export function validateKeywordRecord(table: string, input: Row, tables: Map<string, Row[]>): Row {
  if (!KEYWORD_EDITABLE_FIELDS[table] && table !== 'serp_snapshots') return input;
  const row = { ...input };
  const text = (field: string, max: number, required = true) => {
    if (row[field] === undefined && !required) return;
    if (typeof row[field] !== 'string' || (required && !String(row[field]).trim()) || String(row[field]).length > max) throw new Error(`${field}: 1~${max}자의 문자열을 입력해 주세요.`);
    row[field] = String(row[field]).trim();
  };
  const reference = (field: string, parent: string, required = false) => {
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      if (required) throw new Error(`${field} 항목을 선택해 주세요.`);
      row[field] = null;
      return;
    }
    if (!(tables.get(parent) || []).some(other => other.id === row[field] && other.workspace_id === row.workspace_id)) throw new Error(`${field}: 같은 워크스페이스의 항목만 연결할 수 있습니다.`);
  };
  if (['keywords', 'keyword_ideas', 'keyword_sets'].includes(table)) {
    text(table === 'keyword_sets' ? 'name' : 'keyword', table === 'keyword_sets' ? 100 : 200);
    row.language ??= 'ko'; row.country ??= 'KR';
    if (typeof row.language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(row.language)) throw new Error('언어 코드를 확인해 주세요.');
    if (typeof row.country !== 'string' || !/^[A-Z]{2}$/.test(row.country)) throw new Error('국가 코드를 확인해 주세요.');
    for (const field of ['is_active', 'is_paused', 'is_default']) if (field in row && typeof row[field] !== 'boolean') throw new Error(`${field}: true 또는 false를 입력해 주세요.`);
    if (table === 'keyword_sets') {
      text('description', 2000, false);
      if (row.target_domain) {
        if (typeof row.target_domain !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(row.target_domain) || row.target_domain.length > 253) throw new Error('도메인은 example.com 형식으로 입력해 주세요.');
        row.target_domain = row.target_domain.toLowerCase();
      }
    } else reference('keyword_set_id', 'keyword_sets');
    if (table === 'keywords') { row.is_active ??= true; row.is_paused ??= false; }
    if (table === 'keyword_ideas') text('notes', 2000, false);
    const field = table === 'keyword_sets' ? 'name' : 'keyword';
    if ((tables.get(table) || []).some(other => other.id !== row.id && other.workspace_id === row.workspace_id && normalized(other[field]) === normalized(row[field]) && (table === 'keyword_sets' || ((other.language ?? 'ko') === row.language && (other.country ?? 'KR') === row.country)))) throw new Error('같은 이름의 항목이 이미 있습니다.');
  }
  if (table === 'workspace_tags' || table === 'workspace_tag_groups') {
    text('name', 60);
    if ((tables.get(table) || []).some(other => other.id !== row.id && other.workspace_id === row.workspace_id && normalized(other.name) === normalized(row.name))) throw new Error('같은 이름의 태그 또는 그룹이 이미 있습니다.');
    if (table === 'workspace_tags') {
      row.color ??= '#64748b';
      if (typeof row.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(row.color)) throw new Error('태그 색상을 확인해 주세요.');
      reference('group_id', 'workspace_tag_groups');
    }
  }
  if (['keyword_tag_assignments', 'keyword_prompt_links', 'serp_snapshots'].includes(table)) {
    reference('keyword_id', 'keywords', true);
    if (table !== 'serp_snapshots') {
      const field = table === 'keyword_tag_assignments' ? 'tag_id' : 'prompt_id';
      reference(field, field === 'tag_id' ? 'workspace_tags' : 'geo_prompts', true);
      if ((tables.get(table) || []).some(other => other.id !== row.id && other.keyword_id === row.keyword_id && other[field] === row[field])) throw new Error('이미 연결된 항목입니다.');
    }
  }
  return row;
}
