import fs from 'node:fs/promises';
import path from 'node:path';

export default async function globalTeardown() {
  const filename = process.env.HALOX_E2E_DATABASE_PATH;
  const directory = path.join(process.cwd(), 'e2e', '.auth');
  if (!filename || path.dirname(filename) !== directory || !path.basename(filename).startsWith('runtime-')) return;
  for (const suffix of ['', '-shm', '-wal']) await fs.rm(filename + suffix, { force: true });
}
