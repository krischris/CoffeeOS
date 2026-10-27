import { Inflate, zipSync } from 'fflate';
import { backupColumns, backupLimits, backupTables, sessionForeignKeys } from './backupContract';
import type { BackupTable } from './backupContract';
import { exportBackupSnapshot, previewBackupData, mergeBackupData, replaceBackupData, ImportDataError } from './db';
import type { BackupSnapshot, ExportFile, ImportFile, ImportPreview, ImportResult } from './db';
import { sha256 } from './hash';

export { sha256 } from './hash';
export { backupLimits } from './backupContract';
interface TableDescriptor {
  name: BackupTable; path: string; row_count: number; byte_length: number; sha256: string;
  primary_key: string[]; columns: typeof backupColumns.beans; foreign_keys?: typeof sessionForeignKeys;
}
export interface BackupManifest {
  format: 'coffeeos-backup'; format_version: 1; data_schema_version: 1;
  backup_id: string; exported_at: string; producer: { name: 'CoffeeOS'; version: string }; tables: TableDescriptor[];
}
export interface PreparedBackup { manifest: BackupManifest; files: ImportFile[]; preview: ImportPreview }
const names = ['manifest.json', 'beans.parquet', 'brew_sessions.parquet'];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function fail(message: string): never { throw new ImportDataError(message); }
const sizeError = (): never => fail('This backup contains unsupported or inconsistent file sizes. Keep the original file and choose an intact CoffeeOS backup.');
const safeCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const matches = (actual: unknown, expected: unknown): boolean => {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => matches(actual[i], v));
  if (object(expected)) return object(actual) && Object.entries(expected).every(([key, value]) => matches(actual[key], value));
  return actual === expected;
};
export function validateManifest(value: unknown): BackupManifest {
  if (!object(value) || value.format !== 'coffeeos-backup') fail('This is not a CoffeeOS backup. Choose the original .coffeeos file.');
  if (value.format_version !== 1 || value.data_schema_version !== 1) fail('This backup needs a different CoffeeOS version. Keep the original and open it in a compatible version.');
  if (typeof value.backup_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.backup_id) ||
    typeof value.exported_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.exported_at) ||
    !Number.isFinite(Date.parse(value.exported_at)) ||
    !object(value.producer) || value.producer.name !== 'CoffeeOS' || typeof value.producer.version !== 'string' || !value.producer.version.trim() ||
    !Array.isArray(value.tables) || value.tables.length !== 2) fail('The backup information is incomplete or damaged. Choose another copy.');
  const timestamp = value.exported_at as string;
  const instant = new Date(timestamp);
  if (instant.toISOString().slice(0, 19) !== timestamp.slice(0, 19) || timestamp.startsWith('0000')) fail('The backup date is invalid. Choose an intact copy.');
  for (const name of backupTables) {
    const entries = value.tables.filter((t: unknown) => object(t) && t.name === name);
    const t = entries[0];
    if (entries.length !== 1 || !object(t) || t.path !== `${name}.parquet` || !safeCount(t.row_count) || !safeCount(t.byte_length) ||
      typeof t.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(t.sha256) || !matches(t.primary_key, ['id']) ||
      !matches(t.columns, backupColumns[name]) ||
      (name === 'brew_sessions' ? !matches(t.foreign_keys, sessionForeignKeys) : t.foreign_keys !== undefined && !matches(t.foreign_keys, []))) {
      fail(`The ${name} table information does not match CoffeeOS backup version 1.`);
    }
    const columns = t.columns as Record<string, unknown>[];
    if (columns.some((c, i) => c.unit !== backupColumns[name][i].unit)) fail('The backup uses unsupported field units.');
  }
  return value as unknown as BackupManifest;
}

