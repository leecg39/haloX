import type { ContentRow } from './content.ts';
export const AUDIT_TABLES = ['site_audit_targets', 'site_audit_scans', 'site_audit_pages', 'site_audit_issues'] as const;
export type AuditData = Record<typeof AUDIT_TABLES[number], ContentRow[]>;
export const AUDIT_STATUS = { queued: '대기 중', running: '진단 중', completed: '완료', failed: '실패', cancelled: '취소됨' };
export const AUDIT_SEVERITY = { critical: '오류', warning: '주의', notice: '안내' };
export type AuditScope = { include_paths: string[]; exclude_paths: string[] };
export type AuditTarget = { name: string; target_url: string; max_pages: number; max_depth: number; scope_rules: AuditScope };
export const AUDIT_ACTIVE = ['queued', 'running'];

export const isImportedAudit = (scan: ContentRow) => Boolean(scan.import_batch_id) && String(scan.provider).startsWith('import:');
export const hasAuditMeasurements = (scan: ContentRow) => scan.provider === 'html' || isImportedAudit(scan);
