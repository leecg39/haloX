import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';

/** Workspace management reads one consistent, membership-filtered snapshot. */
export async function GET(request: NextRequest) {
  const auth = authenticate(request);
  if (auth.response) return auth.response;
  try {
    const data = await haloxStore.read(db => ({
      user_id: auth.actor,
      workspaces: db.queryTable('workspaces', {}, auth.actor).data,
      members: db.queryTable('workspace_members', {}, auth.actor).data,
      plans: db.queryTable('workspace_plans', {}, auth.actor).data,
      counts: ['keywords', 'geo_prompts', 'content_jobs'].map(table => db.queryTable(table, { select: 'workspace_id' }, auth.actor).data),
    }));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    const error = new StorageUnavailableError();
    return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
  }
}
