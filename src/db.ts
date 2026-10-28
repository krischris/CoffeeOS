import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import ehParquet from './vendor/duckdb/eh/parquet.duckdb_extension.wasm?url';
import mvpParquet from './vendor/duckdb/mvp/parquet.duckdb_extension.wasm?url';
import type { Bean, BrewSession } from './types';

import { isBeanPhoto, isValidBeanPhoto } from './photos';
import { backupLimits } from './backupContract';
import { sha256 } from './hash';

type StorageMode = 'opfs' | 'indexeddb' | 'memory';
type SQLValue = string | number | null;

interface Database {
  db: duckdb.AsyncDuckDB;
  connection: duckdb.AsyncDuckDBConnection;
  snapshots: IDBDatabase | null;
  storage: StorageMode;
}

interface Snapshot {
  beans: Uint8Array;
  brew_sessions: Uint8Array;
}

const databasePath = 'opfs://coffeos.db';
const snapshotKey = 'tables-v1';
const tables = ['beans', 'brew_sessions'] as const;
const beanColumns = `id, name, CAST(roast_date AS VARCHAR) AS roast_date,
  CAST(freeze_date AS VARCHAR) AS freeze_date,
  strftime(created_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS created_at, photo_jpeg, CAST(beans AS VARCHAR) AS _record_version`;
const sessionColumns = `s.id, s.bean_id, b.name AS bean_name,
  strftime(s.brewed_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS brewed_at,
  s.dose_g, s.water_g, s.time_str, s.temp_c, s.grind_um, s.comment,
  s.yield_g, s.tds_pct, s.extraction_pct, CAST(s AS VARCHAR) AS _record_version`;

export class DatabaseStartupError extends Error {}
export class DatabaseRuntimeError extends Error {
  constructor() { super('The database worker stopped responding. The last change may or may not have committed. Do not submit it again. Reload to reopen saved storage; no replacement collection will be created.'); }
}
interface EngineHealth { interrupted: Promise<never>; failure?: Error }
const engineHealth = new WeakMap<duckdb.AsyncDuckDB, EngineHealth>();
let startupPhase = 'Waiting to open saved storage';
export function getDatabaseStartupPhase(): string { return startupPhase; }
let releaseOwnership: (() => void) | null = null;

// A second in-memory engine would overwrite the first engine's whole snapshot.
// Hold ownership for the engine's lifetime, including reads and exports.
async function acquireOwnership(): Promise<void> {
  if (!navigator.locks) throw new DatabaseStartupError('This browser cannot safely coordinate coffee storage. Please use a browser with Web Locks support.');
  await new Promise<void>((resolve, reject) => {
    void navigator.locks.request('coffeos-database', { ifAvailable: true }, async lock => {
      if (!lock) {
        reject(new DatabaseStartupError('CoffeeOS is already open in another tab or window. Close it, then reload here.'));
        return;
      }
      await new Promise<void>(release => {
        releaseOwnership = release;
        resolve();
      });
    }).catch(reject);
  });
}

export function getStorageMode(): StorageMode | null { return database?.storage ?? null; }

let collectionRevision = 0;
let database: Database | null = null;
let initialization: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

// DuckDB has one connection. Serialize transactions, snapshots, reads, and teardown.
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => undefined);
  return result;
}

function openSnapshots(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('coffeos-snapshots', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Snapshot storage is blocked by another tab.'));
    };
    request.onsuccess = () => {
      const store = request.result;
      if (blocked) {
        store.close();
        return;
      }
      store.onversionchange = () => store.close();
      resolve(store);
    };
  });
}

function readRecord<T>(store: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = store.transaction('snapshots', 'readonly');
    const request = transaction.objectStore('snapshots').get(key);
    transaction.oncomplete = () => resolve(request.result as T | undefined);
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not read saved coffee data.'));
    transaction.onerror = () => { /* onabort reports the final transaction failure. */ };
  });
}

function storeRecord(store: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = store.transaction('snapshots', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not save coffee data.'));
    transaction.onerror = () => { /* onabort reports the final transaction failure. */ };
    // Both tables belong to a single atomic record, so references stay consistent.
    transaction.objectStore('snapshots').put(value, key);
  });
}

async function snapshotTables(state: Database, key = snapshotKey): Promise<void> {
  if (!state.snapshots) return;
  await storeRecord(state.snapshots, key, await captureTables(state));
}

async function captureTables(state: Database): Promise<Snapshot> {
  const buffers = {} as Snapshot;
  for (const table of tables) {
    const path = `snapshot-${table}.parquet`;
    try {
      await state.connection.query(`COPY ${table} TO '${path}' (FORMAT PARQUET)`);
      buffers[table] = await state.db.copyFileToBuffer(path);
    } finally {
      await state.db.dropFile(path);
    }
  }
  return buffers;
}

async function validateStoredSchema(connection: duckdb.AsyncDuckDBConnection, table: typeof tables[number], source: string): Promise<void> {
  const result = await connection.query(`DESCRIBE SELECT * FROM ${source}`);
  const columns = result.toArray().map(row => [row.column_name, row.column_type]);
  const expected = Object.entries(ioSchema[table]);
  const legacy = table === 'beans' && JSON.stringify(columns) === JSON.stringify(expected.filter(([name]) => name !== 'photo_jpeg'));
  if (!legacy && JSON.stringify(columns) !== JSON.stringify(expected)) {
    throw new DatabaseStartupError('The saved database format is unsupported. Use a compatible CoffeeOS version; saved data has been kept.');
  }
}

async function restoreSnapshot(state: Database, snapshot: Snapshot): Promise<void> {
  await state.connection.query('BEGIN TRANSACTION');
  try {
    // Restore parents first to satisfy the foreign key on brew_sessions.
    for (const table of tables) {
      const path = `restore-${table}.parquet`;
      await state.db.registerFileBuffer(path, new Uint8Array(snapshot[table]));
      try {
        await validateStoredSchema(state.connection, table, `read_parquet('${path}')`);
        await state.connection.query(`INSERT INTO ${table} BY NAME SELECT * FROM read_parquet('${path}')`);
      } finally {
        await state.db.dropFile(path);
      }
    }
    await state.connection.query('COMMIT');
  } catch (error) {
    await state.connection.query('ROLLBACK');
    throw error;
  }
}

