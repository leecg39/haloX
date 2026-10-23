'use client';

import { NO_PERMISSION, type Permission } from '@/lib/permissions/workspace';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ACTIVE_WORKSPACE_STORAGE_KEY, EMPTY_WORKSPACE_INFO, readActiveWorkspace, type ActiveWorkspaceInfo } from '@/lib/api/workspace';

type SessionUser = { id: string; email?: string; full_name?: string };
type SessionView = { permissions: Record<string, Permission>; user: SessionUser; workspaces: { id: string; name: string; default_brand_filter?: string }[]; workspace_plans: { workspace_id: string; plan: string }[] };
type WorkspaceState = { permissions: Record<string, Permission>; user: SessionUser | null; activeWorkspace: ActiveWorkspaceInfo; workspaces: ActiveWorkspaceInfo[]; loading: boolean; error: string; reload: () => Promise<void> };
const Context = createContext<WorkspaceState | null>(null);
const publicRoute = /^\/app\/(login|signup|forgot-password|reset-password|find-email|auth\/callback|verify-phone|invite)(\/|$)/;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const enabled = pathname.startsWith('/app') && !publicRoute.test(pathname);
  const [state, setState] = useState<Omit<WorkspaceState, 'reload'>>({ permissions: {}, user: null, activeWorkspace: EMPTY_WORKSPACE_INFO, workspaces: [], loading: true, error: '' });
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setState(old => ({ ...old, loading: !old.user, error: '' }));
    try {
      const session = await fetch('/api/v1/auth');
      if (request !== generation.current) return;
      if (session.status === 401) { router.replace('/app/login'); throw new Error('로그인이 필요합니다.'); }
      if (!session.ok) throw new Error('계정 정보를 불러오지 못했습니다.');
      const sessionView = await session.json() as SessionView;
      const workspaces = sessionView.workspaces.map(row => ({ id: row.id, name: row.name, domain: row.default_brand_filter || '', plan: sessionView.workspace_plans.find(plan => plan.workspace_id === row.id)?.plan || 'Trial' }));
      if (request !== generation.current) return;
      const activeWorkspace = workspaces.find(row => row.id === readActiveWorkspace().id) || workspaces[0] || EMPTY_WORKSPACE_INFO;
      try { localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, JSON.stringify(activeWorkspace)); } catch {}
      setState({ permissions: sessionView.permissions, user: sessionView.user, activeWorkspace, workspaces, loading: false, error: '' });
    } catch (error) {
      if (request === generation.current) setState({ permissions: {}, user: null, activeWorkspace: EMPTY_WORKSPACE_INFO, workspaces: [], loading: false, error: error instanceof Error ? error.message : '워크스페이스를 불러오지 못했습니다.' });
    }
  }, [router]);
  useEffect(() => {
    if (!enabled) { ++generation.current; setState({ permissions: {}, user: null, activeWorkspace: EMPTY_WORKSPACE_INFO, workspaces: [], loading: false, error: '' }); return; }
    void reload();
    const changed = () => { void reload(); };
    const storage = (event: StorageEvent) => { if (event.key === ACTIVE_WORKSPACE_STORAGE_KEY) changed(); };
    window.addEventListener('focus', changed);
    window.addEventListener('halox:permissions-changed', changed);
    window.addEventListener('halox:workspace-changed', changed);
    window.addEventListener('halox:record-created', changed);
    window.addEventListener('storage', storage);
    return () => { ++generation.current; window.removeEventListener('focus', changed); window.removeEventListener('halox:permissions-changed', changed); window.removeEventListener('halox:workspace-changed', changed); window.removeEventListener('halox:record-created', changed); window.removeEventListener('storage', storage); };
  }, [enabled, reload, pathname]);
  return <Context.Provider value={{ ...state, reload }}>{children}</Context.Provider>;
}

export function useWorkspace() {
  const state = useContext(Context);
  if (!state) throw new Error('WorkspaceProvider is required');
  return { ...state, permission: state.permissions[state.activeWorkspace.id] || NO_PERMISSION };
}
