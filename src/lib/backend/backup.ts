import crypto from 'node:crypto';
import { chmod, link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HaloXDatabase, type DatabaseState } from './database.ts';
import { PersistentHaloXStore } from './store.ts';

const BACKUP_FORMAT = 'halox-runtime-backup';
const MAX_BACKUP_BYTES = 128 * 1024 * 1024;

interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: 1;
  created_at: string;
  checksum_sha256: string;
  payload_base64: string;
}

function encodedState(state: DatabaseState): Buffer {
  return Buffer.from(JSON.stringify(state), 'utf8');
}

function checksum(payload: Buffer): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function validateEnvelope(value: unknown): { envelope: BackupEnvelope; state: DatabaseState } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('백업 파일 형식이 올바르지 않습니다.');
  const envelope = value as Partial<BackupEnvelope>;
  if (envelope.format !== BACKUP_FORMAT || envelope.version !== 1 || typeof envelope.created_at !== 'string' ||
      typeof envelope.checksum_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.checksum_sha256) ||
      typeof envelope.payload_base64 !== 'string') throw new Error('지원하지 않거나 손상된 백업 파일입니다.');
  const payload = Buffer.from(envelope.payload_base64, 'base64');
  if (payload.toString('base64') !== envelope.payload_base64 || payload.length > MAX_BACKUP_BYTES) throw new Error('백업 데이터가 손상되었거나 너무 큽니다.');
  const actual = Buffer.from(checksum(payload), 'hex'), expected = Buffer.from(envelope.checksum_sha256, 'hex');
  if (!crypto.timingSafeEqual(actual, expected)) throw new Error('백업 무결성 검증에 실패했습니다.');
  let state: DatabaseState;
  try { state = JSON.parse(payload.toString('utf8')) as DatabaseState; } catch { throw new Error('백업 데이터 JSON이 손상되었습니다.'); }
  // Validate every table and private collection before opening a write transaction.
  new HaloXDatabase().restoreState(state);
  return { envelope: envelope as BackupEnvelope, state };
}

async function writePrivateAtomic(filename: string, body: string, overwrite: boolean): Promise<void> {
  const target = path.resolve(filename), directory = path.dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    if (overwrite) await rename(temporary, target);
    else { await link(temporary, target); await rm(temporary); }
    await chmod(target, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`백업 파일이 이미 존재합니다: ${target}`);
    throw error;
  }
}

export async function createStoreBackup(databasePath: string, outputPath: string, options: { overwrite?: boolean; now?: Date } = {}) {
  const state = await new PersistentHaloXStore(databasePath).read(db => db.exportState());
  const payload = encodedState(state);
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: 1,
    created_at: (options.now ?? new Date()).toISOString(),
    checksum_sha256: checksum(payload),
    payload_base64: payload.toString('base64'),
  };
  await writePrivateAtomic(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, options.overwrite === true);
  return { path: path.resolve(outputPath), created_at: envelope.created_at, checksum_sha256: envelope.checksum_sha256, bytes: payload.length };
}

export async function readStoreBackup(backupPath: string) {
  const input = await readFile(path.resolve(backupPath));
  if (input.length > MAX_BACKUP_BYTES * 2) throw new Error('백업 파일이 너무 큽니다.');
  let parsed: unknown;
  try { parsed = JSON.parse(input.toString('utf8')); } catch { throw new Error('백업 파일 JSON이 손상되었습니다.'); }
  return validateEnvelope(parsed);
}

export async function restoreStoreBackup(backupPath: string, databasePath: string) {
  const { envelope, state } = await readStoreBackup(backupPath);
  const store = new PersistentHaloXStore(databasePath);
  // PersistentHaloXStore commits this replacement under BEGIN IMMEDIATE. A
  // failed validation or SQLite write therefore leaves the previous state intact.
  await store.write(db => db.restoreState(state));
  return { path: path.resolve(databasePath), created_at: envelope.created_at, checksum_sha256: envelope.checksum_sha256 };
}
