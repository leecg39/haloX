import type { HaloXDatabase, Row } from './database.ts';
import type { GeneralSettingsData } from '../api/general-settings.ts';
import { collectionDefaults, collectionPatch, DEFAULT_COLLECTION, autoPromptText } from './general-settings-model.ts';
import { requireWorkspaceManager } from './workspace-management.ts';
import { ContentConflictError, contentText } from './content-model.ts';
export function readCollectionDefaults(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceMember(workspace, actor);
  return collectionDefaults(db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0]);
}
export function readGeneralSettings(db: HaloXDatabase, workspace: string, actor: string): GeneralSettingsData {
  db.assertWorkspaceAccess(workspace, actor, 'other');
  const row = db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0];
  return { workspace_id: workspace, workspace_name: String(row.name), revision: Number(row.revision || 0), editable: ['owner', 'admin'].includes(db.workspacePermissions(workspace, actor).role), defaults: collectionDefaults(row) };
}
export function updateGeneralSettings(db: HaloXDatabase, actor: string, input: Row) {
  const workspace = contentText(input.workspace_id, '워크스페이스', 100, true);
  requireWorkspaceManager(db, workspace, actor);
  const data = readGeneralSettings(db, workspace, actor);
  if (!Number.isSafeInteger(input.expected_revision) || data.revision !== input.expected_revision) throw new ContentConflictError();
  if (input.action !== 'update' && input.action !== 'reset') throw new Error('지원하지 않는 일반 설정 작업입니다.');
  db.updateTable('workspaces', collectionPatch(input.action === 'reset' ? DEFAULT_COLLECTION : input), { id: `eq.${workspace}` }, actor);
  return readGeneralSettings(db, workspace, actor);
}
/** Automatic registration is template based; creating it never executes an LLM or enables a schedule. */
export function registerKeywordPrompt(db: HaloXDatabase, keyword: Row, actor: string): Row | undefined {
  const workspace = String(keyword.workspace_id);
  if (!readCollectionDefaults(db, workspace, actor).auto_generate_prompts) return;
  db.assertWorkspaceAccess(workspace, actor, 'analysis', 'write');
  const where = { workspace_id: `eq.${workspace}` }, text = autoPromptText(String(keyword.keyword), String(keyword.language));
  const normalized = (value: unknown) => String(value ?? '').trim().normalize('NFKC').toLowerCase();
  let prompt = db.queryTable('geo_prompts', { filters: where }, actor).data.find(row => !row.deleted_at && normalized(row.prompt_text) === normalized(text) && row.language_code === keyword.language && row.location_code === keyword.country);
  if (!prompt) {
    const reservation = db.callRpc('reserve_unit_with_bypass', { p_workspace_id: workspace, p_unit_key: 'prompt_create', p_amount: 1, p_idempotency_key: `keyword-auto:${keyword.id}` }, actor) as { reservation_id: string; idempotent?: boolean };
    if (reservation.idempotent) throw new Error('이미 처리한 자동 프롬프트 요청입니다.');
    // Unclassified prompts are not picked up by a set's scheduled runner.
    [prompt] = db.insertTable('geo_prompts', { workspace_id: workspace, prompt_text: text, language_code: keyword.language, location_code: keyword.country, prompt_set_id: null, prompt_category: 'informational', engines: ['openai'], origin: 'keyword-template', source_keyword_id: keyword.id, is_active: true, is_paused: false }, actor);
    db.callRpc('commit_reservation', { p_reservation_id: reservation.reservation_id }, actor);
  }
  if (!db.queryTable('keyword_prompt_links', { filters: { ...where, keyword_id: `eq.${keyword.id}`, prompt_id: `eq.${prompt.id}` } }, actor).count) db.insertTable('keyword_prompt_links', { workspace_id: workspace, keyword_id: keyword.id, prompt_id: prompt.id }, actor);
  return prompt;
}
