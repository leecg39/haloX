import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, haloxDb } from '@/lib/backend/database';

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-halox-user-id') || DEFAULT_USER_ID;
  const profiles = haloxDb.queryTable('profiles', {}, userId).data;
  const workspaces = haloxDb.queryTable('workspaces', {}, userId).data;
  return NextResponse.json({
    authenticated: true,
    user: profiles[0] || { id: userId, email: 'demo@halox.local', full_name: 'HaloX 데모 관리자' },
    default_workspace_id: workspaces[0]?.id || DEFAULT_WORKSPACE_ID,
    workspaces,
  });
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-halox-user-id') || DEFAULT_USER_ID;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Allow empty body for session check
  }
  const method = String(body.method || 'password');
  haloxDb.callRpc('record_auth_login', { p_method: method, p_device_id: null }, userId);
  const workspaces = haloxDb.queryTable('workspaces', {}, userId).data;

  return NextResponse.json({
    ok: true,
    user: {
      id: userId,
      email: String(body.email || 'demo@halox.local'),
      full_name: 'HaloX 데모 관리자',
    },
    access_token: `halox-local-jwt-${userId.slice(0, 8)}`,
    default_workspace_id: workspaces[0]?.id || DEFAULT_WORKSPACE_ID,
    workspaces,
  });
}
