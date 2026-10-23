import path from 'node:path';
import { restoreStoreBackup } from '../src/lib/backend/backup.ts';

const input = process.argv[2];
if (!input) {
  console.error('사용법: npm run restore:data -- <backup-file>');
  process.exitCode = 1;
} else {
  const database = process.env.HALOX_DATABASE_PATH || path.join(process.cwd(), 'data', 'halox.sqlite');
  const result = await restoreStoreBackup(input, database);
  console.log(`복원 완료: ${result.path}`);
  console.log(`백업 SHA-256: ${result.checksum_sha256}`);
}
