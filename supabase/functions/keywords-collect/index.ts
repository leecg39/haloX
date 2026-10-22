// Supabase Edge Function: keywords-collect (S5)
// Collects search volume, difficulty, intent, and SERP snapshot via deterministic Provider adapter.

export async function handleKeywordsCollect(payload: { workspace_id: string; keyword_ids?: string[]; keywords?: string[] }) {
  const items = payload.keywords || payload.keyword_ids || [];
  return {
    ok: true,
    function: 'keywords-collect',
    workspace_id: payload.workspace_id,
    processed: items.length,
    provider: 'deterministic-mock',
    timestamp: new Date().toISOString(),
  };
}
