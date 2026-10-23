import { defineConfig } from '@playwright/test';

// E2E journeys (docs/clone/user-journeys.md J1–J6) against a production build.
// A dedicated port keeps these runs away from dev servers on 3000/3001.
const PORT = Number(process.env.E2E_PORT || 3107);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
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
  },
});
