import path from 'node:path';
import { createStoreBackup } from '../src/lib/backend/backup.ts';

const output = process.argv[2];
if (!output) {
  console.error('사용법: npm run backup:data -- <backup-file>');
  process.exitCode = 1;
} else {
  const database = process.env.HALOX_DATABASE_PATH || path.join(process.cwd(), 'data', 'halox.sqlite');
  const result = await createStoreBackup(database, output);
  console.log(`백업 완료: ${result.path}`);
  console.log(`SHA-256: ${result.checksum_sha256}`);
}