async function createEngine(): Promise<{ db: duckdb.AsyncDuckDB; parquetURL: string; supportsOPFS: boolean }> {
  startupPhase = 'Selecting the database runtime';
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  if (!bundle.mainWorker) throw new Error('No compatible database worker is available.');
  startupPhase = 'Loading the database worker and Wasm';
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  // The pinned SDK clears pending tasks on Worker.error without rejecting them.
  // Bound instantiation BEFORE opening/registering any persistent database files.
  let timeout: ReturnType<typeof setTimeout>;
  let rejectStartup: (error: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectStartup = reject; });
  let instantiated = false;
  const health: EngineHealth = { interrupted };
  engineHealth.set(db, health);
  void interrupted.catch(() => undefined);
  const failed = () => {
    health.failure ??= instantiated ? new DatabaseRuntimeError() : new DatabaseStartupError('The database worker could not load. Check your connection and reload. Your saved coffee data has been kept.');
    rejectStartup(health.failure);
    if (instantiated) window.dispatchEvent(new CustomEvent('coffeeos-database-failed', { detail: health.failure.message }));
  };
  const progress = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => rejectStartup(new DatabaseStartupError('Loading the database runtime stopped responding. Check your connection and reload. Your saved coffee data has been kept.')), 120_000);
  };
  worker.addEventListener('error', failed);
  worker.addEventListener('messageerror', failed);
  progress();
  try {
    await Promise.race([db.instantiate(bundle.mainModule, undefined, progress), interrupted]);
    instantiated = true;
    const supportsOPFS = bundle.mainModule === ehWasm;
    return { db, parquetURL: supportsOPFS ? ehParquet : mvpParquet, supportsOPFS };
  } catch (error) {
    await db.terminate();
    throw error;
  } finally {
    clearTimeout(timeout!);
    if (!instantiated) {
      worker.removeEventListener('error', failed);
      worker.removeEventListener('messageerror', failed);
    }
  }
}

async function initialize(): Promise<void> {
  try {
    // Firefox may leave this pending while permission awaits a user decision.
    // Durability is best effort; opening the database must not wait for that prompt.
    void navigator.storage?.persist?.().catch((error: unknown) => {
      console.warn('Persistent storage permission was unavailable.', error);
    });
  } catch (error) {
    console.warn('Persistent storage permission was unavailable.', error);
  }

  let snapshots: IDBDatabase | null = null;
  startupPhase = 'Opening saved storage metadata';
  try { snapshots = await openSnapshots(); }
  catch (error) { throw new DatabaseStartupError('Saved storage metadata could not be read. Restore browser storage access and reload; no replacement database was opened.', { cause: error }); }
  let snapshot: Snapshot | undefined;
  let preferred: StorageMode | undefined;
  try {
    if (snapshots) {
      startupPhase = 'Reading the saved backend and snapshot';
      snapshot = await readRecord<Snapshot>(snapshots, snapshotKey);
      preferred = await readRecord<StorageMode>(snapshots, 'backend-v1');
      if (preferred !== undefined && preferred !== 'opfs' && preferred !== 'indexeddb') {
        throw new DatabaseStartupError('This storage backend is unsupported. Open CoffeeOS with a compatible version; saved data has been kept.');
      }
      if (preferred === 'indexeddb' && snapshot === undefined) {
        throw new DatabaseStartupError('Your saved snapshot is missing. Restore browser storage access or recover a backup; no empty replacement was created.');
      }
      if (snapshot !== undefined && (!snapshot || !(snapshot.beans instanceof Uint8Array) || !(snapshot.brew_sessions instanceof Uint8Array))) {
        throw new DatabaseStartupError('The saved snapshot format is unsupported or damaged. Saved data has been kept; use a compatible version or recover a backup.');
      }
      // Preserve fallback data from older versions, before backend tracking existed.
      if (!preferred && snapshot) preferred = 'indexeddb';
    }
    await initializeEngine(snapshots, snapshot, preferred);
  } catch (error) {
    snapshots?.close();
    throw error;
  }
}

async function initializeEngine(snapshots: IDBDatabase | null, snapshot: Snapshot | undefined, preferred: StorageMode | undefined): Promise<void> {
  startupPhase = 'Checking access to the saved database';
  // Inspect legacy storage before creating an engine or files. Failure to inspect
  // is not evidence of first use, even when backend metadata predates tracking.
  let existingOPFS = false;
  if (preferred !== 'indexeddb') {
    if (typeof navigator.storage?.getDirectory !== 'function') {
      throw new DatabaseStartupError('Cannot inspect saved OPFS storage. Restore browser storage access and reload.');
    }
    try {
      const root = await navigator.storage.getDirectory();
      for (const name of ['coffeos.db', 'coffeos.db.wal']) {
        try { await root.getFileHandle(name); existingOPFS = true; }
        catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
      }
      if (preferred === 'opfs') await root.getFileHandle('coffeos.db');
    } catch (error) {
      throw new DatabaseStartupError('Saved OPFS storage could not be inspected. Restore access and reload; your data has been kept.', { cause: error });
    }
  }
  let { db, parquetURL, supportsOPFS } = await createEngine();
  let storage: StorageMode = 'memory';
  // The pinned MVP runtime throws _setThrew on reopening OPFS databases. Use the
  // portable snapshot backend there rather than switching datasets after reload.
  if (preferred !== 'indexeddb' && supportsOPFS && window.crossOriginIsolated && typeof navigator.storage?.getDirectory === 'function') {
    startupPhase = 'Opening the saved OPFS database';
    let existingFile = existingOPFS;
    try {
      const root = await navigator.storage.getDirectory();
      // Bind the URI's OPFS file to a plain DuckDB filename. This version skips
      // empty handles during automatic registration and normalizes opfs:// to
      // opfs:/ internally; a plain registered filename avoids both issues.
      for (const name of ['coffeos.db', 'coffeos.db.wal']) {
        const handle = await root.getFileHandle(name, { create: true });
        if (name === 'coffeos.db') existingFile ||= (await handle.getFile()).size > 0;
        await db.registerFileHandle(name, handle, duckdb.DuckDBDataProtocol.BROWSER_FSACCESS, true);
      }
      await db.open({ path: databasePath.slice('opfs://'.length), accessMode: duckdb.DuckDBAccessMode.READ_WRITE, useDirectIO: true });
      storage = 'opfs';
    } catch (error) {
      console.warn('OPFS could not be opened.', error);
      // A failed registration/open can retain handles. Discard that worker entirely.
      await db.terminate();
      if (existingFile || preferred === 'opfs') {
        throw new DatabaseStartupError('Your saved coffee database could not be opened. Close other CoffeeOS tabs and reload; your saved data has been kept.');
      }
      ({ db, parquetURL } = await createEngine());
    }
  }

  let connection: duckdb.AsyncDuckDBConnection | null = null;
  try {
    if ((preferred === 'opfs' || existingOPFS) && storage !== 'opfs') {
      throw new DatabaseStartupError('Your saved coffee database needs OPFS and cross-origin isolation. Restore browser storage access and reload.');
    }
    if (storage !== 'opfs') await db.open({ path: ':memory:' });
    startupPhase = 'Checking the saved database schema';
    connection = await db.connect();
    if (storage === 'opfs' && existingOPFS) {
      for (const table of tables) await validateStoredSchema(connection, table, table);
    }
    await connection.query(`
      SET autoinstall_known_extensions = false;
      SET autoload_known_extensions = false;
      CREATE TABLE IF NOT EXISTS beans ${beanDefinition};
      CREATE TABLE IF NOT EXISTS brew_sessions ${brewSessionDefinition};
    `);

    if (storage !== 'opfs' && snapshots) storage = 'indexeddb';
    const state = { db, connection, snapshots: storage === 'indexeddb' ? snapshots : null, storage };
    // IO also needs Parquet in OPFS and memory-only modes.
    const url = new URL(parquetURL, window.location.href).href.replaceAll("'", "''");
    startupPhase = 'Loading local Parquet support';
    await connection.query(`LOAD '${url}'`);
    if (storage === 'indexeddb' && snapshot) {
      startupPhase = 'Restoring the saved IndexedDB snapshot';
      // A damaged snapshot is an initialization error, never silently replaced by empty tables.
      await restoreSnapshot(state, snapshot);
    }
    // Schema v2: retain an immutable v1 recovery snapshot before the additive migration.
    // For IndexedDB the original Parquet record is retained before any future write.
    const columns = await queryRows<{ name: string }>(connection, 'PRAGMA table_info(beans)');
    startupPhase = 'Checking database compatibility';
    const recoveryKey = 'schema-v1-before-photos';
    if (snapshots && await readRecord(snapshots, recoveryKey) === undefined) {
      if (storage === 'indexeddb' && snapshot) await storeRecord(snapshots, recoveryKey, snapshot);
      else if (!columns.some(column => column.name === 'photo_jpeg')) {
        await snapshotTables({ ...state, snapshots }, recoveryKey);
      }
    }
    if (!columns.some(column => column.name === 'photo_jpeg')) {
      await connection.query('BEGIN TRANSACTION');
      try {
        await connection.query('ALTER TABLE beans ADD COLUMN photo_jpeg VARCHAR');
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      }
    }
    // Establish even an empty first-use snapshot before remembering this backend.
    startupPhase = 'Confirming saved database durability';
    if (storage === 'indexeddb' && snapshot === undefined) await snapshotTables(state);
    await connection.query('CHECKPOINT');
    await db.flushFiles();
    if (snapshots) await storeRecord(snapshots, 'backend-v1', storage);
    if (storage === 'opfs') snapshots?.close();
    database = state;
    startupPhase = 'Database ready';
    console.info(`coffeos database ready (${storage}).`);
  } catch (error) {
    snapshots?.close();
    try {
      await connection?.close();
    } finally {
      await db.terminate();
    }
    throw error;
  }
}

