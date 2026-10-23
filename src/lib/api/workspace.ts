import { fetchTable } from "./client";

export interface ActiveWorkspaceInfo {
  id: string;
  name: string;
  plan: string;
  domain?: string;
}

export const ACTIVE_WORKSPACE_STORAGE_KEY = "halox-clone:active-workspace";
export const EMPTY_WORKSPACE_INFO: ActiveWorkspaceInfo = { id: "", name: "워크스페이스 선택", plan: "" };

export const DEFAULT_WORKSPACE_INFO: ActiveWorkspaceInfo = {
  id: "11111111-1111-4000-8000-111111111111",
  name: "브리찌",
  plan: "Trial",
  domain: "brizzi.kr",
};

export function readActiveWorkspace(): ActiveWorkspaceInfo {
  if (typeof window === "undefined") return EMPTY_WORKSPACE_INFO;
  try {
    const raw = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    if (!raw) return EMPTY_WORKSPACE_INFO;
    const parsed = JSON.parse(raw) as Partial<ActiveWorkspaceInfo>;
    if (parsed && typeof parsed.name === "string" && parsed.name.trim()) {
      return {
        id: parsed.id || "",
        name: parsed.name.trim(),
        plan: parsed.plan || "Trial",
        domain: parsed.domain || "",
      };
    }
  } catch {
    // Ignore storage read error
  }
  return EMPTY_WORKSPACE_INFO;
}

export function writeActiveWorkspace(ws: ActiveWorkspaceInfo): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, JSON.stringify(ws));
  } catch {
    // Ignore storage quota error
  }
  window.dispatchEvent(new CustomEvent("halox:workspace-changed", { detail: ws }));
}

export async function loadAllWorkspaces(): Promise<ActiveWorkspaceInfo[]> {
  const [workspaces, plans] = await Promise.all([
    fetchTable<{ id: string; name: string; default_brand_filter?: string }>("workspaces"),
    fetchTable<{ workspace_id: string; plan: string }>("workspace_plans"),
  ]);
  return workspaces.map(row => ({
    id: row.id, name: row.name,
    plan: plans.find(plan => plan.workspace_id === row.id)?.plan || "Trial",
    domain: row.default_brand_filter || "",
  }));
}
