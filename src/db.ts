import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import ehParquet from './vendor/duckdb/eh/parquet.duckdb_extension.wasm?url';
import mvpParquet from './vendor/duckdb/mvp/parquet.duckdb_extension.wasm?url';
import type { Bean, BrewSession } from './types';

import { isBeanPhoto } from './photos';

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
  strftime(created_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS created_at, photo_jpeg`;
const sessionColumns = `s.id, s.bean_id, b.name AS bean_name,
  strftime(s.brewed_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS brewed_at,
  s.dose_g, s.water_g, s.time_str, s.temp_c, s.grind_um, s.comment,
  s.yield_g, s.tds_pct, s.extraction_pct`;

export class DatabaseStartupError extends Error {}
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
  await storeRecord(state.snapshots, key, buffers);
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
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  if (!bundle.mainWorker) throw new Error('No compatible database worker is available.');
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(bundle.mainWorker));
  try {
    await db.instantiate(bundle.mainModule);
    const supportsOPFS = bundle.mainModule === ehWasm;
    return { db, parquetURL: supportsOPFS ? ehParquet : mvpParquet, supportsOPFS };
  } catch (error) {
    await db.terminate();
    throw error;
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
  try { snapshots = await openSnapshots(); }
  catch (error) { throw new DatabaseStartupError('Saved storage metadata could not be read. Restore browser storage access and reload; no replacement database was opened.', { cause: error }); }
  let snapshot: Snapshot | undefined;
  let preferred: StorageMode | undefined;
  try {
    if (snapshots) {
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
    connection = await db.connect();
    if (storage === 'opfs' && existingOPFS) {
      for (const table of tables) await validateStoredSchema(connection, table, table);
    }
    await connection.query(`
      SET autoinstall_known_extensions = false;
      SET autoload_known_extensions = false;
      CREATE TABLE IF NOT EXISTS beans (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL CHECK (length(trim(name)) > 0),
        roast_date DATE,
        freeze_date DATE,
        created_at TIMESTAMP NOT NULL,
        photo_jpeg VARCHAR
      );
      CREATE TABLE IF NOT EXISTS brew_sessions ${brewSessionDefinition};
    `);

    if (storage !== 'opfs' && snapshots) storage = 'indexeddb';
    const state = { db, connection, snapshots: storage === 'indexeddb' ? snapshots : null, storage };
    // IO also needs Parquet in OPFS and memory-only modes.
    const url = new URL(parquetURL, window.location.href).href.replaceAll("'", "''");
    await connection.query(`LOAD '${url}'`);
    if (storage === 'indexeddb' && snapshot) {
      // A damaged snapshot is an initialization error, never silently replaced by empty tables.
      await restoreSnapshot(state, snapshot);
    }
    // Schema v2: retain an immutable v1 recovery snapshot before the additive migration.
    // For IndexedDB the original Parquet record is retained before any future write.
    const columns = await queryRows<{ name: string }>(connection, 'PRAGMA table_info(beans)');
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
    if (storage === 'indexeddb' && snapshot === undefined) await snapshotTables(state);
    await connection.query('CHECKPOINT');
    await db.flushFiles();
    if (snapshots) await storeRecord(snapshots, 'backend-v1', storage);
    if (storage === 'opfs') snapshots?.close();
    database = state;
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
    return operation(database);
  });
}

async function queryRows<T>(connection: duckdb.AsyncDuckDBConnection, sql: string, params: SQLValue[] = []): Promise<T[]> {
  const statement = await connection.prepare(sql);
  try {
    const result = await statement.query(...params);
    // The explicit SELECT projections define this boundary between Arrow and domain types.
    return result.toArray().map((row) => row.toJSON() as T);
  } finally {
    await statement.close();
  }
}

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

export class CommittedWriteError extends Error {
  constructor(cause: unknown) {
    super('The change is already in your collection, but storage could not be confirmed. Do not submit it again. Export a backup from IO before closing this tab.', { cause });
  }
}

async function flushCommitted(state: Database): Promise<void> {
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
    // Snapshot this transaction before committing. A failed IndexedDB save rolls back the insert.
    await snapshotTables(state);
    await state.connection.query('COMMIT');
  } catch (error) {
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

export function addBean(input: { name: string; roast_date?: string | null; freeze_date?: string | null; photo_jpeg?: string | null }): Promise<Bean> {
  if (input.photo_jpeg != null && !isBeanPhoto(input.photo_jpeg)) return Promise.reject(new Error('Invalid JPEG photo.'));
  for (const date of [input.roast_date, input.freeze_date]) {
    if (date != null && (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date))) {
      return Promise.reject(new Error('Dates must use years from 0001 to 9999.'));
    }
  }
  return withDatabase((state) => write<Bean>(state,
    `INSERT INTO beans (id, name, roast_date, freeze_date, created_at, photo_jpeg) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${beanColumns}`,
    [crypto.randomUUID(), input.name.trim(), input.roast_date ?? null, input.freeze_date ?? null, new Date().toISOString(), input.photo_jpeg ?? null]));
}

export function getBrewSessions(beanId?: string): Promise<BrewSession[]> {
  return withDatabase(({ connection }) => queryRows<BrewSession>(connection,
    `SELECT ${sessionColumns} FROM brew_sessions s JOIN beans b ON b.id = s.bean_id
      ${beanId === undefined ? '' : 'WHERE s.bean_id = ?'} ORDER BY s.brewed_at DESC, s.id DESC`,
    beanId === undefined ? [] : [beanId]));
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
      await snapshotTables(state);
      await state.connection.query('COMMIT');
    } catch (error) {
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
export function updateBrewSession(id: string, input: Omit<BrewSession, 'id' | 'bean_name' | 'brewed_at'> & { brewed_at?: string }): Promise<BrewSession> {
  for (const value of [input.dose_g, input.water_g, input.temp_c, input.grind_um,
    input.yield_g, input.tds_pct, input.extraction_pct]) {
    if (value !== null && !Number.isFinite(value)) return Promise.reject(new Error('Measurements must be finite numbers.'));
  }
  return withDatabase(async (state) => {
    const existing = await queryRows(state.connection, 'SELECT id FROM brew_sessions WHERE id = ?', [id]);
    if (!existing.length) throw new Error('This brew session no longer exists.');
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
      await state.connection.close();
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

/** Merge by primary key. All selected files and their durable snapshot succeed together. */
export function importData(files: ImportFile[]): Promise<ImportResult> {
  return withDatabase(async (state) => {
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
      for (const table of tables) {
        const invalidValues = Object.entries(ioSchema[table]).filter(([, type]) => ['DATE', 'TIMESTAMP', 'DOUBLE'].includes(type))
          .map(([key, type]) => `("${key}" IS NOT NULL AND (NOT isfinite("${key}")${type === 'DOUBLE' ? ''
            : ` OR "${key}" < ${type} '0001-01-01' OR "${key}" >= ${type} '10000-01-01'`}))`);
        const required = table === 'beans' ? ['id', 'name', 'created_at'] : ['id', 'bean_id', 'brewed_at'];
        const invalid = [...required.map(key => `"${key}" IS NULL`), "length(trim(id)) = 0", ...invalidValues];
        invalid.push(table === 'beans' ? 'length(trim(name)) = 0' : 'length(trim(bean_id)) = 0');
        const [row] = await queryRows<{ invalid: number; duplicates: number }>(connection,
          `SELECT CAST(count(*) FILTER (WHERE ${invalid.join(' OR ')}) AS INTEGER) AS invalid,
            CAST(count(*) - count(DISTINCT id) AS INTEGER) AS duplicates FROM incoming_${table}`);
        if (row!.invalid || row!.duplicates) throw new ImportDataError(`The ${table} file contains invalid values or duplicate IDs.`);
      }
      const photos = await queryRows<{ photo_jpeg: string }>(connection, 'SELECT photo_jpeg FROM incoming_beans WHERE photo_jpeg IS NOT NULL');
      if (photos.some(row => !isBeanPhoto(row.photo_jpeg))) throw new ImportDataError('The beans file contains an invalid JPEG photo.');
      const [orphans] = await queryRows<{ count: number }>(connection,
        `SELECT CAST(count(*) AS INTEGER) AS count FROM incoming_brew_sessions s
          WHERE NOT EXISTS (SELECT 1 FROM beans b WHERE b.id = s.bean_id)
          AND NOT EXISTS (SELECT 1 FROM incoming_beans b WHERE b.id = s.bean_id)`);
      if (orphans!.count) throw new ImportDataError('Some sessions refer to missing beans. Include their beans file in this import.');
      const [result] = await queryRows<ImportResult>(connection,
        `SELECT CAST((SELECT count(*) FROM incoming_beans) AS INTEGER) AS beans,
          CAST((SELECT count(*) FROM incoming_brew_sessions) AS INTEGER) AS brew_sessions`);
      counts = result!;
      for (const table of tables) {
        const columns = Object.keys(ioSchema[table]);
        // Update non-key fields in place: REPLACE can delete parents referenced by sessions.
        await connection.query(`UPDATE ${table} SET ${columns.filter(key => key !== 'id' && (key !== 'photo_jpeg' || importedPhotos))
          .map(key => `"${key}" = i."${key}"`).join(', ')} FROM incoming_${table} i WHERE ${table}.id = i.id`);
        await connection.query(`INSERT INTO ${table} SELECT i.* FROM incoming_${table} i
          WHERE NOT EXISTS (SELECT 1 FROM ${table} existing WHERE existing.id = i.id)`);
      }
      for (const table of tables) await connection.query(`DROP TABLE incoming_${table}`);
      await snapshotTables(state);
      await connection.query('COMMIT');
    } catch (error) {
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
