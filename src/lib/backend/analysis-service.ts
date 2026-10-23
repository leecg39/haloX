import type { HaloXDatabase, Row } from './database.ts';
import { ContentConflictError, contentText } from './content-model.ts';
import { analysisFilters, analysisKind, analysisWhere, validateAnalysisReferences } from './analysis-model.ts';

export const ANALYSIS_COMMANDS = ['analysis-create', 'analysis-update', 'analysis-delete'];
export class AnalysisConflictError extends ContentConflictError { constructor() { super(); this.message = '저장한 분석이 변경되었습니다. 입력을 유지했으니 최신 목록을 불러온 뒤 다시 확인해 주세요.'; } }
export function runAnalysisCommand(db: HaloXDatabase, command: string, payload: Row, workspace: string, actor: string): Row {
  db.assertWorkspaceMember(workspace, actor);
  const existing = command === 'analysis-create' ? undefined : db.queryTable('saved_analyses', { filters: analysisWhere(workspace, payload.analysis_id) }, actor).data.find(row => row.id === payload.analysis_id);
  if (command !== 'analysis-create') {
    if (!existing) throw new Error('저장한 분석을 찾을 수 없습니다.');
    if (!Number.isSafeInteger(payload.expected_revision) || payload.expected_revision !== existing.revision) throw new AnalysisConflictError();
  }
  if (command === 'analysis-delete') { db.deleteTable('saved_analyses', analysisWhere(workspace, existing!.id), actor); return { ok: true }; }
  const kind = analysisKind(payload.kind), name = contentText(payload.name, '분석 이름', 100, true), notes = contentText(payload.notes, '분석 메모', 5000), filters = analysisFilters(payload.filters, kind);
  if (existing && kind !== existing.kind) throw new Error('분석 종류는 변경할 수 없습니다.');
  validateAnalysisReferences(db, workspace, actor, kind, filters);
  const saved = db.queryTable('saved_analyses', { filters: analysisWhere(workspace) }, actor).data;
  if (!existing && saved.length >= 200) throw new Error('저장한 분석은 워크스페이스당 200개까지 지원합니다.');
  const normalize = (value: unknown) => String(value).normalize('NFKC').toLowerCase();
  if (saved.some(row => row.id !== existing?.id && row.kind === kind && normalize(row.name) === normalize(name))) throw new Error('같은 이름의 분석이 있습니다.');
  const values = { kind, name, notes, filters, revision: Number(existing?.revision || 0) + 1 };
  const analysis = existing ? db.updateTable('saved_analyses', values, analysisWhere(workspace, existing.id), actor)[0] : db.insertTable('saved_analyses', { ...values, workspace_id: workspace }, actor)[0];
  return { ok: true, analysis };
}