export function initDB(): Promise<void> {
  if (!initialization) {
    initialization = enqueue(async () => {
      startupPhase = 'Acquiring database ownership';
      await acquireOwnership();
      try { await initialize(); }
      catch (error) { releaseOwnership?.(); releaseOwnership = null; throw error; }
    }).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

async function withDatabase<T>(operation: (state: Database) => Promise<T>): Promise<T> {
  await initDB();
  return enqueue(async () => {
    if (!database) throw new Error('The database has been closed.');
    const health = engineHealth.get(database.db);
    if (health?.failure) throw health.failure;
    return health ? Promise.race([operation(database), health.interrupted]) : operation(database);
  });
}

const recordVersions = new WeakMap<object, string>();

function hasChanged(existing: object, original: object): boolean {
  const version = recordVersions.get(original);
  return version !== undefined ? recordVersions.get(existing) !== version
    : Object.keys(existing).some(key => key !== 'bean_name' && (existing as Record<string, unknown>)[key] !== ((original as Record<string, unknown>)[key] ?? null));
}

async function queryRows<T>(connection: duckdb.AsyncDuckDBConnection, sql: string, params: SQLValue[] = []): Promise<T[]> {
  const statement = await connection.prepare(sql);
  try {
    const result = await statement.query(...params);
    // The explicit SELECT projections define this boundary between Arrow and domain types.
    return result.toArray().map((row) => {
      const value = row.toJSON();
      if (typeof value._record_version === 'string') { recordVersions.set(value, value._record_version); delete value._record_version; }
      return value as T;
    });
  } finally {
    await statement.close();
  }
}

const beanDefinition = `(
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL CHECK (length(trim(name)) > 0),
  roast_date DATE,
  freeze_date DATE,
  created_at TIMESTAMP NOT NULL,
  photo_jpeg VARCHAR
)`;

const brewSessionDefinition = `(
  id VARCHAR PRIMARY KEY,
  bean_id VARCHAR NOT NULL REFERENCES beans(id),
  brewed_at TIMESTAMP NOT NULL,
  dose_g DOUBLE,
  water_g DOUBLE,
  time_str VARCHAR,
  temp_c DOUBLE,
  grind_um DOUBLE,
  comment VARCHAR,
  yield_g DOUBLE,
  tds_pct DOUBLE,
  extraction_pct DOUBLE
)`;

export class EditConflictError extends Error {
  constructor() { super('This record changed or was deleted while you were editing. Your draft is kept. Cancel and reopen the record to review its current values before saving.'); }
}

export class CommittedWriteError extends Error {
  constructor(cause: unknown) {
    super('The change is already in your collection, but storage could not be confirmed. Do not submit it again. Export a backup from IO before closing this tab.', { cause });
  }
}

async function flushCommitted(state: Database): Promise<void> {
  collectionRevision++;
  try {
    await state.connection.query('CHECKPOINT');
    await state.db.flushFiles();
  } catch (error) {
    throw new CommittedWriteError(error);
  }
}

async function write<T>(state: Database, sql: string, params: SQLValue[]): Promise<T> {
  await state.connection.query('BEGIN TRANSACTION');
  let rows: T[];
  try {
    rows = await queryRows<T>(state.connection, sql, params);
    await commitTransaction(state);
  } catch (error) {
    if (error instanceof CommittedWriteError) { collectionRevision++; throw error; }
    if (error instanceof DatabaseRuntimeError) throw error;
    await state.connection.query('ROLLBACK');
    throw error;
  }
  await flushCommitted(state);
  return rows[0];
}

export function getBeans(): Promise<Bean[]> {
  return withDatabase(({ connection }) => queryRows<Bean>(connection,
    `SELECT ${beanColumns} FROM beans ORDER BY created_at DESC, id DESC`));
}

type BeanInput = { name: string; roast_date?: string | null; freeze_date?: string | null; photo_jpeg?: string | null };

function validateBean(input: BeanInput): void {
  if (input.photo_jpeg != null && !isValidBeanPhoto(input.photo_jpeg)) throw new Error('Invalid JPEG photo.');
  for (const date of [input.roast_date, input.freeze_date]) {
    if (date != null && (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date))) {
      throw new Error('Dates must use years from 0001 to 9999.');
    }
  }
}

export async function addBean(input: BeanInput): Promise<Bean> {
  validateBean(input);
  return withDatabase((state) => write<Bean>(state,
    `INSERT INTO beans (id, name, roast_date, freeze_date, created_at, photo_jpeg) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${beanColumns}`,
    [crypto.randomUUID(), input.name.trim(), input.roast_date ?? null, input.freeze_date ?? null, new Date().toISOString(), input.photo_jpeg ?? null]));
}

/** Edit only bean details; preserve identity, creation timestamp and linked sessions. */
export async function updateBean(id: string, input: Pick<Bean, 'name' | 'roast_date' | 'freeze_date' | 'photo_jpeg'>, original?: Bean): Promise<Bean> {
  if (!input.name.trim()) throw new Error('Enter a bean name.');
  return withDatabase(async state => {
    const [existing] = await queryRows<Bean>(state.connection, `SELECT ${beanColumns} FROM beans WHERE id = ?`, [id]);
    if (original && (!existing || hasChanged(existing, original))) throw new EditConflictError();
    if (!existing) throw new Error('This bean no longer exists.');
    // Preserve an unchanged historical photo byte for byte; replacements must be valid.
    validateBean({ ...input, photo_jpeg: input.photo_jpeg === existing.photo_jpeg ? null : input.photo_jpeg });
    // In this DuckDB build, UPDATE ... RETURNING id rewrites the parent row
    // and rejects beans referenced by sessions. Update non-key fields only,
    // then read the result while still holding the serialized database queue.
    await write(state,
      `UPDATE beans SET name = ?, roast_date = ?, freeze_date = ?,
        photo_jpeg = CASE WHEN ? = 1 THEN ? ELSE photo_jpeg END
        WHERE id = ?`,
      [input.name, input.roast_date, input.freeze_date, input.photo_jpeg !== undefined ? 1 : 0, input.photo_jpeg ?? null, id]);
    const [bean] = await queryRows<Bean>(state.connection, `SELECT ${beanColumns} FROM beans WHERE id = ?`, [id]);
    return bean;
  });
}

export function getBrewSessions(beanId?: string, page?: { offset: number; limit: number }): Promise<BrewSession[]> {
  return withDatabase(({ connection }) => queryRows<BrewSession>(connection,
    `SELECT ${sessionColumns} FROM brew_sessions s JOIN beans b ON b.id = s.bean_id
      ${beanId === undefined ? '' : 'WHERE s.bean_id = ?'} ORDER BY s.brewed_at DESC, s.id DESC${page ? ` LIMIT ${Math.max(1, Math.min(100, Math.trunc(page.limit)))} OFFSET ${Math.max(0, Math.trunc(page.offset))}` : ''}`,
    beanId === undefined ? [] : [beanId]));
}

/** Counts avoid loading the journal for collapsed bean rows. */
export function getBeanSessionCounts(): Promise<{ bean_id: string; count: number }[]> {
  return withDatabase(({ connection }) => queryRows(connection,
    'SELECT bean_id, count(*)::INTEGER AS count FROM brew_sessions GROUP BY bean_id'));
}

/** Delete only after an explicit user action; snapshot both tables together. */
export function deleteBean(beanId: string): Promise<void> {
  return withDatabase(async (state) => {
    await state.connection.query('BEGIN TRANSACTION');
    try {
      // DuckDB checks foreign keys eagerly: deleting children then their parent
      // in one transaction still sees the old FK index. Build the retained child
      // table with the identical constraints, then swap it within this transaction.
      // Readers are serialized; any failure restores the original tables.
      await state.connection.query(`CREATE TABLE bean_delete_sessions ${brewSessionDefinition}`);
      await queryRows(state.connection,
        'INSERT INTO bean_delete_sessions SELECT * FROM brew_sessions WHERE bean_id <> ?', [beanId]);
      await state.connection.query('DROP TABLE brew_sessions');
      await queryRows(state.connection, 'DELETE FROM beans WHERE id = ?', [beanId]);
      await state.connection.query('ALTER TABLE bean_delete_sessions RENAME TO brew_sessions');
      await commitTransaction(state);
    } catch (error) {
      if (error instanceof CommittedWriteError) { collectionRevision++; throw error; }
      if (error instanceof DatabaseRuntimeError) throw error;
      await state.connection.query('ROLLBACK');
      throw error;
    }
    await flushCommitted(state);
  });
}

/** Remove only the explicitly selected session through the normal durable write path. */
export function deleteBrewSession(id: string): Promise<void> {
  return withDatabase(async (state) => {
    await write(state, 'DELETE FROM brew_sessions WHERE id = ? RETURNING id', [id]);
  });
}

export function addBrewSession(input: Omit<BrewSession, 'id' | 'brewed_at' | 'bean_name'>): Promise<BrewSession> {
  for (const value of [input.dose_g, input.water_g, input.temp_c, input.grind_um,
    input.yield_g, input.tds_pct, input.extraction_pct]) {
    if (value !== null && !Number.isFinite(value)) return Promise.reject(new Error('Measurements must be finite numbers.'));
  }
  return withDatabase((state) => write<BrewSession>(state,
    `INSERT INTO brew_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, bean_id, strftime(brewed_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS brewed_at,
        dose_g, water_g, time_str, temp_c, grind_um, comment, yield_g, tds_pct, extraction_pct`,
    [crypto.randomUUID(), input.bean_id, new Date().toISOString(), input.dose_g, input.water_g,
      input.time_str, input.temp_c, input.grind_um, input.comment, input.yield_g, input.tds_pct, input.extraction_pct]));
}

/** Update in place so IDs and bean history links survive editing. */
export function updateBrewSession(id: string, input: Omit<BrewSession, 'id' | 'bean_name' | 'brewed_at'> & { brewed_at?: string }, original?: BrewSession): Promise<BrewSession> {
  for (const value of [input.dose_g, input.water_g, input.temp_c, input.grind_um,
    input.yield_g, input.tds_pct, input.extraction_pct]) {
    if (value !== null && !Number.isFinite(value)) return Promise.reject(new Error('Measurements must be finite numbers.'));
  }
  return withDatabase(async (state) => {
    const [existing] = await queryRows<BrewSession>(state.connection, `SELECT ${sessionColumns} FROM brew_sessions s JOIN beans b ON b.id = s.bean_id WHERE s.id = ?`, [id]);
    if (original && (!existing || hasChanged(existing, original))) throw new EditConflictError();
    if (!existing) throw new Error('This brew session no longer exists.');
    return write<BrewSession>(state,
      `UPDATE brew_sessions SET bean_id = ?, brewed_at = COALESCE(?::TIMESTAMP, brewed_at), dose_g = ?, water_g = ?,
        time_str = ?, temp_c = ?, grind_um = ?, comment = ?, yield_g = ?, tds_pct = ?, extraction_pct = ?
        WHERE id = ? RETURNING id, bean_id, strftime(brewed_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS brewed_at,
        dose_g, water_g, time_str, temp_c, grind_um, comment, yield_g, tds_pct, extraction_pct`,
      [input.bean_id, input.brewed_at ?? null, input.dose_g, input.water_g, input.time_str,
        input.temp_c, input.grind_um, input.comment, input.yield_g, input.tds_pct, input.extraction_pct, id]);
  });
}

/** Explicit teardown for development HMR and callers that no longer need the database. */
export function closeDB(): Promise<void> {
  return enqueue(async () => {
    const state = database;
    database = null;
    initialization = null;
    if (!state) return;
    try {
      if (!engineHealth.get(state.db)?.failure) await state.connection.close();
    } finally {
      state.snapshots?.close();
      try { await state.db.terminate(); }
      finally { releaseOwnership?.(); releaseOwnership = null; }
    }
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => closeDB().catch((error: unknown) => console.error('Database cleanup failed.', error)));
}

export type DataFormat = 'parquet' | 'csv';
export type DataTarget = typeof tables[number] | 'combined';
export interface ExportFile { name: string; data: Uint8Array<ArrayBuffer>; type: string }
export interface ImportFile { target: DataTarget; name: string; data: Uint8Array }
export interface ImportResult { beans: number; brew_sessions: number }
export class ImportDataError extends Error {}

// One schema drives explicit projections and casts; uploaded column order is irrelevant.
const ioSchema = {
  beans: { id: 'VARCHAR', name: 'VARCHAR', roast_date: 'DATE', freeze_date: 'DATE', created_at: 'TIMESTAMP', photo_jpeg: 'VARCHAR' },
  brew_sessions: { id: 'VARCHAR', bean_id: 'VARCHAR', brewed_at: 'TIMESTAMP', dose_g: 'DOUBLE',
    water_g: 'DOUBLE', time_str: 'VARCHAR', temp_c: 'DOUBLE', grind_um: 'DOUBLE', comment: 'VARCHAR',
    yield_g: 'DOUBLE', tds_pct: 'DOUBLE', extraction_pct: 'DOUBLE' },
} as const;
const combinedBeanNames = ['bean_id', 'bean_name', 'bean_roast_date', 'bean_freeze_date', 'bean_created_at', 'bean_photo_jpeg'];
const combinedSessionNames = Object.keys(ioSchema.brew_sessions).filter(key => key !== 'bean_id')
  .map(key => key === 'id' ? 'session_id' : key);
const combinedQuery = `SELECT b.id AS bean_id, b.name AS bean_name,
  b.roast_date AS bean_roast_date, b.freeze_date AS bean_freeze_date, b.created_at AS bean_created_at, b.photo_jpeg AS bean_photo_jpeg,
  s.id AS session_id, ${combinedSessionNames.slice(1).map(key => `s.${key}`).join(', ')}
  FROM beans b LEFT JOIN brew_sessions s ON s.bean_id = b.id
  ORDER BY b.created_at DESC, b.id, s.brewed_at DESC, s.id`;

/** Export a consistent pair of tables, or one joined file including beans with no sessions. */
export function exportData(format: DataFormat, combined = false): Promise<ExportFile[]> {
  return withDatabase(async (state) => {
    if (format !== 'csv' && format !== 'parquet') throw new Error('Choose CSV or Parquet.');
    const files: ExportFile[] = [];
    const targets = combined ? ['combined'] as const : tables;
    for (const target of targets) {
      const path = `export-${crypto.randomUUID()}.${format}`;
      try {
        // Quoting all values distinguishes empty strings and literal \\N from NULL.
        const options = format === 'parquet' ? 'FORMAT PARQUET' : "FORMAT CSV, HEADER, NULL '\\N', FORCE_QUOTE *";
        const source = target === 'combined' ? `(${combinedQuery})` : target;
        await state.connection.query(`COPY ${source} TO '${path}' (${options})`);
        files.push({ name: `${target === 'combined' ? 'coffeeos' : target}.${format}`,
          data: new Uint8Array(await state.db.copyFileToBuffer(path)),
          type: format === 'csv' ? 'text/csv' : 'application/vnd.apache.parquet' });
      } finally {
        await state.db.dropFile(path);
      }
    }
    return files;
  });
}

export interface TableCounts { beans: number; brew_sessions: number }
export interface BackupSnapshot { data: Snapshot; counts: TableCounts; exported_at: string; legacyPhotos?: boolean; legacyText?: boolean }
export interface MergeCounts { new: number; updated: number; unchanged: number; localOnly: number }
export interface ImportPreview { legacyPhotos?: boolean; legacyText?: boolean; revision: number; beans: MergeCounts; brew_sessions: MergeCounts }
export interface RecoveryInfo { key: string; created_at: string }
interface RecoveryRecord extends BackupSnapshot { version: 1 }
const recoveryPrefix = 'import-recovery-v1:';
const recoveryInfoPrefix = 'import-recovery-info-v1:';

// Use the same required-text rule for default imports and archive validation.
function blankRequiredText(table: typeof tables[number]): string {
  return (table === 'beans' ? ['id', 'name'] : ['id', 'bean_id'])
    .map(key => `regexp_full_match("${key}", '[\\s\\p{Z}]*')`).join(' OR ');
}

async function captureBackup(state: Database): Promise<BackupSnapshot> {
  const [counts] = await queryRows<TableCounts>(state.connection, `SELECT
    (SELECT count(*)::INTEGER FROM beans) AS beans,
    (SELECT count(*)::INTEGER FROM brew_sessions) AS brew_sessions`);
  const photos = await queryRows<{ photo_jpeg: string }>(state.connection, 'SELECT photo_jpeg FROM beans WHERE photo_jpeg IS NOT NULL');
  const legacyPhotos = photos.some(row => !isValidBeanPhoto(row.photo_jpeg));
  const [text] = await queryRows<{ legacy: boolean }>(state.connection, `SELECT
    EXISTS (SELECT 1 FROM beans WHERE ${blankRequiredText('beans')}) OR
    EXISTS (SELECT 1 FROM brew_sessions WHERE ${blankRequiredText('brew_sessions')}) AS legacy`);
  return { data: await captureTables(state), counts: counts!, exported_at: new Date().toISOString(),
    ...(legacyPhotos ? { legacyPhotos: true } : {}), ...(text?.legacy ? { legacyText: true } : {}) };
}

/** The queue covers both COPYs and counts; hashing/ZIP runs after releasing it. */
export function exportBackupSnapshot(): Promise<BackupSnapshot> { return withDatabase(captureBackup); }

/** Read counts, bytes and revision together; failed reads never establish emptiness. */
export function captureDriveSnapshot(): Promise<{ snapshot: BackupSnapshot; revision: number }> {
  return withDatabase(async state => ({ snapshot: await captureBackup(state), revision: collectionRevision }));
}

/** Version 1 logical fingerprint: independent of Parquet layout and archive metadata.
 * Read the captured bytes, never a later live revision. No storage writes occur.
 * Fixed 256-row blocks bound encoding allocations; changing this algorithm needs v2.
 */
export function hashBackupContents(data: BackupSnapshot['data']): Promise<string> {
  return withDatabase(async state => {
    const encoder = new TextEncoder();
    const digest = (value: unknown) => sha256(encoder.encode(JSON.stringify(value)));
    const float = new DataView(new ArrayBuffer(8));
    const binary64 = (value: number) => {
      float.setFloat64(0, value, false);
      return [...new Uint8Array(float.buffer)].map(v => v.toString(16).padStart(2, '0')).join('');
    };
    const result = [];
    for (const table of tables) {
      // DuckDB caches Parquet metadata by path; each buffer needs a fresh virtual
      // filename even after dropFile. These are not persistent storage identities.
      const path = `fingerprint-${crypto.randomUUID()}-${table}.parquet`;
      try {
        await state.db.registerFileBuffer(path, new Uint8Array(data[table]));
        const columns = Object.entries(ioSchema[table]);
        // Keep timestamps in DuckDB until converted to full microsecond strings.
        // DOUBLEs cross Arrow unchanged and are encoded as IEEE-754 bits, not JSON numbers.
        const projection = columns.map(([name, type]) => type === 'TIMESTAMP'
          ? `strftime(${name}, '%Y-%m-%dT%H:%M:%S.%f') AS ${name}`
          : type === 'DATE' ? `CAST(${name} AS VARCHAR) AS ${name}` : name).join(', ');
        const rows = await state.connection.query(`SELECT ${projection} FROM read_parquet('${path}') ORDER BY id`);
        const blocks = [];
        for (let offset = 0; offset < rows.numRows; offset += 256) {
          const block = [];
          for (let i = offset; i < Math.min(offset + 256, rows.numRows); i++) {
            const row = rows.get(i)!;
            block.push(columns.map(([name, type]) => row[name] === null ? null
              : type === 'DOUBLE' ? binary64(row[name]) : row[name]));
          }
          blocks.push(await digest(block));
        }
        result.push([table, columns, rows.numRows, blocks]);
      } finally { await state.db.dropFile(path); }
    }
    return digest(['coffeeos-content-v1', result]);
  });
}

async function retainImportRecovery(state: Database): Promise<void> {
  const snapshot = await captureBackup(state);
  // Recovery must itself be downloadable by this version, before any live mutation.
  if (snapshot.data.beans.length + snapshot.data.brew_sessions.length > backupLimits.expanded - backupLimits.manifest - 1024) {
    throw new ImportDataError('The recovery backup is too large. Keep a separate backup and reduce photo sizes before merging changed records.');
  }
  const store = await openSnapshots();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = store.transaction('snapshots', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Could not retain the recovery backup.'));
      tx.onerror = () => {};
      // add (never put) makes recovery copies immutable, even on a UUID collision.
      const id = crypto.randomUUID();
      tx.objectStore('snapshots').add({ ...snapshot, version: 1 } satisfies RecoveryRecord, recoveryPrefix + id);
      tx.objectStore('snapshots').add({ created_at: snapshot.exported_at }, recoveryInfoPrefix + id);
    });
  } finally { store.close(); }
}

