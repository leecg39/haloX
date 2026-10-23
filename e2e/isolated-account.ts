import crypto from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';

// Keep each journey within the production per-account request budget.
export async function loginIsolatedAccount(page: Page, prefix: string) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), password = 'isolated-e2e-account-password';
  const hash = await hashPassword(password);
  const user = await store.write(db => db.createAccount({ email: `${prefix}-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: `${prefix} 검증`, passwordHash: hash }));
  const response = await page.request.post('/api/v1/auth', { data: { email: user.email, password } }); expect(response.status()).toBe(200);
  return user.id;
}
