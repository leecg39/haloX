/** Shared policy vocabulary. The server always reads the current membership. */
export const SECTIONS = { dashboard: '대시보드', analysis: '분석', strategy: '전략', execution: '실행', monitoring: '모니터링', other: '기타' } as const;
export type Section = keyof typeof SECTIONS;
export type Permission = { role: string; allowed_sections: string[] };
export const NO_PERMISSION: Permission = { role: '', allowed_sections: [] };
export function normalizeSections(value: unknown): string[] {
  if (value === undefined) return ['all']; // Existing memberships retain their access.
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !(item === 'all' || Object.hasOwn(SECTIONS, item))) || new Set(value).size !== value.length || (value.includes('all') && value.length !== 1)) throw new Error('메뉴 권한을 확인해 주세요.');
  return !value.length || value.length === Object.keys(SECTIONS).length ? ['all'] : [...value];
}
export function canAccess(permission: Permission, section?: Section): boolean {
  if (!['owner', 'admin', 'member', 'viewer'].includes(permission.role)) return false;
  return permission.role === 'owner' || !section || permission.allowed_sections.includes('all') || permission.allowed_sections.includes(section);
}
export function canWrite(permission: Permission): boolean { return canAccess(permission) && permission.role !== 'viewer'; }
export function routeSection(url: string): Section | undefined {
  const [path, query = ''] = url.split('?');
  if (path === '/app') return 'dashboard';
  if (/^\/app\/(keywords|seo|geo)(\/|$)/.test(path)) return 'analysis';
  if (/^\/app\/(strategy-map|site-audit|gap)(\/|$)/.test(path)) return 'strategy';
  if (/^\/app\/(factory|optimize|exports)(\/|$)/.test(path)) return 'execution';
  if (/^\/app\/(monitoring|reports)(\/|$)/.test(path)) return 'monitoring';
  if (/^\/app\/(personas|knowledgehub|raw-data)(\/|$)/.test(path)) return 'other';
  if (path === '/app/settings' && new URLSearchParams(query).get('tab') !== 'profile') return 'other';
}
export function sectionLabels(value: unknown): string {
  const sections = normalizeSections(value);
  return sections.includes('all') ? '전체 메뉴' : sections.map(key => SECTIONS[key as Section]).join(' · ');
}