export function listImportRecoveries(): Promise<RecoveryInfo[]> {
  return withDatabase(async () => {
    const store = await openSnapshots();
    try {
      const keys = await new Promise<string[]>((resolve, reject) => {
        const results: string[] = [];
        const tx = store.transaction('snapshots', 'readonly');
        const request = tx.objectStore('snapshots').openKeyCursor(IDBKeyRange.bound(recoveryPrefix, recoveryPrefix + '\uffff'));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) { results.push(String(cursor.key)); cursor.continue(); }
        };
        tx.oncomplete = () => resolve(results);
        tx.onabort = () => reject(tx.error);
      });
      const results: RecoveryInfo[] = [];
      for (const key of keys) {
        const infoKey = recoveryInfoPrefix + key.slice(recoveryPrefix.length);
        let info = await readRecord<{ created_at: string }>(store, infoKey);
        if (!info) {
          // One-time additive index for old copies; original keys/bytes stay intact.
          const value = await readRecord<RecoveryRecord>(store, key);
          if (value?.version !== 1) continue;
          info = { created_at: value.exported_at };
          await storeRecord(store, infoKey, info);
        }
        results.push({ key, created_at: info.created_at });
      }
      return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } finally { store.close(); }
  });
}

export function readImportRecovery(key: string): Promise<BackupSnapshot> {
  return withDatabase(async () => {
    if (!key.startsWith(recoveryPrefix)) throw new ImportDataError('Unknown recovery backup.');
    const store = await openSnapshots();
    try {
      const record = await readRecord<RecoveryRecord>(store, key);
      if (!record || record.version !== 1) throw new ImportDataError('Recovery backup unavailable. Keep this tab open and try again.');
      return record;
    } finally { store.close(); }
  });
}