/** Hash/ZIP never holds the database queue. COPY bytes never pass through Date/JSON. */
export async function packageBackup(snapshot: BackupSnapshot): Promise<ExportFile> {
  const total = snapshot.data.beans.length + snapshot.data.brew_sessions.length;
  if (total > backupLimits.expanded - backupLimits.manifest - 1024) sizeError();
  const descriptors: TableDescriptor[] = [];
  for (const name of backupTables) descriptors.push({ name, path: `${name}.parquet`, row_count: snapshot.counts[name],
    byte_length: snapshot.data[name].length, sha256: await sha256(snapshot.data[name]), primary_key: ['id'], columns: backupColumns[name],
    ...(name === 'brew_sessions' ? { foreign_keys: sessionForeignKeys } : {}) });
  const manifest: BackupManifest = { format: 'coffeeos-backup', format_version: 1, data_schema_version: 1,
    backup_id: crypto.randomUUID(), exported_at: snapshot.exported_at,
    producer: { name: 'CoffeeOS', version: '0.0.0' }, tables: descriptors };
  validateManifest(manifest);
  const json = encoder.encode(JSON.stringify(manifest, null, 2));
  if (json.length > backupLimits.manifest) sizeError();
  const data = zipSync({ 'manifest.json': json, 'beans.parquet': snapshot.data.beans, 'brew_sessions.parquet': snapshot.data.brew_sessions }, { level: 0 });
  if (data.length > backupLimits.archive) sizeError();
  // Verify ZIP32 sizes/offsets before offering a download; ZIP64 is unsupported.
  inspectArchive(data);
  const stamp = snapshot.exported_at.replace(/:/g, '').replace(/\.\d+Z$/, 'Z');
  return { name: `CoffeeOS-${stamp}.coffeeos`, type: 'application/zip', data };
}
export async function saveBackup(): Promise<ExportFile> { return packageBackup(await exportBackupSnapshot()); }

