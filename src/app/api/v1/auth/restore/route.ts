import { NextResponse } from 'next/server';
import { accountBody, accountClient, accountError } from '@/lib/api/account-http';
import { haloxStore } from '@/lib/backend/store';
import { restoreAccount } from '@/lib/backend/account-deletion-service';
export async function POST(request: Request) {
  try { return NextResponse.json(await restoreAccount(haloxStore, await accountBody(request), accountClient(request)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return accountError(error); }
}