function archiveDifference(table: typeof tables[number], left: string, right: string): string {
  return Object.keys(ioSchema[table]).filter(key => key !== 'id')
    .map(key => `${left}."${key}" IS DISTINCT FROM ${right}."${key}"`).join(' OR ');
}

/** Keep the IDB snapshot transaction open until SQL commit resolves. This avoids
 * publishing a candidate snapshot if SQL COMMIT fails. An IDB abort after SQL
 * committed is a committed durability warning, preserving the prior snapshot. */
async function commitTransaction(state: Database): Promise<void> {
  const checkWorker = () => { const failure = engineHealth.get(state.db)?.failure; if (failure) throw failure; };
  checkWorker();
  if (!state.snapshots) { await state.connection.query('COMMIT'); return; }
  const buffers = await captureTables(state);
  checkWorker();
  await new Promise<void>((resolve, reject) => {
    const tx = state.snapshots!.transaction('snapshots', 'readwrite');
    const store = tx.objectStore('snapshots');
    let committed = false;
    let commitFailure: unknown;
    let committing: Promise<void> | undefined;
    tx.oncomplete = () => resolve();
    tx.onerror = () => {};
    tx.onabort = () => {
      const runtimeFailure = engineHealth.get(state.db)?.failure;
      if (runtimeFailure) { reject(runtimeFailure); return; }
      void (async () => {
        await committing;
        reject(committed ? new CommittedWriteError(tx.error) : commitFailure ?? tx.error ?? new Error('The backup snapshot could not be saved.'));
      })();
    };
    const keepAlive = () => {
      if (committed || commitFailure) return;
      // A dead SDK can leave COMMIT pending forever. Release the IDB transaction
      // without publishing its candidate, so explicit reopen can read saved data.
      try { checkWorker(); } catch (error) { commitFailure = error; tx.abort(); return; }
      // getKey avoids repeatedly cloning either large Parquet snapshot.
      const request = store.getKey(snapshotKey);
      request.onsuccess = keepAlive;
    };
    const request = store.put(buffers, snapshotKey);
    request.onsuccess = () => {
      try { checkWorker(); } catch (error) { commitFailure = error; tx.abort(); return; }
      keepAlive();
      committing = state.connection.query('COMMIT').then(() => { committed = true; }).catch(error => {
        commitFailure = error;
        try { tx.abort(); } catch { /* Already aborted; onabort awaits this promise. */ }
      });
    };
  });
}

