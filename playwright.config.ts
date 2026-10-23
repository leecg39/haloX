import { defineConfig } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Same env files the Next.js server reads (.env.local holds the session secret and demo password).
loadEnvConfig(process.cwd());
process.env.HALOX_E2E_DATABASE_PATH ||= path.join(process.cwd(), 'e2e', '.auth', `runtime-${randomUUID()}.sqlite`);

// E2E journeys (docs/clone/user-journeys.md J1–J6) against a production build.
// A dedicated port keeps these runs away from dev servers on 3000/3001.
const PORT = Number(process.env.E2E_PORT || 3107);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    storageState: path.join(__dirname, 'e2e', '.auth', 'state.json'),
    channel: 'chrome', // use the installed Google Chrome; no browser download needed
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/app`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Plain-http localhost run: allow the session cookie without the Secure flag.
    env: { SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', HALOX_DISABLE_NOTIFICATION_WORKER: '1', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', HALOX_DISABLE_GOOGLE_WORKER: '1', NICEPAY_CLIENT_KEY: '', NICEPAY_SECRET_KEY: '', HALOX_DISABLE_BILLING_WORKER: '1', HALOX_INSECURE_COOKIES: '1', HALOX_DATABASE_PATH: process.env.HALOX_E2E_DATABASE_PATH, SOLAPI_API_KEY: '', SOLAPI_API_SECRET: '', SOLAPI_SENDER: '', OPENAI_API_KEY: '', OPENAI_TRANSLATION_MODEL: 'gpt-4.1-mini', HALOX_DISABLE_AUDIT_WORKER: '1', HALOX_DISABLE_SCHEDULER: '0', HALOX_SCHEDULER_INTERVAL_MS: '1000', HALOX_DISABLE_OBSERVABILITY_WORKER: '0', HALOX_OBSERVABILITY_INTERVAL_MS: '1000' },
  },
});
