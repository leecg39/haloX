import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { runtimeProviderStatus } from '@/lib/backend/runtime-providers';

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth.response) return auth.response;
  return NextResponse.json(runtimeProviderStatus(), { headers: { 'Cache-Control': 'private, no-store' } });
}