export function previewBackupData(files: ImportFile[], counts: TableCounts, legacyPhotos = false, legacyText = false): Promise<ImportPreview> {
  return processImport(files, { counts, legacyText, legacyPhotos }) as Promise<ImportPreview>;
}
export function mergeBackupData(files: ImportFile[], counts: TableCounts, preview: ImportPreview, legacyPhotos = false, legacyText = false): Promise<ImportResult | ImportPreview> {
  return processImport(files, { counts, preview, legacyText, legacyPhotos });
}

export function replaceBackupData(files: ImportFile[], counts: TableCounts, preview: ImportPreview, legacyPhotos = false, legacyText = false): Promise<ImportResult | ImportPreview> {
  return processImport(files, { counts, preview, replace: true, legacyText, legacyPhotos });
}

/** Cloud recovery can only add to the unchanged, successfully read empty collection. */
export function recoverEmptyBackup(files: ImportFile[], counts: TableCounts, revision: number, signal: AbortSignal, onCommit?: () => void, legacyPhotos = false, legacyText = false): Promise<ImportResult> {
  return processImport(files, { counts, legacyText, legacyPhotos, empty: { revision, signal, onCommit } }) as Promise<ImportResult>;
}

/** Temporary Drive diagnostic: exercise restore staging and exact comparisons,
 * then ROLLBACK. Never update records, snapshots, revision or recovery copies. */
