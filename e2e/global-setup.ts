import { request, type FullConfig } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

export const STATE_FILE = path.join(__dirname, '.auth', 'state.json');

/** Log in once through the real login API and persist the session cookie for all tests. */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use.baseURL;
  const password = process.env.HALOX_DEMO_PASSWORD;
  if (!password) throw new Error('HALOX_DEMO_PASSWORD is not set (create .env.local from .env.example)');

  const ctx = await request.newContext({ baseURL });
  try {
    const res = await ctx.post('/api/v1/auth', { data: { email: 'demo@halox.local', password } });
    if (res.status() !== 200) throw new Error(`E2E login failed: HTTP ${res.status()} ${await res.text()}`);
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await ctx.storageState({ path: STATE_FILE });
    // Export journeys use a separate actor's existing session. The auth suite later
    // locks this actor's new logins; it does not revoke sessions already issued.
    const exportsLogin = await ctx.post('/api/v1/auth', { data: { email: 'other@halox.local', password } });
    if (exportsLogin.status() !== 200) throw new Error(`Export fixture login failed: HTTP ${exportsLogin.status()}`);
    await ctx.storageState({ path: path.join(__dirname, '.auth', 'export-state.json') });
    // Raw data journeys use another actor so independent suites do not share
    // the same per-minute API budget. Production limits stay unchanged.
    const rawLogin = await ctx.post('/api/v1/auth', { data: { email: 'admin@halox.local', password } });
    if (rawLogin.status() !== 200) throw new Error(`Raw fixture login failed: HTTP ${rawLogin.status()}`);
    await ctx.storageState({ path: path.join(__dirname, '.auth', 'raw-state.json') });
  } finally {
    await ctx.dispose();
  }
}
