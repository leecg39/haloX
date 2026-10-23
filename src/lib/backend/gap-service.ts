import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { ContentConflictError, contentText } from './content-model.ts';
import { analysisWhere } from './analysis-model.ts';
import { normalizeCandidate } from './gap-model.ts';

export const GAP_COMMANDS = ['candidate-create', 'candidate-update', 'candidate-delete', 'candidate-status', 'candidate-generate', 'candidate-adopt', 'decision-update', 'decision-delete'];
export class GapConflictError extends ContentConflictError { constructor() { super(); this.message = '기회 항목이 변경되었습니다. 입력을 유지했으니 최신 자료를 확인해 주세요.'; } }
const revision = (row: Row, expected: unknown) => { if (!Number.isSafeInteger(expected) || expected !== row.revision) throw new GapConflictError(); };
function item(db: HaloXDatabase, table: string, workspace: string, id: unknown, actor: string): Row {
  if (typeof id !== 'string' || !id) throw new Error('기회 항목을 선택해 주세요.');
  const row = db.queryTable(table, { filters: analysisWhere(workspace, id) }, actor).data[0]; if (!row) throw new Error('현재 워크스페이스에서 항목을 찾을 수 없습니다.'); return row;
}
function candidateFields(payload: Row) {
  if (!['keyword', 'prompt'].includes(String(payload.kind))) throw new Error('후보 유형을 선택해 주세요.');
  const text = contentText(payload.text, '후보 문구', payload.kind === 'keyword' ? 200 : 2000, true), notes = contentText(payload.notes, '후보 메모', 5000);
  if (typeof payload.language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(payload.language) || typeof payload.country !== 'string' || !/^[A-Z]{2}$/.test(payload.country)) throw new Error('언어·국가 코드를 확인해 주세요.');
  if (!['high', 'normal', 'low'].includes(String(payload.priority))) throw new Error('우선순위를 선택해 주세요.');
  return { kind: payload.kind, text, language: payload.language, country: payload.country, notes, priority: payload.priority };
}
const same = (a: Row, b: Row) => a.kind === b.kind && a.language === b.language && a.country === b.country && normalizeCandidate(a.text) === normalizeCandidate(b.text);
function decision(db: HaloXDatabase, candidate: Row, workspace: string, actor: string, action: string, previous: unknown, extra: Row = {}) {
  return db.insertTable('opportunity_decisions', { workspace_id: workspace, candidate_id: candidate.id, candidate_snapshot: { text: candidate.text, kind: candidate.kind, language: candidate.language, country: candidate.country, evidence: candidate.evidence }, action, previous_status: previous, notes: '', revision: 1, ...extra }, actor)[0];
}
/** Runs inside the store writer transaction, including provider-backed adoption. */
export async function runGapCommand(db: HaloXDatabase, command: string, payload: Row, workspace: string, actor: string): Promise<Row> {
  db.assertWorkspaceMember(workspace, actor);
  const rows = (table: string) => db.queryTable(table, { filters: analysisWhere(workspace) }, actor).data;
  if (command.startsWith('decision-')) {
    const row = item(db, 'opportunity_decisions', workspace, payload.decision_id, actor); revision(row, payload.expected_revision);
    if (command === 'decision-delete') { db.deleteTable('opportunity_decisions', analysisWhere(workspace, row.id), actor); return { ok: true }; }
    return { ok: true, decision: db.updateTable('opportunity_decisions', { notes: contentText(payload.notes, '판단 메모', 5000), revision: Number(row.revision) + 1 }, analysisWhere(workspace, row.id), actor)[0] };
  }
  if (command === 'candidate-generate') {
    const keyword = item(db, 'keywords', workspace, payload.keyword_id, actor); if (keyword.deleted_at) throw new Error('삭제한 키워드는 사용할 수 없습니다.');
    const snapshot = rows('serp_snapshots').filter(row => row.keyword_id === keyword.id && (row.keyword_text === undefined || row.keyword_text === keyword.keyword) && row.language === keyword.language && row.country === keyword.country).sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)) || String(b.id).localeCompare(String(a.id)))[0];
    if (!snapshot) throw new Error('현재 키워드 문구·언어·국가의 수집 자료가 없습니다. 먼저 키워드를 수집해 주세요.');
    const suggestions: Row[] = [];
    for (const [field, kind, origin] of [['related_searches_json', 'keyword', 'serp-related'], ['paa_questions_json', 'prompt', 'serp-paa']]) for (const value of Array.isArray(snapshot[field]) ? snapshot[field] as unknown[] : []) {
      if (typeof value !== 'string' || !value.trim() || value.length > (kind === 'keyword' ? 200 : 2000)) continue;
      const values = { kind, text: value.trim(), language: keyword.language, country: keyword.country, notes: '', priority: 'normal' };
      if (!suggestions.some(other => same(values, other))) suggestions.push({ ...values, origin });
      if (suggestions.length >= 20) break;
    }
    const current = rows('geo_prompt_candidates'), newRows = suggestions.slice(0, 20).filter(value => !current.some(other => same(value, other)));
    if (current.length + newRows.length > 500) throw new Error('후보는 워크스페이스당 500개까지 지원합니다.');
    const created = newRows.map(value => db.insertTable('geo_prompt_candidates', { ...value, workspace_id: workspace, status: 'pending', source_keyword_id: keyword.id, evidence: { snapshot_id: snapshot.id, captured_at: snapshot.captured_at, keyword: keyword.keyword, provider: snapshot.provider }, revision: 1 }, actor)[0]);
    return { ok: true, created_count: created.length, existing_count: suggestions.slice(0, 20).length - created.length, candidates: created };
  }
  if (command === 'candidate-create') {
    const fields = candidateFields(payload), current = rows('geo_prompt_candidates');
    if (current.length >= 500) throw new Error('후보는 워크스페이스당 500개까지 지원합니다.');
    if (current.some(row => same(fields, row))) throw new Error('동일한 후보가 이미 있습니다.');
    const source = payload.source_keyword_id ? item(db, 'keywords', workspace, payload.source_keyword_id, actor) : undefined;
    if (source?.deleted_at) throw new Error('삭제한 키워드는 연결할 수 없습니다.');
    return { ok: true, candidate: db.insertTable('geo_prompt_candidates', { ...fields, workspace_id: workspace, origin: 'manual', source_keyword_id: source?.id || null, evidence: source ? { keyword: source.keyword } : null, status: 'pending', revision: 1 }, actor)[0] };
  }
  const candidate = item(db, 'geo_prompt_candidates', workspace, payload.candidate_id, actor);
  // This status is the durable receipt. Replays never recreate a deleted destination or charge again.
  if (command === 'candidate-adopt' && candidate.status === 'accepted') return { ok: true, reused: true, candidate };
  revision(candidate, payload.expected_revision);
  if (command === 'candidate-delete') { db.deleteTable('geo_prompt_candidates', analysisWhere(workspace, candidate.id), actor); return { ok: true }; }
  if (command === 'candidate-update') {
    const fields = candidateFields(payload);
    if (candidate.status === 'accepted' && ['kind', 'text', 'language', 'country'].some(field => fields[field as keyof typeof fields] !== candidate[field])) throw new Error('채택한 후보의 문구·유형·언어·국가는 변경할 수 없습니다.');
    if (rows('geo_prompt_candidates').some(row => row.id !== candidate.id && same(fields, row))) throw new Error('동일한 후보가 이미 있습니다.');
    return { ok: true, candidate: db.updateTable('geo_prompt_candidates', { ...fields, revision: Number(candidate.revision) + 1 }, analysisWhere(workspace, candidate.id), actor)[0] };
  }
  if (command === 'candidate-status') {
    if (!['pending', 'dismissed'].includes(String(payload.status)) || candidate.status === 'accepted' || candidate.status === payload.status) throw new Error('현재 후보에서 지원하지 않는 상태 변경입니다.');
    decision(db, candidate, workspace, actor, String(payload.status), candidate.status);
    return { ok: true, candidate: db.updateTable('geo_prompt_candidates', { status: payload.status, revision: Number(candidate.revision) + 1 }, analysisWhere(workspace, candidate.id), actor)[0] };
  }
  if (command === 'candidate-adopt') {
    if (candidate.status !== 'pending') throw new Error('검토 대기 후보만 채택할 수 있습니다. 보류를 해제한 뒤 진행해 주세요.');
    if (payload.confirm !== true) throw new Error('후보 등록과 수집 내용을 확인해 주세요.');
    const keyword = candidate.kind === 'keyword', table = keyword ? 'keywords' : 'geo_prompts';
    const existing = rows(table).find(row => !row.deleted_at && normalizeCandidate(row[keyword ? 'keyword' : 'prompt_text']) === normalizeCandidate(candidate.text) && row[keyword ? 'language' : 'language_code'] === candidate.language && row[keyword ? 'country' : 'location_code'] === candidate.country);
    let destination = existing;
    if (!destination) {
      if (payload.set_id) item(db, keyword ? 'keyword_sets' : 'geo_prompt_sets', workspace, payload.set_id, actor);
      const result = await db.invokeEdgeFunction(keyword ? 'keywords-collect' : 'geo-run', { workspace_id: workspace, ...(payload.set_id ? { [keyword ? 'keyword_set_id' : 'prompt_set_id']: payload.set_id } : {}), ...(keyword ? { keywords: [candidate.text], language: candidate.language, country: candidate.country } : { prompt_text: candidate.text, language_code: candidate.language, location_code: candidate.country, engines: [payload.engine || 'openai'] }), idempotency_key: `gap:${candidate.id}:${crypto.randomUUID()}` }, actor);
      destination = keyword ? (result.keywords as Row[])[0] : item(db, 'geo_prompts', workspace, result.prompt_id, actor);
    }
    const source = rows('keywords').find(row => row.id === candidate.source_keyword_id && !row.deleted_at);
    if (!keyword && source && !rows('keyword_prompt_links').some(row => row.keyword_id === source.id && row.prompt_id === destination.id)) db.insertTable('keyword_prompt_links', { workspace_id: workspace, keyword_id: source.id, prompt_id: destination.id }, actor);
    decision(db, candidate, workspace, actor, 'accepted', candidate.status, { destination_id: destination.id, destination_kind: candidate.kind, reused_destination: !!existing });
    const updated = db.updateTable('geo_prompt_candidates', { status: 'accepted', destination_id: destination.id, accepted_at: new Date().toISOString(), revision: Number(candidate.revision) + 1 }, analysisWhere(workspace, candidate.id), actor)[0];
    return { ok: true, candidate: updated, reused: false, reused_destination: !!existing };
  }
  throw new Error('지원하지 않는 기회 분석 작업입니다.');
}