export function verifyDriveRoundTrip(files: ImportFile[], counts: TableCounts, revision: number, signal: AbortSignal, legacyPhotos = false, legacyText = false): Promise<ImportResult> {
  return processImport(files, { counts, legacyText, legacyPhotos, verify: { revision, signal } }) as Promise<ImportResult>;
}

/** Merge by primary key. All selected files and their durable snapshot succeed together. */
export function importData(files: ImportFile[], options: { preserveLegacyPhotos?: boolean; preserveLegacyText?: boolean } = {}): Promise<ImportResult> {
  return processImport(files, undefined, options.preserveLegacyPhotos, options.preserveLegacyText) as Promise<ImportResult>;
}
function processImport(files: ImportFile[], archive?: { legacyText?: boolean; legacyPhotos?: boolean; counts: TableCounts; preview?: ImportPreview; replace?: boolean; empty?: { revision: number; signal: AbortSignal; onCommit?: () => void }; verify?: { revision: number; signal: AbortSignal } }, preserveLegacyPhotos = false, preserveLegacyText = false): Promise<ImportResult | ImportPreview> {
  return withDatabase(async (state) => {
    if (archive?.empty) {
      archive.empty.signal.throwIfAborted();
      const [local] = await queryRows<TableCounts>(state.connection, `SELECT
        (SELECT count(*)::INTEGER FROM beans) AS beans,
        (SELECT count(*)::INTEGER FROM brew_sessions) AS brew_sessions`);
      if (collectionRevision !== archive.empty.revision || !local || local.beans !== 0 || local.brew_sessions !== 0) {
        throw new ImportDataError('Your collection changed during Drive recovery. Nothing was imported. Save a local backup and try again with an empty collection.');
      }
    }
    if (!files.length) throw new ImportDataError('Choose at least one file.');
    const targets = files.map(file => file.target);
    if (new Set(targets).size !== targets.length ||
      (targets.includes('combined') && files.length !== 1) ||
      targets.some(target => !['beans', 'brew_sessions', 'combined'].includes(target))) {
      throw new ImportDataError('Choose either a combined file or one file per table.');
    }
    const { connection, db } = state;
    const paths: string[] = [];
    await connection.query('BEGIN TRANSACTION');
    let counts: ImportResult;
    let importedPhotos = false;
    try {
      for (const table of tables) {
        await connection.query(`CREATE TEMP TABLE incoming_${table} AS SELECT * FROM ${table} WHERE false`);
      }
      for (const file of files) {
        const format = file.name.split('.').pop()?.toLowerCase();
        if (format !== 'csv' && format !== 'parquet') throw new ImportDataError('Files must end in .csv or .parquet.');
        const path = `import-${crypto.randomUUID()}.${format}`;
        paths.push(path);
        // registerFileBuffer transfers ownership to the worker; preserve the caller's bytes for retries.
        await db.registerFileBuffer(path, new Uint8Array(file.data));
        const reader = format === 'parquet' ? `read_parquet('${path}')`
          : `read_csv_auto('${path}', header = true, all_varchar = true, sample_size = -1,
              nullstr = '\\N', allow_quoted_nulls = false)`;
        await connection.query(`CREATE TEMP TABLE incoming_file AS SELECT * FROM ${reader}`);
        const columns = await queryRows<{ name: string }>(connection, 'PRAGMA table_info(incoming_file)');
        if (archive) {
          if (file.target === 'combined' || format !== 'parquet') throw new ImportDataError('A backup needs two Parquet tables.');
          const schema = await queryRows<{ column_name: string; column_type: string }>(connection, 'DESCRIBE incoming_file');
          if (JSON.stringify(schema.map(c => [c.column_name, c.column_type])) !== JSON.stringify(Object.entries(ioSchema[file.target]))) {
            throw new ImportDataError(`The ${file.target} Parquet schema does not match backup version 1.`);
          }
        }
        const expected = file.target === 'combined' ? [...combinedBeanNames, ...combinedSessionNames]
          : Object.keys(ioSchema[file.target]);
        const photoColumn = file.target === 'combined' ? 'bean_photo_jpeg' : 'photo_jpeg';
        if (file.target !== 'brew_sessions') importedPhotos = columns.some(column => column.name === photoColumn);
        const requiredColumns = expected.filter(key => key !== photoColumn);
        if (requiredColumns.some(key => !columns.some(column => column.name === key)) || columns.some(column => !expected.includes(column.name))) {
          throw new ImportDataError(`The ${file.target} file has unexpected columns. Use a CoffeeOS export with its original headers.`);
        }
        if (file.target === 'combined') {
          const [invalid] = await queryRows<{ count: number }>(connection,
            `SELECT CAST(count(*) AS INTEGER) AS count FROM incoming_file WHERE session_id IS NULL AND
              (${combinedSessionNames.slice(1).map(key => `"${key}" IS NOT NULL`).join(' OR ')})`);
          if (invalid!.count) throw new ImportDataError('Some combined rows have session values without a session ID.');
        }
        for (const table of tables) {
          if (file.target !== 'combined' && file.target !== table) continue;
          const projection = Object.entries(ioSchema[table]).map(([key, type], index) => {
            const source = file.target !== 'combined' ? key : table === 'beans'
              ? combinedBeanNames[index]! : key === 'id' ? 'session_id' : key;
            return key === 'photo_jpeg' && !columns.some(column => column.name === source)
              ? 'NULL::VARCHAR AS photo_jpeg' : `CAST("${source}" AS ${type}) AS "${key}"`;
          }).join(', ');
          const filter = file.target === 'combined' && table === 'brew_sessions' ? 'WHERE session_id IS NOT NULL' : '';
          const distinct = file.target === 'combined' && table === 'beans' ? 'DISTINCT ' : '';
          await connection.query(`INSERT INTO incoming_${table} SELECT ${distinct}${projection} FROM incoming_file ${filter}`);
        }
        await connection.query('DROP TABLE incoming_file');
      }
      // Reject ambiguous keys and malformed values before touching either live table.
      let legacyText = false;
      for (const table of tables) {
        const invalidValues = Object.entries(ioSchema[table]).filter(([, type]) => ['DATE', 'TIMESTAMP', 'DOUBLE'].includes(type))
          .map(([key, type]) => `("${key}" IS NOT NULL AND (NOT isfinite("${key}")${type === 'DOUBLE' ? ''
            : ` OR "${key}" < ${type} '0001-01-01' OR "${key}" >= ${type} '10000-01-01'`}))`);
        const required = table === 'beans' ? ['id', 'name', 'created_at'] : ['id', 'bean_id', 'brewed_at'];
        const invalid = [...required.map(key => `"${key}" IS NULL`), "length(trim(id)) = 0", ...invalidValues];
        invalid.push(table === 'beans' ? 'length(trim(name)) = 0' : 'length(trim(bean_id)) = 0');
        const [row] = await queryRows<{ invalid: number; duplicates: number; legacy: number }>(connection,
          `SELECT CAST(count(*) FILTER (WHERE ${invalid.join(' OR ')}) AS INTEGER) AS invalid,
            CAST(count(*) - count(DISTINCT id) AS INTEGER) AS duplicates,
            count(*) FILTER (WHERE ${blankRequiredText(table)})::INTEGER AS legacy FROM incoming_${table}`);
        legacyText ||= row!.legacy > 0;
        if (row!.invalid || row!.duplicates) throw new ImportDataError(`The ${table} file contains invalid values or duplicate IDs.`);
      }
      if (legacyText && !(archive?.legacyText || preserveLegacyText)) {
        throw new ImportDataError('Required names and IDs cannot contain only whitespace. For a historical CSV/Parquet backup, enable preservation of legacy whitespace fields to retain their original values.');
      }
      const photos = await queryRows<{ photo_jpeg: string }>(connection, 'SELECT photo_jpeg FROM incoming_beans WHERE photo_jpeg IS NOT NULL');
      const legacyPhotos = photos.some(row => !isValidBeanPhoto(row.photo_jpeg));
      if (photos.some(row => !isBeanPhoto(row.photo_jpeg)) || (legacyPhotos && !(archive?.legacyPhotos || preserveLegacyPhotos))) throw new ImportDataError('The beans file contains an invalid JPEG photo. For a historical CSV/Parquet backup, enable preservation of damaged legacy photos to retain the original bytes.');
      const [orphans] = await queryRows<{ count: number }>(connection,
        `SELECT CAST(count(*) AS INTEGER) AS count FROM incoming_brew_sessions s
          WHERE ${archive ? '' : 'NOT EXISTS (SELECT 1 FROM beans b WHERE b.id = s.bean_id) AND '}NOT EXISTS (SELECT 1 FROM incoming_beans b WHERE b.id = s.bean_id)`);
      if (orphans!.count) throw new ImportDataError('Some sessions refer to missing beans. Include their beans file in this import.');
      const [result] = await queryRows<ImportResult>(connection,
        `SELECT CAST((SELECT count(*) FROM incoming_beans) AS INTEGER) AS beans,
          CAST((SELECT count(*) FROM incoming_brew_sessions) AS INTEGER) AS brew_sessions`);
      counts = result!;

      if (archive) {
        if (tables.some(table => counts[table] !== archive.counts[table])) throw new ImportDataError('Backup row counts do not match its tables.');
        const preview = { revision: collectionRevision, ...(legacyText ? { legacyText: true } : {}), ...(legacyPhotos ? { legacyPhotos: true } : {}) } as ImportPreview;
        for (const table of tables) {
          const differs = archiveDifference(table, 'i', 'e');
          const [comparison] = await queryRows<MergeCounts>(connection, `SELECT
            count(*) FILTER (WHERE e.id IS NULL)::INTEGER AS new,
            count(*) FILTER (WHERE e.id IS NOT NULL AND (${differs}))::INTEGER AS updated,
            count(*) FILTER (WHERE e.id IS NOT NULL AND NOT (${differs}))::INTEGER AS unchanged
            FROM incoming_${table} i LEFT JOIN ${table} e ON e.id = i.id`);
          const [remaining] = await queryRows<{ count: number }>(connection,
            `SELECT count(*)::INTEGER AS count FROM ${table} e WHERE NOT EXISTS (SELECT 1 FROM incoming_${table} i WHERE i.id = e.id)`);
          preview[table] = { ...comparison!, localOnly: remaining!.count };
        }
        if (archive.verify) {
          archive.verify.signal.throwIfAborted();
          const [local] = await queryRows<TableCounts>(connection, `SELECT
            (SELECT count(*)::INTEGER FROM beans) AS beans,
            (SELECT count(*)::INTEGER FROM brew_sessions) AS brew_sessions`);
          if (collectionRevision !== archive.verify.revision || !local || tables.some(table =>
            local[table] !== counts[table] || preview[table].new !== 0 || preview[table].updated !== 0 || preview[table].unchanged !== counts[table])) {
            throw new ImportDataError('Round-trip comparison stopped: local records changed or differ from the downloaded backup. No local records were written.');
          }
          await connection.query('ROLLBACK');
          return counts;
        }
        if (!archive.empty && (!archive.preview || JSON.stringify(preview) !== JSON.stringify(archive.preview))) {
          await connection.query('ROLLBACK');
          return preview;
        }
        if (archive.replace || preview.beans.updated + preview.brew_sessions.updated > 0) await retainImportRecovery(state);
        if (!archive.replace && tables.every(table => preview[table].new + preview[table].updated === 0)) {
          await connection.query('ROLLBACK');
          return counts;
        }
      }
      if (archive?.replace) {
        // The installed DuckDB retains a reverse FK under bean_delete_sessions
        // after deleteBean renames that table. Recreate/drop an EMPTY constraint
        // holder to remove that stale catalog dependency within this transaction.
        // CREATE intentionally fails if an unexpected table already uses the name.
        // Both replacement tables retain their exact constraints and column order.
        await connection.query(`CREATE TABLE bean_delete_sessions ${brewSessionDefinition}`);
        await connection.query('DROP TABLE bean_delete_sessions');
        await connection.query('DROP TABLE brew_sessions');
        await connection.query('DROP TABLE beans');
        await connection.query(`CREATE TABLE beans ${beanDefinition}`);
        await connection.query('INSERT INTO beans SELECT * FROM incoming_beans');
        await connection.query(`CREATE TABLE brew_sessions ${brewSessionDefinition}`);
        await connection.query('INSERT INTO brew_sessions SELECT * FROM incoming_brew_sessions');
      } else for (const table of tables) {
        const columns = Object.keys(ioSchema[table]);
        // Update non-key fields in place: REPLACE can delete parents referenced by sessions.
        await connection.query(`UPDATE ${table} SET ${columns.filter(key => key !== 'id' && (key !== 'photo_jpeg' || importedPhotos))
          .map(key => `"${key}" = i."${key}"`).join(', ')} FROM incoming_${table} i WHERE ${table}.id = i.id${archive ? ` AND (${archiveDifference(table, table, 'i')})` : ''}`);
        await connection.query(`INSERT INTO ${table} SELECT i.* FROM incoming_${table} i
          WHERE NOT EXISTS (SELECT 1 FROM ${table} existing WHERE existing.id = i.id)`);
      }
      for (const table of tables) await connection.query(`DROP TABLE incoming_${table}`);
      archive?.empty?.signal.throwIfAborted();
      archive?.empty?.onCommit?.();
      await commitTransaction(state);
    } catch (error) {
      if (error instanceof CommittedWriteError) { collectionRevision++; throw error; }
      if (error instanceof DatabaseRuntimeError) throw error;
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      for (const path of paths) {
        try { await db.dropFile(path); } catch (error) { console.warn('Could not release import buffer.', error); }
      }
    }
    await flushCommitted(state);
    return counts;
  });
}
