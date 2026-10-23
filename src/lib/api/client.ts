/**
 * HaloX Frontend API Client (S4–S7)
 * Provides typed PostgREST, RPC, and Edge Function wrappers with `rpc-cache` fallback
 * and automatic synchronization from DemoDialog / Workspaces actions.
 */

import type { DialogResult } from '@/types/clone';
import { validateRpcResponse } from './schemas';

export const DEFAULT_WORKSPACE_UUID = '11111111-1111-4000-8000-111111111111';

export async function fetchTable<T = Record<string, unknown>>(
  table: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/v1/rest/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to query table ${table}`);
  }
  return (await res.json()) as T[];
}

export async function updateTableRows<T = Record<string, unknown>>(
  table: string,
  patch: Record<string, unknown>,
  filters: Record<string, string> = {}
): Promise<T[]> {
  const qs = new URLSearchParams(filters).toString();
  const res = await fetch(`/api/v1/rest/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to update table ${table}`);
  }
  return (await res.json()) as T[];
}

export async function deleteTableRows<T = Record<string, unknown>>(
  table: string,
  filters: Record<string, string> = {}
): Promise<T[]> {
  const qs = new URLSearchParams(filters).toString();
  const res = await fetch(`/api/v1/rest/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to delete from table ${table}`);
  }
  return (await res.json()) as T[];
}

export async function callRpcEndpoint<T = unknown>(
  rpcName: string,
  args: Record<string, unknown> = {},
  useCacheProxy = false
): Promise<T> {
  if (useCacheProxy) {
    const cacheRes = await fetch('/api/v1/functions/rpc-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpc_name: rpcName, args }),
    });
    if (cacheRes.ok) {
      const wrapped = (await cacheRes.json()) as {
        data: T;
        error_fallback: boolean;
      };
      if (!wrapped.error_fallback) {
        validateRpcResponse(rpcName, wrapped.data);
        return wrapped.data;
      }
    }
  }

  const res = await fetch(`/api/v1/rpc/${encodeURIComponent(rpcName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `RPC ${rpcName} failed`);
  }
  const data = (await res.json()) as T;
  validateRpcResponse(rpcName, data);
  return data;
}

export async function invokeEdgeEndpoint<T = Record<string, unknown>>(
  functionName: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(`/api/v1/functions/${encodeURIComponent(functionName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Edge function ${functionName} failed`);
  }
  return (await res.json()) as T;
}

/**
 * Synchronize user dialog submissions with the reconstructed backend pipeline
 * without blocking or breaking offline localStorage persistence.
 */
export async function syncDialogActionToBackend(result: DialogResult): Promise<void> {
  try {
    const route = result.route.split('?')[0];
    const deletedId = result.values?.deletedId;
    if (deletedId) {
      let targetTable = 'keywords';
      if (route === '/app/workspaces') targetTable = 'workspaces';
      else if (route.startsWith('/app/geo')) targetTable = 'geo_prompts';
      else if (route.startsWith('/app/site-audit')) targetTable = 'site_audit_scans';
      else if (route.startsWith('/app/factory') || route.startsWith('/app/optimize')) targetTable = 'content_jobs';
      else if (route.startsWith('/app/reports')) targetTable = 'report_snapshots';
      else if (/API|키 발급/i.test(result.title)) targetTable = 'workspace_api_keys';

      await deleteTableRows(targetTable, { id: `eq.${deletedId}` });
      return;
    }

    const names = (result.records || (result.record ? [result.record] : []))
      .map(r => r.name)
      .filter(Boolean);
    if (!names.length) return;

    if (route === '/app/workspaces') {
      await fetch('/api/v1/rest/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: names[0] }),
      });
      return;
    }

    if (/초대/.test(result.title)) {
      await invokeEdgeEndpoint('workspace-invite', {
        workspace_id: DEFAULT_WORKSPACE_UUID,
        email: names[0],
        role: 'member',
      });
      return;
    }

    if (route.startsWith('/app/keywords') || /키워드/.test(result.title)) {
      await invokeEdgeEndpoint('keywords-collect', {
        workspace_id: DEFAULT_WORKSPACE_UUID,
        keywords: names,
      });
      return;
    }

    if (route.startsWith('/app/geo') || /프롬프트/.test(result.title)) {
      for (const promptText of names) {
        await invokeEdgeEndpoint('geo-run', {
          workspace_id: DEFAULT_WORKSPACE_UUID,
          prompt_text: promptText,
          engine: 'openai',
        });
      }
      return;
    }

    if (route.startsWith('/app/site-audit') || /진단/.test(result.title)) {
      await invokeEdgeEndpoint('site-audit', {
        workspace_id: DEFAULT_WORKSPACE_UUID,
        target_url: names[0],
      });
      return;
    }

    if (route.startsWith('/app/optimize') || /최적화/.test(result.title)) {
      await invokeEdgeEndpoint('optimize-audit-content', {
        workspace_id: DEFAULT_WORKSPACE_UUID,
        url: names[0],
        target_keyword: names[0],
      });
      return;
    }

    if (route.startsWith('/app/factory') || /콘텐츠|제작/.test(result.title)) {
      await invokeEdgeEndpoint('content-draft', {
        workspace_id: DEFAULT_WORKSPACE_UUID,
        target_keyword: names[0],
        title: names[0],
      });
      return;
    }

    if (route.startsWith('/app/strategy-map')) {
      await invokeEdgeEndpoint('strategy-map-orchestrator', {
        workspace_id: DEFAULT_WORKSPACE_UUID,
        cluster_label: names[0],
      });
      return;
    }

    if (route.startsWith('/app/agent')) {
      await invokeEdgeEndpoint('agent-chat', {
        workspace_id: DEFAULT_WORKSPACE_UUID,
        message: names[0],
      });
      return;
    }

    if (route.startsWith('/app/reports')) {
      await invokeEdgeEndpoint('report-snapshot', {
        workspace_id: DEFAULT_WORKSPACE_UUID,
        period_type: 'week',
      });
      return;
    }

    if (/API|키 발급/i.test(result.title)) {
      const keyPrefix = (result.values.demoKey || 'hx_live_demo').slice(0, 12);
      await fetch('/api/v1/rest/workspace_api_keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: DEFAULT_WORKSPACE_UUID,
          name: names[0],
          key_prefix: keyPrefix,
          key_hash: 'sha256-local-demo',
        }),
      });
    }
  } catch {
    // Non-blocking fallback: local storage remains authoritative when offline.
  }
}
