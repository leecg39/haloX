import { canAccess, normalizeSections, SECTIONS, type Section } from '../permissions/workspace.ts';
import crypto from 'node:crypto';
import { POLICY_FIELDS, policyUrls } from './site-policy.ts';
import { policyCommand } from './site-policy-service.ts';
import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { checkContentRevision } from './content-service.ts';
import { contentText, ContentConflictError } from './content-model.ts';
function checkRevision(row: Row, expected: unknown) {
  try { checkContentRevision(row, expected); } catch (error) {
    if (error instanceof ContentConflictError) error.message = '다른 화면에서 설정이 변경되었습니다. 입력은 유지했습니다. 최신 정보를 다시 불러온 뒤 저장해 주세요.';
    throw error;
  }
}

export type WorkspacePrivateCollection = 'workspace_invitation_tokens';
export const workspaceWhere = (id: string) => ({ workspace_id: `eq.${id}` });
export function workspaceRole(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceMember(workspace, actor);
  return String(db.queryTable('workspace_members', { filters: { ...workspaceWhere(workspace), user_id: `eq.${actor}` } }, actor).data[0]?.role || '');
}
export function requireWorkspaceManager(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'other', 'write');
  const role = workspaceRole(db, workspace, actor);
  if (!['owner', 'admin'].includes(role)) throw new RlsAccessDeniedError('워크스페이스 관리자 권한이 필요합니다.');
  return role;
}
export function validateWorkspacePatch(input: Row, current?: Row) {
  const row = { ...input };
  for (const [field, label, max, required] of [['name', '워크스페이스 이름', 100, true], ['description', '설명', 2000, false], ['brand_name', '브랜드 이름', 100, false]] as const) {
    if (field in row) row[field] = contentText(row[field], label, max, required);
  }
  if ('default_brand_filter' in row && row.default_brand_filter !== current?.default_brand_filter) {
    const domain = contentText(row.default_brand_filter, '기본 도메인', 253).toLowerCase();
    if (domain && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('기본 도메인은 example.com 형식으로 입력해 주세요.');
    row.default_brand_filter = domain;
  }
  if ('slug' in row && (typeof row.slug !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u.test(row.slug))) throw new Error('슬러그는 문자·숫자·하이픈·밑줄로 1~100자 입력해 주세요.');
  if ('auto_generate_prompts' in row && typeof row.auto_generate_prompts !== 'boolean') throw new Error('자동 생성 설정을 확인해 주세요.');
  if ('settings' in row && (!row.settings || typeof row.settings !== 'object' || Array.isArray(row.settings) || JSON.stringify(row.settings).length > 16000)) throw new Error('설정 형식을 확인해 주세요.');
  if (POLICY_FIELDS.some(field => field in row)) Object.assign(row, policyUrls({ ...current, ...row }));
  return row;
}
export function validateMembership(input: Row, tables: Map<string, Row[]>) {
  const profile = (tables.get('profiles') || []).find(row => row.id === input.user_id);
  if (!profile) throw new Error('등록된 계정만 멤버로 추가할 수 있습니다.');
  const workspace = (tables.get('workspaces') || []).find(row => row.id === input.workspace_id);
  if (!workspace || (input.role === 'owner') !== (workspace.owner_id === input.user_id)) throw new Error('소유자 멤버십은 워크스페이스 소유자와 일치해야 합니다.');
  if (!['owner', 'admin', 'member', 'viewer'].includes(String(input.role))) throw new Error('유효하지 않은 멤버 권한입니다.');
  if ((tables.get('workspace_members') || []).some(row => row.id !== input.id && row.workspace_id === input.workspace_id && row.user_id === input.user_id)) throw new Error('이미 참여 중인 멤버입니다.');
  return { ...input, email: profile.email, full_name: profile.full_name, allowed_sections: input.role === 'owner' ? ['all'] : normalizeSections(input.allowed_sections) };
}
export function grantSections(db: HaloXDatabase, workspace: string, actor: string, value: unknown): string[] {
  const sections = normalizeSections(value), permission = db.workspacePermissions(workspace, actor);
  const requested = sections.includes('all') ? Object.keys(SECTIONS) : sections;
  if (requested.some(section => !canAccess(permission, section as Section))) throw new RlsAccessDeniedError('본인에게 허용된 메뉴만 부여하거나 관리할 수 있습니다.');
  return sections;
}
export function readWorkspaceManagement(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'other');
  const role = workspaceRole(db, workspace, actor), manager = ['owner', 'admin'].includes(role);
  const get = (table: string) => db.queryTable(table, { filters: workspaceWhere(workspace), order: 'created_at.desc' }, actor).data;
  return { user_id: actor, role, workspace: db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0], members: get('workspace_members'), invitations: manager ? get('workspace_invitations').map(row => ({ ...row, status: row.status === 'pending' && Date.parse(String(row.expires_at)) <= Date.now() ? 'expired' : row.status })) : [], targets: get('site_audit_targets'), policy_editable: manager && canAccess(db.workspacePermissions(workspace, actor), 'strategy'), policy_jobs: canAccess(db.workspacePermissions(workspace, actor), 'strategy') ? get('site_policy_jobs') : [] };
}
function invitationRole(value: unknown, manager: string) {
  const role = value === undefined ? 'member' : value;
  if (role !== 'admin' && role !== 'member' && role !== 'viewer') throw new Error('Invalid invitation role: member, viewer 또는 admin을 선택해 주세요.');
  if (role === 'admin' && manager !== 'owner') throw new RlsAccessDeniedError('관리자 지정은 소유자만 할 수 있습니다.');
  return role;
}
function tokenFor(db: HaloXDatabase, invitation: Row, actor: string) {
  const token = crypto.randomBytes(32).toString('base64url'), workspace = db.queryTable('workspaces', { filters: { id: `eq.${invitation.workspace_id}` } }, actor).data[0];
  db.setServerRecords('workspace_invitation_tokens', [...db.getServerRecords('workspace_invitation_tokens').filter(row => row.invitation_id !== invitation.id), { invitation_id: invitation.id, workspace_id: invitation.workspace_id, owner_id: workspace.owner_id, token_hash: crypto.createHash('sha256').update(token).digest('hex') }]);
  return token;
}
export function createWorkspaceInvitation(db: HaloXDatabase, workspace: string, actor: string, payload: Row) {
  const manager = requireWorkspaceManager(db, workspace, actor), email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('A valid invitee email is required');
  const allowed_sections = grantSections(db, workspace, actor, payload.allowed_sections);
  const role = invitationRole(payload.role, manager), rows = db.queryTable('workspace_invitations', { filters: workspaceWhere(workspace) }, actor).data;
  if (db.queryTable('workspace_members', { filters: workspaceWhere(workspace) }, actor).data.some(row => row.email === email)) throw new Error('이미 참여 중인 멤버입니다.');
  const existing = rows.find(row => row.email === email && row.status === 'pending' && Date.parse(String(row.expires_at)) > Date.now());
  if (existing) return { ok: true, invitation: existing, idempotent: true };
  if (rows.filter(row => row.status === 'pending' && Date.parse(String(row.expires_at)) > Date.now()).length >= 100) throw new Error('대기 중인 초대는 최대 100개입니다. 이전 초대를 정리해 주세요.');
  const [invitation] = db.insertTable('workspace_invitations', { workspace_id: workspace, email, role, status: 'pending', allowed_sections, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), created_by: actor, revision: 1 }, actor);
  return { ok: true, invitation, token: tokenFor(db, invitation, actor), delivery: 'link' };
}
function readInvitation(db: HaloXDatabase, actor: string, token: unknown) {
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw new Error('초대 링크가 유효하지 않거나 만료되었습니다.');
  const hash = crypto.createHash('sha256').update(token).digest('hex'), secret = db.getServerRecords('workspace_invitation_tokens').find(row => row.token_hash === hash);
  if (!secret) throw new Error('초대 링크가 유효하지 않거나 만료되었습니다.');
  const owner = String(secret.owner_id), invitation = db.queryTable('workspace_invitations', { filters: { id: `eq.${secret.invitation_id}`, ...workspaceWhere(String(secret.workspace_id)) } }, owner).data[0];
  const profile = db.queryTable('profiles', {}, actor).data[0];
  if (!invitation || !['admin', 'member', 'viewer'].includes(String(invitation.role)) || invitation.status !== 'pending' || !Number.isFinite(Date.parse(String(invitation.expires_at))) || Date.parse(String(invitation.expires_at)) <= Date.now()) throw new Error('초대 링크가 유효하지 않거나 만료되었습니다.');
  if (!profile || profile.email !== invitation.email) throw new RlsAccessDeniedError('초대받은 이메일 계정으로 로그인해 주세요.');
  const workspace = db.queryTable('workspaces', { filters: { id: `eq.${secret.workspace_id}` } }, owner).data[0];
  if (!workspace) throw new Error('워크스페이스를 찾을 수 없습니다.');
  return { invitation, workspace, profile, owner };
}
export function runWorkspaceCommand(db: HaloXDatabase, actor: string, payload: Row): Row {
  if (payload.action === 'invite-preview' || payload.action === 'invite-accept') {
    const { invitation, workspace, profile, owner } = readInvitation(db, actor, payload.token);
    if (payload.action === 'invite-preview') return { workspace: { id: workspace.id, name: workspace.name }, email: invitation.email, role: invitation.role, allowed_sections: invitation.allowed_sections, expires_at: invitation.expires_at };
    if (!db.queryTable('workspace_members', { filters: { ...workspaceWhere(String(workspace.id)), user_id: `eq.${actor}` } }, owner).data.length) db.insertTable('workspace_members', { workspace_id: workspace.id, user_id: actor, role: invitation.role, allowed_sections: invitation.allowed_sections, email: profile.email, full_name: profile.full_name, joined_at: new Date().toISOString(), revision: 1 }, owner);
    db.updateTable('workspace_invitations', { status: 'accepted', accepted_by: actor, accepted_at: new Date().toISOString() }, { id: `eq.${invitation.id}` }, owner);
    db.setServerRecords('workspace_invitation_tokens', db.getServerRecords('workspace_invitation_tokens').filter(row => row.invitation_id !== invitation.id));
    return { ok: true, workspace: { id: workspace.id, name: workspace.name, domain: workspace.default_brand_filter || '' } };
  }
  const workspace = contentText(payload.workspace_id, '워크스페이스', 100, true), manager = requireWorkspaceManager(db, workspace, actor);
  if (['policy-update', 'policy-reset'].includes(String(payload.action)) || String(payload.action).startsWith('sitemap-backfill-')) return policyCommand(db, workspace, actor, payload);
  if (payload.action === 'workspace-update') {
    const row = db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0]; checkRevision(row, payload.expected_revision);
    const patch = Object.fromEntries(['name', 'description', 'default_brand_filter', 'brand_name', 'slug'].filter(key => key in payload).map(key => [key, payload[key]]));
    return { ok: true, workspace: db.updateTable('workspaces', patch, { id: `eq.${workspace}` }, actor)[0] };
  }
  if (payload.action === 'invite-create') return createWorkspaceInvitation(db, workspace, actor, payload);
  if (['member-update', 'member-delete'].includes(String(payload.action))) {
    const row = db.queryTable('workspace_members', { filters: { ...workspaceWhere(workspace), id: `eq.${payload.member_id}` } }, actor).data[0];
    if (!row) throw new Error('멤버를 찾을 수 없습니다.'); checkRevision(row, payload.expected_revision);
    grantSections(db, workspace, actor, row.allowed_sections);
    if (row.role === 'owner') throw new RlsAccessDeniedError('소유자는 변경하거나 제거할 수 없습니다.');
    if (manager !== 'owner' && (row.role === 'admin' || payload.role === 'admin')) throw new RlsAccessDeniedError('관리자 변경은 소유자만 할 수 있습니다.');
    if (payload.action === 'member-delete') db.deleteTable('workspace_members', { ...workspaceWhere(workspace), id: `eq.${row.id}` }, actor);
    else db.updateTable('workspace_members', { role: invitationRole(payload.role ?? row.role, manager), allowed_sections: grantSections(db, workspace, actor, payload.allowed_sections ?? row.allowed_sections) }, { ...workspaceWhere(workspace), id: `eq.${row.id}` }, actor);
    return { ok: true };
  }
  if (!['invite-update', 'invite-rotate', 'invite-cancel', 'invite-delete'].includes(String(payload.action))) throw new Error('지원하지 않는 설정 작업입니다.');
  const row = db.queryTable('workspace_invitations', { filters: { ...workspaceWhere(workspace), id: `eq.${payload.invitation_id}` } }, actor).data[0];
  if (!row) throw new Error('초대를 찾을 수 없습니다.'); checkRevision(row, payload.expected_revision);
  if (manager !== 'owner' && row.role === 'admin') throw new RlsAccessDeniedError('관리자 초대 변경은 소유자만 할 수 있습니다.');
  grantSections(db, workspace, actor, row.allowed_sections);
  const drop = () => db.setServerRecords('workspace_invitation_tokens', db.getServerRecords('workspace_invitation_tokens').filter(item => item.invitation_id !== row.id));
  if (payload.action === 'invite-delete') { if (row.status === 'pending' && Date.parse(String(row.expires_at)) > Date.now()) throw new Error('대기 중인 초대는 먼저 취소해 주세요.'); db.deleteTable('workspace_invitations', { id: `eq.${row.id}`, ...workspaceWhere(workspace) }, actor); drop(); return { ok: true }; }
  if (row.status !== 'pending') throw new Error('대기 중인 초대만 변경할 수 있습니다.');
  if (payload.action === 'invite-cancel') { db.updateTable('workspace_invitations', { status: 'cancelled' }, { id: `eq.${row.id}` }, actor); drop(); return { ok: true }; }
  if (Date.parse(String(row.expires_at)) <= Date.now()) throw new Error('만료된 초대는 삭제 후 다시 만들어 주세요.');
  const [invitation] = db.updateTable('workspace_invitations', payload.action === 'invite-update' ? { role: invitationRole(payload.role ?? row.role, manager), allowed_sections: grantSections(db, workspace, actor, payload.allowed_sections ?? row.allowed_sections) } : { expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }, { id: `eq.${row.id}` }, actor);
  // Changing the offered role invalidates the previous link too.
  return { ok: true, invitation, token: tokenFor(db, invitation, actor), delivery: 'link' };
}
