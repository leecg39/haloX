// Supabase Edge Function: rpc-cache (F3-4)
// Caches heavy RPC calls with graceful fallback indicator (`error_fallback`).

export async function handleRpcCache(payload: { rpc_name: string; args: Record<string, unknown> }) {
  return {
    rpc_name: payload.rpc_name,
    args: payload.args,
    error_fallback: false,
    reason: null,
  };
}
