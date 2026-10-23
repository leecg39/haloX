import type { Row } from './database.ts';
import { GEO_ENGINES, GEO_CATEGORIES } from '../api/prompts.ts';

export const GEO_EDITABLE_FIELDS: Record<string, readonly string[]> = {
  geo_prompts: ['prompt_text', 'prompt_set_id', 'prompt_category', 'language_code', 'location_code', 'engines', 'is_active', 'is_paused'],
  geo_prompt_sets: ['name', 'description', 'brand_domain', 'default_engine', 'is_default', 'is_active', 'schedule_enabled', 'schedule_hour'],
  geo_prompt_tag_assignments: ['prompt_id', 'tag_id'],
};
export const GEO_RESULT_TABLES = ['geo_prompt_runs', 'geo_answers_raw', 'geo_citations', 'geo_run_metrics'];

export function nextGeoSchedule(hour: number, now = Date.now()): string {
  const local = new Date(now + 9 * 3600000);
  let next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour - 9);
  if (next <= now) next += 86400000;
  return new Date(next).toISOString();
}

export function validateGeoRecord(table: string, input: Row, tables: Map<string, Row[]>, now = Date.now()): Row {
  if (!GEO_EDITABLE_FIELDS[table] && !GEO_RESULT_TABLES.includes(table)) return input;
  const row = { ...input };
  const text = (field: string, max: number, required = true) => {
    if (!required && row[field] === undefined) return;
    if (typeof row[field] !== 'string' || (required && !String(row[field]).trim()) || String(row[field]).length > max) throw new Error(`${field}: ${max}자 이내로 입력해 주세요.`);
    row[field] = String(row[field]).trim();
  };
  const reference = (field: string, parent: string, required = true) => {
    if (!row[field] && !required) { row[field] = null; return; }
    if (!(tables.get(parent) || []).some(other => other.id === row[field] && other.workspace_id === row.workspace_id)) throw new Error(`${field}: 같은 워크스페이스의 항목만 연결할 수 있습니다.`);
  };
  for (const field of ['is_active', 'is_paused', 'is_default', 'schedule_enabled']) if (field in row && typeof row[field] !== 'boolean') throw new Error(`${field}: true 또는 false를 입력해 주세요.`);
  if (table === 'geo_prompts' || table === 'geo_prompt_sets') {
    const field = table === 'geo_prompts' ? 'prompt_text' : 'name';
    text(field, table === 'geo_prompts' ? 2000 : 100);
    const normalized = (value: unknown) => String(value ?? '').trim().normalize('NFKC').toLowerCase();
    if (table === 'geo_prompts') {
      reference('prompt_set_id', 'geo_prompt_sets', false);
      row.language_code ??= 'ko'; row.location_code ??= 'KR'; row.prompt_category ??= 'informational'; row.engines ??= ['openai']; row.is_active ??= true; row.is_paused ??= false;
      if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(String(row.language_code)) || !/^[A-Z]{2}$/.test(String(row.location_code))) throw new Error('언어 또는 국가 코드를 확인해 주세요.');
      if (!Object.hasOwn(GEO_CATEGORIES, String(row.prompt_category))) throw new Error('질문 유형을 확인해 주세요.');
      if (!Array.isArray(row.engines) || !row.engines.length || row.engines.length > 4 || new Set(row.engines).size !== row.engines.length || row.engines.some(engine => !Object.hasOwn(GEO_ENGINES, String(engine)))) throw new Error('실행할 엔진을 1~4개 선택해 주세요.');
    } else {
      text('description', 2000, false);
      row.default_engine ??= 'openai'; row.is_active ??= true; row.schedule_enabled ??= false; row.schedule_hour ??= 9;
      if (!Object.hasOwn(GEO_ENGINES, String(row.default_engine))) throw new Error('기본 엔진을 확인해 주세요.');
      if (!Number.isInteger(row.schedule_hour) || Number(row.schedule_hour) < 0 || Number(row.schedule_hour) > 23) throw new Error('예약 시간은 0~23시로 지정해 주세요.');
      if (row.brand_domain && (typeof row.brand_domain !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(row.brand_domain) || row.brand_domain.length > 253)) throw new Error('도메인은 example.com 형식으로 입력해 주세요.');
      if (row.brand_domain) row.brand_domain = String(row.brand_domain).toLowerCase();
      const previous = (tables.get(table) || []).find(other => other.id === row.id);
      if (!row.schedule_enabled || !row.is_active) row.next_run_at = null;
      else if (!previous?.schedule_enabled || previous.schedule_hour !== row.schedule_hour || !row.next_run_at) row.next_run_at = nextGeoSchedule(Number(row.schedule_hour), now);
    }
    if ((tables.get(table) || []).some(other => other.id !== row.id && other.workspace_id === row.workspace_id && normalized(other[field]) === normalized(row[field]) && (table === 'geo_prompt_sets' || ((other.language_code ?? 'ko') === row.language_code && (other.location_code ?? 'KR') === row.location_code)))) throw new Error('동일한 프롬프트 또는 세트가 이미 있습니다.');
  }
  if (table === 'geo_prompt_runs' || table === 'geo_prompt_tag_assignments' || table === 'geo_answers_raw') reference('prompt_id', 'geo_prompts');
  if (table === 'geo_prompt_tag_assignments') {
    reference('tag_id', 'workspace_tags');
    if ((tables.get(table) || []).some(other => other.id !== row.id && other.prompt_id === row.prompt_id && other.tag_id === row.tag_id)) throw new Error('이미 연결된 태그입니다.');
  }
  if (['geo_answers_raw', 'geo_citations', 'geo_run_metrics'].includes(table)) reference('run_id', 'geo_prompt_runs');
  if (table === 'geo_prompt_runs' && (!Object.hasOwn(GEO_ENGINES, String(row.engine)) || !['running', 'completed', 'failed'].includes(String(row.status)))) throw new Error('실행 상태 또는 엔진이 올바르지 않습니다.');
  return row;
}
