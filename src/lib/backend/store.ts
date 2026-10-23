import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { HaloXDatabase, type DatabaseState } from './database.ts';

export class StorageUnavailableError extends Error {
  readonly code = 'STORAGE_UNAVAILABLE';
  constructor() {
    super('데이터 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    this.name = 'StorageUnavailableError';
  }
}

type Operation<T> = (db: HaloXDatabase) => T | Promise<T>;

/**
 * Local durable storage for the existing domain engine. Each write loads the
 * latest state under a SQLite writer lock and commits the entire operation,
 * including RPC/async provider changes, atomically. No mutable process cache.
 * Readers see the last committed state while an async writer is running.
 */
export class PersistentHaloXStore {
  private readonly filename: string;
  private readonly factory: () => HaloXDatabase;
  private initialized?: Promise<void>;

  constructor(filename: string, factory: () => HaloXDatabase = () => new HaloXDatabase()) {
    this.filename = path.resolve(filename);
    this.factory = factory;
  }

  private open(): DatabaseSync {
    let connection: DatabaseSync | undefined;
    try {
      mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      connection = new DatabaseSync(this.filename);
      chmodSync(this.filename, 0o600);
      // Never synchronously wait for a writer that may be awaiting a provider
      // on this same Node event loop. Retry lock acquisition asynchronously.
      connection.exec('PRAGMA busy_timeout = 0');
      return connection;
    } catch {
      connection?.close();
      throw new StorageUnavailableError();
    }
  }

  private async retryLock(action: () => void): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        action();
        return;
      } catch (error) {
        const extendedCode = (error as { errcode?: number }).errcode;
        // node:sqlite can return extended codes (e.g. BUSY_RECOVERY = 261).
        // The low byte is SQLite's primary code. Only retry acquiring the lock;
        // the domain operation has not started and must never be replayed here.
        const code = typeof extendedCode === 'number' ? extendedCode & 0xff : undefined;
        if (code !== 5 && code !== 6) throw new StorageUnavailableError(); // SQLITE_BUSY / SQLITE_LOCKED
        if (Date.now() >= deadline) throw new StorageUnavailableError();
        await delay(25);
      }
    }
  }

  private async initialize(): Promise<void> {
    const connection = this.open();
    let transaction = false;
    try {
      await this.retryLock(() => connection.exec('PRAGMA journal_mode = WAL'));
      await this.retryLock(() => connection.exec('BEGIN IMMEDIATE'));
      transaction = true;
      connection.exec(`CREATE TABLE IF NOT EXISTS runtime_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      if (!connection.prepare('SELECT id FROM runtime_state WHERE id = 1').get()) {
        connection.prepare('INSERT INTO runtime_state (id, revision, state, updated_at) VALUES (1, 0, ?, ?)')
          .run(JSON.stringify(this.factory().exportState()), new Date().toISOString());
      }
      connection.exec('COMMIT');
      transaction = false;
    } finally {
      if (transaction) connection.exec('ROLLBACK');
      connection.close();
    }
  }

  private async ready(): Promise<void> {
    this.initialized ??= this.initialize().catch(error => {
      this.initialized = undefined;
      throw error;
    });
    try {
      await this.initialized;
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError();
    }
  }

  private load(connection: DatabaseSync): HaloXDatabase {
    try {
      const row = connection.prepare('SELECT state FROM runtime_state WHERE id = 1').get();
      if (!row || typeof row.state !== 'string') throw new Error('Database state is missing');
      const db = this.factory();
      db.restoreState(JSON.parse(row.state) as DatabaseState);
      return db;
    } catch {
      // Do not silently replace unreadable data with demo seeds.
      throw new StorageUnavailableError();
    }
  }

  async read<T>(operation: Operation<T>): Promise<T> {
    await this.ready();
    const connection = this.open();
    try {
      return await operation(this.load(connection));
    } finally {
      connection.close();
    }
  }

  async write<T>(operation: Operation<T>): Promise<T> {
    await this.ready();
    const connection = this.open();
    let transaction = false;
    try {
      await this.retryLock(() => connection.exec('BEGIN IMMEDIATE'));
      transaction = true;
      const db = this.load(connection);
      // Domain errors propagate unchanged and roll back all partial writes.
      const result = await operation(db);
      try {
        connection.prepare('UPDATE runtime_state SET revision = revision + 1, state = ?, updated_at = ? WHERE id = 1')
          .run(JSON.stringify(db.exportState()), new Date().toISOString());
        connection.exec('COMMIT');
      } catch {
        throw new StorageUnavailableError();
      }
      transaction = false;
      return result;
    } finally {
      if (transaction) connection.exec('ROLLBACK');
      connection.close();
    }
  }
}

// Construction does not open/create files during a Next.js build.
export const haloxStore = new PersistentHaloXStore(
  process.env.HALOX_DATABASE_PATH || path.join(process.cwd(), 'data', 'halox.sqlite'),
);
