import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import ehParquet from './vendor/duckdb/eh/parquet.duckdb_extension.wasm?url';
import mvpParquet from './vendor/duckdb/mvp/parquet.duckdb_extension.wasm?url';
import type { Bean, BrewSession } from './types';

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
  strftime(created_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS created_at`;
const sessionColumns = `s.id, s.bean_id, b.name AS bean_name,
  strftime(s.brewed_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS brewed_at,
  s.dose_g, s.water_g, s.time_str, s.temp_c, s.grind_um, s.comment,
  s.yield_g, s.tds_pct, s.extraction_pct`;

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

function readSnapshot(store: IDBDatabase): Promise<Snapshot | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = store.transaction('snapshots', 'readonly');
    const request = transaction.objectStore('snapshots').get(snapshotKey);
    transaction.oncomplete = () => resolve(request.result as Snapshot | undefined);
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not read saved coffee data.'));
    transaction.onerror = () => { /* onabort reports the final transaction failure. */ };
  });
}

function storeSnapshot(store: IDBDatabase, snapshot: Snapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = store.transaction('snapshots', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not save coffee data.'));
    transaction.onerror = () => { /* onabort reports the final transaction failure. */ };
    // Both tables belong to a single atomic record, so references stay consistent.
    transaction.objectStore('snapshots').put(snapshot, snapshotKey);
  });
}

async function snapshotTables(state: Database): Promise<void> {
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
  await storeSnapshot(state.snapshots, buffers);
}

async function restoreSnapshot(state: Database, snapshot: Snapshot): Promise<void> {
  await state.connection.query('BEGIN TRANSACTION');
  try {
    // Restore parents first to satisfy the foreign key on brew_sessions.
    for (const table of tables) {
      const path = `restore-${table}.parquet`;
      await state.db.registerFileBuffer(path, snapshot[table]);
      try {
        await state.connection.query(`INSERT INTO ${table} SELECT * FROM read_parquet('${path}')`);
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

  let { db, parquetURL, supportsOPFS } = await createEngine();
  let storage: StorageMode = 'memory';
  // The pinned MVP runtime throws _setThrew on reopening OPFS databases. Use the
  // portable snapshot backend there rather than switching datasets after reload.
  if (supportsOPFS && window.crossOriginIsolated && typeof navigator.storage?.getDirectory === 'function') {
    try {
      const root = await navigator.storage.getDirectory();
      // Bind the URI's OPFS file to a plain DuckDB filename. This version skips
      // empty handles during automatic registration and normalizes opfs:// to
      // opfs:/ internally; a plain registered filename avoids both issues.
      for (const name of ['coffeos.db', 'coffeos.db.wal']) {
        const handle = await root.getFileHandle(name, { create: true });
        await db.registerFileHandle(name, handle, duckdb.DuckDBDataProtocol.BROWSER_FSACCESS, true);
      }
      await db.open({ path: databasePath.slice('opfs://'.length), accessMode: duckdb.DuckDBAccessMode.READ_WRITE, useDirectIO: true });
      storage = 'opfs';
    } catch (error) {
      console.warn('OPFS is unavailable or locked; using snapshot storage.', error);
      // A failed registration/open can retain handles. Discard that worker entirely.
      await db.terminate();
      ({ db, parquetURL } = await createEngine());
    }
  }

  let connection: duckdb.AsyncDuckDBConnection | null = null;
  let snapshots: IDBDatabase | null = null;
  try {
    if (storage !== 'opfs') await db.open({ path: ':memory:' });
    connection = await db.connect();
    await connection.query(`
      SET autoinstall_known_extensions = false;
      SET autoload_known_extensions = false;
      CREATE TABLE IF NOT EXISTS beans (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL CHECK (length(trim(name)) > 0),
        roast_date DATE,
        freeze_date DATE,
        created_at TIMESTAMP NOT NULL
      );
      CREATE TABLE IF NOT EXISTS brew_sessions (
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
      );
    `);

    if (storage !== 'opfs') {
      try {
        snapshots = await openSnapshots();
        storage = 'indexeddb';
      } catch (error) {
        console.warn('IndexedDB is unavailable; coffee data will last for this tab only.', error);
      }
    }
    const state = { db, connection, snapshots, storage };
    // IO also needs Parquet in OPFS and memory-only modes.
    const url = new URL(parquetURL, window.location.href).href.replaceAll("'", "''");
    await connection.query(`LOAD '${url}'`);
    if (snapshots) {
      // A damaged snapshot is an initialization error, never silently replaced by empty tables.
      const snapshot = await readSnapshot(snapshots);
      if (snapshot) await restoreSnapshot(state, snapshot);
    }
    await connection.query('CHECKPOINT');
    await db.flushFiles();
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
    initialization = enqueue(initialize).catch((error: unknown) => {
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
  await state.connection.query('CHECKPOINT');
  await state.db.flushFiles();
  return rows[0];
}

export function getBeans(): Promise<Bean[]> {
  return withDatabase(({ connection }) => queryRows<Bean>(connection,
    `SELECT ${beanColumns} FROM beans ORDER BY created_at DESC, id DESC`));
}

export function addBean(input: { name: string; roast_date?: string | null; freeze_date?: string | null }): Promise<Bean> {
  return withDatabase((state) => write<Bean>(state,
    `INSERT INTO beans VALUES (?, ?, ?, ?, ?) RETURNING ${beanColumns}`,
    [crypto.randomUUID(), input.name.trim(), input.roast_date ?? null, input.freeze_date ?? null, new Date().toISOString()]));
}

export function getBrewSessions(beanId?: string): Promise<BrewSession[]> {
  return withDatabase(({ connection }) => queryRows<BrewSession>(connection,
    `SELECT ${sessionColumns} FROM brew_sessions s JOIN beans b ON b.id = s.bean_id
      ${beanId === undefined ? '' : 'WHERE s.bean_id = ?'} ORDER BY s.brewed_at DESC, s.id DESC`,
    beanId === undefined ? [] : [beanId]));
}

export function addBrewSession(input: Omit<BrewSession, 'id' | 'brewed_at' | 'bean_name'>): Promise<BrewSession> {
  return withDatabase((state) => write<BrewSession>(state,
    `INSERT INTO brew_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, bean_id, strftime(brewed_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS brewed_at,
        dose_g, water_g, time_str, temp_c, grind_um, comment, yield_g, tds_pct, extraction_pct`,
    [crypto.randomUUID(), input.bean_id, new Date().toISOString(), input.dose_g, input.water_g,
      input.time_str, input.temp_c, input.grind_um, input.comment, input.yield_g, input.tds_pct, input.extraction_pct]));
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
      await state.db.terminate();
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
  beans: { id: 'VARCHAR', name: 'VARCHAR', roast_date: 'DATE', freeze_date: 'DATE', created_at: 'TIMESTAMP' },
  brew_sessions: { id: 'VARCHAR', bean_id: 'VARCHAR', brewed_at: 'TIMESTAMP', dose_g: 'DOUBLE',
    water_g: 'DOUBLE', time_str: 'VARCHAR', temp_c: 'DOUBLE', grind_um: 'DOUBLE', comment: 'VARCHAR',
    yield_g: 'DOUBLE', tds_pct: 'DOUBLE', extraction_pct: 'DOUBLE' },
} as const;
const combinedBeanNames = ['bean_id', 'bean_name', 'bean_roast_date', 'bean_freeze_date', 'bean_created_at'];
const combinedSessionNames = Object.keys(ioSchema.brew_sessions).filter(key => key !== 'bean_id')
  .map(key => key === 'id' ? 'session_id' : key);
const combinedQuery = `SELECT b.id AS bean_id, b.name AS bean_name,
  b.roast_date AS bean_roast_date, b.freeze_date AS bean_freeze_date, b.created_at AS bean_created_at,
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
        if (columns.length !== expected.length || columns.some(column => !expected.includes(column.name))) {
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
            return `CAST("${source}" AS ${type}) AS "${key}"`;
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
          .map(([key]) => `("${key}" IS NOT NULL AND NOT isfinite("${key}"))`);
        const required = table === 'beans' ? ['id', 'name', 'created_at'] : ['id', 'bean_id', 'brewed_at'];
        const invalid = [...required.map(key => `"${key}" IS NULL`), "length(trim(id)) = 0", ...invalidValues];
        invalid.push(table === 'beans' ? 'length(trim(name)) = 0' : 'length(trim(bean_id)) = 0');
        const [row] = await queryRows<{ invalid: number; duplicates: number }>(connection,
          `SELECT CAST(count(*) FILTER (WHERE ${invalid.join(' OR ')}) AS INTEGER) AS invalid,
            CAST(count(*) - count(DISTINCT id) AS INTEGER) AS duplicates FROM incoming_${table}`);
        if (row!.invalid || row!.duplicates) throw new ImportDataError(`The ${table} file contains invalid values or duplicate IDs.`);
      }
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
        await connection.query(`UPDATE ${table} SET ${columns.filter(key => key !== 'id')
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
      for (const path of paths) await db.dropFile(path);
    }
    await connection.query('CHECKPOINT');
    await db.flushFiles();
    return counts;
  });
}
