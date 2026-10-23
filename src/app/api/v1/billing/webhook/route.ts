import { applyBillingWebhook } from '@/lib/backend/billing-service';
import { haloxStore } from '@/lib/backend/store';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const raw = await request.text(); if (raw.length > 65_536) return new Response('INVALID', { status: 413, headers: { 'Content-Type': 'text/plain' } });
    const body: unknown = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid payload');
    await applyBillingWebhook(haloxStore, body as Record<string, unknown>);
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch { return new Response('INVALID', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }); }
}