// CRC32 verifies ZIP integrity, including the manifest. SHA-256 binds the tables to it.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const v of data) crc = crcTable[(crc ^ v) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
interface Entry { name: string; method: number; crc: number; size: number; start: number; end: number }
/** Audit directory AND local headers before decoding any entry. No filesystem extraction. */
export function inspectArchive(data: Uint8Array): Entry[] {
  if (data.length > backupLimits.archive) sizeError();
  const broken = () => fail('The ZIP archive is damaged or uses unsupported features. Choose another copy (ordinary STORE or DEFLATE ZIP).');
  if (data.length < 22) broken();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (p: number) => view.getUint16(p, true);
  const u32 = (p: number) => view.getUint32(p, true);
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === data.length) break;
  if (end < 0 || u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== 3 || u16(end + 10) !== 3) broken();
  const directory = u32(end + 16);
  if (directory + u32(end + 12) !== end) broken();
  const entries: Entry[] = [];
  const ranges: [number, number][] = [];
  let p = directory;
  let total = 0;
  const extra = (start: number, length: number) => {
    const stop = start + length;
    while (start < stop) {
      if (start + 4 > stop) broken();
      const id = u16(start), len = u16(start + 2);
      if (id === 1 || id === 0x9901 || start + 4 + len > stop) broken(); // ZIP64 / AES
      start += 4 + len;
    }
  };
  for (let i = 0; i < 3; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) broken();
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), packed = u32(p + 20), size = u32(p + 24);
    const nl = u16(p + 28), el = u16(p + 30), cl = u16(p + 32), local = u32(p + 42);
    if (p + 46 + nl + el + cl > end || u16(p + 34) || flags & ~0x080e || ![0, 8].includes(method) ||
      (u32(p + 38) & 0x10) || ![0, 0x8000].includes((u32(p + 38) >>> 16) & 0xf000)) broken();
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nl));
    if (!names.includes(name) || entries.some(e => e.name === name)) fail('A backup must contain exactly manifest.json, beans.parquet and brew_sessions.parquet, once each at the ZIP root.');
    if (size > (name === 'manifest.json' ? backupLimits.manifest : backupLimits.expanded)) sizeError();
    total += size;
    if (total > backupLimits.expanded) sizeError();
    extra(p + 46 + nl, el);
    if (local + 30 > directory || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) broken();
    const ln = u16(local + 26), le = u16(local + 28);
    const start = local + 30 + ln + le, stop = start + packed;
    if (start > directory || stop > directory || decoder.decode(data.subarray(local + 30, local + 30 + ln)) !== name) broken();
    extra(local + 30 + ln, le);
    if (flags & 8) {
      for (const [offset, expected] of [[14, crc], [18, packed], [22, size]]) if (u32(local + offset) !== 0 && u32(local + offset) !== expected) broken();
      let d = stop;
      if (d + 4 <= directory && u32(d) === 0x08074b50) d += 4;
      if (d + 12 > directory || u32(d) !== crc || u32(d + 4) !== packed || u32(d + 8) !== size) broken();
      ranges.push([local, d + 12]);
    } else {
      if (u32(local + 14) !== crc || u32(local + 18) !== packed || u32(local + 22) !== size) broken();
      ranges.push([local, stop]);
    }
    if (method === 0 && packed !== size) broken();
    entries.push({ name, method, crc, size, start, end: stop });
    p += 46 + nl + el + cl;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (p !== end || ranges[0][0] !== 0 || ranges[2][1] !== directory || ranges.some((r, i) => i > 0 && r[0] !== ranges[i - 1][1])) broken();
  return entries;
}
function extract(data: Uint8Array, entry: Entry): Uint8Array {
  let result: Uint8Array;
  if (entry.method === 0) result = data.subarray(entry.start, entry.end);
  else {
    // Input chunks bound even the transient Inflate output (~1 MiB maximum per push).
    // The sink rejects actual expanded bytes before retaining/copying each chunk.
    result = new Uint8Array(entry.size);
    let written = 0;
    const inflate = new Inflate(chunk => {
      if (written + chunk.length > entry.size) sizeError();
      result.set(chunk, written); written += chunk.length;
    });
    for (let p = entry.start; p < entry.end; p += 1024) inflate.push(data.subarray(p, Math.min(p + 1024, entry.end)), p + 1024 >= entry.end);
    if (written !== entry.size) fail('The backup is truncated. Choose another copy.');
  }
  if (crc32(result) !== entry.crc) fail('The backup failed its ZIP integrity check. Choose another copy.');
  return result;
}
export async function unpackBackup(data: Uint8Array): Promise<{ manifest: BackupManifest; files: ImportFile[] }> {
  try {
    const entries = inspectArchive(data);
    const json = extract(data, entries.find(e => e.name === 'manifest.json')!);
    const manifest = validateManifest(JSON.parse(decoder.decode(json)));
    const files: ImportFile[] = [];
    for (const name of backupTables) {
      const descriptor = manifest.tables.find(t => t.name === name)!;
      const bytes = extract(data, entries.find(e => e.name === `${name}.parquet`)!);
      if (bytes.length !== descriptor.byte_length || await sha256(bytes) !== descriptor.sha256) fail(`The ${name} table is damaged or does not belong to this backup. Choose another copy.`);
      files.push({ target: name, name: `${name}.parquet`, data: bytes });
    }
    return { manifest, files };
  } catch (error) {
    if (error instanceof ImportDataError) throw error;
    throw new ImportDataError('The backup could not be read. Keep the original file and choose an intact CoffeeOS backup.', { cause: error });
  }
}
function counts(manifest: BackupManifest) {
  return Object.fromEntries(manifest.tables.map(t => [t.name, t.row_count])) as Record<BackupTable, number>;
}
export async function prepareBackup(data: Uint8Array): Promise<PreparedBackup> {
  const { manifest, files } = await unpackBackup(data);
  return { manifest, files, preview: await previewBackupData(files, counts(manifest)) };
}
export async function confirmBackup(prepared: PreparedBackup): Promise<ImportResult | ImportPreview> {
  return mergeBackupData(prepared.files, counts(prepared.manifest), prepared.preview);
}

export async function replaceBackup(prepared: PreparedBackup): Promise<ImportResult | ImportPreview> {
  return replaceBackupData(prepared.files, counts(prepared.manifest), prepared.preview);
}
