import { captureDriveSnapshot, getStorageMode, verifyDriveRoundTrip } from './db';
import { packageBackup, prepareBackup, preservesLegacyPhotos, preservesLegacyText } from './backups';

export type DriveStep = 'Authorize Google' | 'Read cloud history' | 'Capture local snapshot' | 'Package local snapshot'
  | 'Validate packaged snapshot' | 'Discover backup folder' | 'Upload snapshot' | 'Download snapshot'
  | 'Validate downloaded snapshot' | 'Recover empty collection' | 'Refresh app views' | 'Merge snapshot' | 'Replace snapshot'
  | 'Check exact local round trip' | 'Fingerprint local snapshot' | 'Fingerprint cloud snapshot'
  | 'Download snapshot for comparison' | 'Validate comparison snapshot' | 'Clean up older backups';
interface Entry {
  sequence: number; elapsedMs: number; step: string; outcome: 'started' | 'passed' | 'failed' | 'response';
  status?: number; errorType?: string; category?: string; frames?: string[];
}
const enabled = new URLSearchParams(location.search).get('drive-debug') === '1';
const started = performance.now(), entries: Entry[] = [];
let sequence = 0, checking = false;

function safeFailure(error: unknown): Pick<Entry, 'errorType' | 'category' | 'frames'> {
  if (!(error instanceof Error)) return { errorType: 'Non-Error rejection', category: 'unexpected' };
  const knownNames = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'DOMException', 'AbortError', 'TimeoutError'];
  const errorType = knownNames.includes(error.name) ? error.name : 'Application error';
  // Classify messages; never copy raw messages, causes, SQL or rejected values.
  const category = /not a function/.test(error.message) ? 'missing function'
    : /Cannot read|undefined|null is not|is not an object/.test(error.message) ? 'missing value'
      : /Catalog Error|Binder Error|Parser Error/.test(error.message) ? 'database query'
        : /memory|allocation|length|size/i.test(error.message) ? 'size or allocation'
          : /network|fetch|reach Google/i.test(error.message) ? 'network'
            : /denied|permission|authoriz/i.test(error.message) ? 'authorization or permission' : 'unexpected';
  // V8 prepends the raw error message to stack; it must not become a frame.
  const stack = (error.stack ?? '').split('\n').filter(line => /^\s*at\s/.test(line) || /^[^\s@]*@https?:\/\//.test(line)).join('\n');
  const frames = [...stack.matchAll(/\/(?:assets|src)\/([A-Za-z0-9_./-]+\.(?:js|ts))(?:\?[^\s():]*)?:(\d+):(\d+)/g)]
    .slice(0, 6).map(match => `${match[1]}:${match[2]}:${match[3]}`);
  return { errorType, category, frames };
}
function record(step: string, outcome: Entry['outcome'], details: Partial<Entry> = {}): void {
  if (!enabled) return;
  const entry: Entry = { sequence: ++sequence, elapsedMs: Math.round(performance.now() - started), step, outcome, ...details };
  entries.push(entry); if (entries.length > 200) entries.shift();
  console.info('[CoffeeOS Drive]', JSON.stringify(entry));
}
export function driveResponse(step: string, status: number): void { record(step, 'response', { status }); }
export function driveFailure(step: string, error: unknown): void { record(step, 'failed', safeFailure(error)); }
export async function driveStep<T>(step: DriveStep, task: () => Promise<T>): Promise<T> {
  record(step, 'started');
  try { const result = await task(); record(step, 'passed'); return result; }
  catch (error) { driveFailure(step, error); throw error; }
}
function report(): string {
  return JSON.stringify({ format: 'coffeeos-drive-diagnostics-v1',
    environment: { isolated: crossOriginIsolated, secureContext: isSecureContext, online: navigator.onLine,
      backend: getStorageMode(), serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
      subtleCrypto: Boolean(crypto.subtle), typedArrayToBase64: 'toBase64' in Uint8Array.prototype },
    entries }, null, 2);
}
async function runLocalChecks(): Promise<string> {
  if (checking) throw new Error('Local diagnostics are already running.');
  checking = true;
  try {
    const { snapshot, revision } = await driveStep('Capture local snapshot', captureDriveSnapshot);
    const file = await driveStep('Package local snapshot', () => packageBackup(snapshot));
    const prepared = await driveStep('Validate packaged snapshot', () => prepareBackup(file.data));
    await driveStep('Check exact local round trip', () => verifyDriveRoundTrip(prepared.files, snapshot.counts, revision, new AbortController().signal, preservesLegacyPhotos(prepared.manifest), preservesLegacyText(prepared.manifest)));
  } catch { /* Sanitized failure is recorded; original record values never enter the report. */ }
  finally { checking = false; }
  const value = report(); console.info('[CoffeeOS Drive report]', value); return value;
}
export function installDriveDiagnostics(): void {
  if (!enabled) return;
  window.coffeeosDriveDebug = Object.freeze({ report, runLocalChecks });
  console.info('[CoffeeOS Drive] Diagnostics enabled. Reproduce the failure, then run coffeeosDriveDebug.report(). Read-only local checks: await coffeeosDriveDebug.runLocalChecks(). Reports exclude credentials and collection contents.');
}
declare global {
  interface Window { coffeeosDriveDebug?: { report: () => string; runLocalChecks: () => Promise<string> } }
}
