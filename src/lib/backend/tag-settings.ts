import { createHash } from 'node:crypto';
import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { canAccess, canWrite } from '../permissions/workspace.ts';
import { contentText } from './content-model.ts';

export class TagConflictError extends Error {
  constructor() { super('다른 곳에서 태그·그룹 또는 연결 항목이 변경되었습니다. 입력은 유지했습니다. 창을 닫고 새로고침한 뒤 다시 확인해 주세요.'); }
}
const where = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id === undefined ? {} : { id: `eq.${id}` }) });
const digest = (values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const stamp = (rows: Row[]) => digest(rows.map(row => [row.id, row.keyword_id ?? row.prompt_id ?? null, row.revision ?? 0]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
const revision = (row: Row, expected: unknown) => { if (!Number.isSafeInteger(expected) || expected !== Number(row.revision || 0)) throw new TagConflictError(); };
function ownRow(db: HaloXDatabase, workspace: string, actor: string, table: string, id: unknown) {
  const key = contentText(id, '항목 ID', 100, true), row = db.queryTable(table, { filters: where(workspace, key) }, actor).data[0];
  if (!row) throw new Error('항목이 삭제되었거나 현재 워크스페이스에 없습니다.');
  return row;
}
function references(db: HaloXDatabase, workspace: string, actor: string, tagId: unknown) {
  return {
    keywords: db.queryTable('keyword_tag_assignments', { filters: { ...where(workspace), tag_id: `eq.${tagId}` } }, actor).data,
    prompts: db.queryTable('geo_prompt_tag_assignments', { filters: { ...where(workspace), tag_id: `eq.${tagId}` } }, actor).data,
  };
}
const referencesStamp = (links: ReturnType<typeof references>) => digest([stamp(links.keywords), stamp(links.prompts)]);

export function readTagSettings(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'other');
  const permission = db.workspacePermissions(workspace, actor), readAnalysis = canAccess(permission, 'analysis');
  const groups = db.queryTable('workspace_tag_groups', { filters: where(workspace), order: 'name.asc' }, actor).data;
  const tags = db.queryTable('workspace_tags', { filters: where(workspace), order: 'name.asc' }, actor).data;
  const keywordLinks = readAnalysis ? db.queryTable('keyword_tag_assignments', { filters: where(workspace) }, actor).data : [];
  const promptLinks = readAnalysis ? db.queryTable('geo_prompt_tag_assignments', { filters: where(workspace) }, actor).data : [];
  return {
    editable: canWrite(permission), can_assign: readAnalysis && canWrite(permission), can_read_assignments: readAnalysis,
    groups: groups.map(group => ({ ...group, contents_stamp: stamp(tags.filter(tag => tag.group_id === group.id)) })),
    tags: tags.map(tag => {
      const links = { keywords: keywordLinks.filter(row => row.tag_id === tag.id), prompts: promptLinks.filter(row => row.tag_id === tag.id) };
      return { ...tag, keyword_count: readAnalysis ? links.keywords.length : null, prompt_count: readAnalysis ? links.prompts.length : null,
        links_stamp: readAnalysis ? referencesStamp(links) : null,
        keyword_ids: links.keywords.map(row => row.keyword_id), prompt_ids: links.prompts.map(row => row.prompt_id) };
    }),
    keywords: readAnalysis ? db.queryTable('keywords', { filters: where(workspace), select: 'id,keyword,language,country', order: 'keyword.asc' }, actor).data : [],
    prompts: readAnalysis ? db.queryTable('geo_prompts', { filters: where(workspace), select: 'id,prompt_text,language_code,location_code', order: 'prompt_text.asc' }, actor).data : [],
  };
}

/** Called inside one PersistentHaloXStore write transaction. REST and the analysis editors share these rows. */
export function runTagCommand(db: HaloXDatabase, actor: string, payload: Row): Row {
  const workspace = contentText(payload.workspace_id, '워크스페이스', 100, true);
  db.assertWorkspaceAccess(workspace, actor, 'other', 'write');
  const action = payload.action;
  if (action === 'group-create' || action === 'tag-create') {
    const table = action === 'group-create' ? 'workspace_tag_groups' : 'workspace_tags';
    const values = action === 'group-create' ? { name: payload.name } : { name: payload.name, color: payload.color, group_id: payload.group_id };
    return { ok: true, row: db.insertTable(table, { ...values, workspace_id: workspace }, actor)[0] };
  }
  if (!['group-update', 'group-delete', 'tag-update', 'tag-delete', 'tag-assign'].includes(String(action))) throw new Error('지원하지 않는 태그 작업입니다.');
  const group = String(action).startsWith('group-'), table = group ? 'workspace_tag_groups' : 'workspace_tags';
  const row = ownRow(db, workspace, actor, table, payload.id); revision(row, payload.expected_revision);
  if (action === 'group-update' || action === 'tag-update') {
    const fields = group ? ['name'] : ['name', 'color', 'group_id'];
    const patch = Object.fromEntries(fields.filter(key => key in payload).map(key => [key, payload[key]]));
    if (!Object.keys(patch).length) throw new Error('변경할 내용을 입력해 주세요.');
    return { ok: true, row: db.updateTable(table, patch, where(workspace, row.id), actor)[0] };
  }
  if (action === 'group-delete') {
    const contents = db.queryTable('workspace_tags', { filters: { ...where(workspace), group_id: `eq.${row.id}` } }, actor).data;
    if (payload.contents_stamp !== stamp(contents)) throw new TagConflictError();
    db.deleteTable(table, where(workspace, row.id), actor);
    return { ok: true };
  }
  // Deleting a shared tag removes analysis assignments too; require visibility of those affected records.
  db.assertWorkspaceAccess(workspace, actor, 'analysis', 'write');
  const links = references(db, workspace, actor, row.id);
  if (payload.links_stamp !== referencesStamp(links)) throw new TagConflictError();
  if (action === 'tag-delete') { db.deleteTable(table, where(workspace, row.id), actor); return { ok: true }; }
  function selection(field: string, parent: string): string[] {
    const value = payload[field];
    if (!Array.isArray(value) || value.length > 2000 || value.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(value).size !== value.length) throw new Error('연결 항목은 중복 없이 최대 2,000개까지 선택해 주세요.');
    const available = new Set(db.queryTable(parent, { filters: where(workspace) }, actor).data.map(item => item.id));
    if (value.some(id => !available.has(id))) throw new RlsAccessDeniedError('현재 워크스페이스의 키워드·프롬프트만 연결할 수 있습니다. 삭제된 항목이 있는지 확인해 주세요.');
    return value as string[];
  }
  const keywordIds = selection('keyword_ids', 'keywords'), promptIds = selection('prompt_ids', 'geo_prompts');
  for (const [name, field, existing, desired] of [
    ['keyword_tag_assignments', 'keyword_id', links.keywords, keywordIds],
    ['geo_prompt_tag_assignments', 'prompt_id', links.prompts, promptIds],
  ] as const) {
    for (const link of existing) if (!desired.includes(String(link[field]))) db.deleteTable(name, where(workspace, link.id), actor);
    for (const id of desired) if (!existing.some(link => link[field] === id)) db.insertTable(name, { workspace_id: workspace, tag_id: row.id, [field]: id }, actor);
  }
  return { ok: true };
}
