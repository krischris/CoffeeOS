import { driveStep, driveResponse, driveFailure } from './driveDiagnostics';
import { backupLimits, packageBackup, prepareBackup, sha256, unpackBackup } from './backups';
import { captureDriveSnapshot, recoverEmptyBackup } from './db';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export class DriveError extends Error {}
export class DriveAuthError extends DriveError {}
class DriveTransientError extends DriveError {}
export interface DriveAccount { token: string; expiresAt: number; sub: string; email: string }
export interface RemoteFile {
  id: string; createdTime: string; size?: string; sha256Checksum?: string;
  appProperties?: Record<string, string>;
}
const fields = 'id,createdTime,size,sha256Checksum,appProperties';
const marker = (kind: string) => `appProperties has { key='coffeeosKind' and value='${kind}' }`;
const escapeQuery = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** No account or token is persisted. All requests are bounded and cancellation-aware. */
export class DriveClient {
  constructor(private account: DriveAccount, private signal: AbortSignal, private transport: typeof fetch = fetch,
    private progress: (message: string) => void = () => undefined,
    private reauthorize?: () => Promise<DriveAccount>) {}
  private async renew(): Promise<void> {
    if (!this.reauthorize) throw new DriveAuthError('Google authorization expired. Reconnect to try again.');
    const next = await this.reauthorize();
    this.signal.throwIfAborted();
    if (next.sub !== this.account.sub) throw new DriveAuthError('Choose the original Google account to resume. Cancel before switching accounts.');
    this.account = next;
  }
  private async pause(attempt: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(this.signal.reason); };
      const timer = setTimeout(() => { this.signal.removeEventListener('abort', abort); resolve(); }, 500 * 2 ** attempt);
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) abort();
    });
  }
  private async request(path: string, init: RequestInit = {}, resumable = false): Promise<Response> {
    const url = new URL(path, 'https://www.googleapis.com/');
    if (url.origin !== 'https://www.googleapis.com' || !url.pathname.startsWith(resumable ? '/upload/drive/v3/files' : '/')) {
      throw new DriveError('Drive returned an unsupported upload destination.');
    }
    const retryable = !init.method || (resumable && !init.body);
    const phase = resumable ? (init.body ? 'Upload backup chunk' : 'Check upload progress')
      : url.pathname.startsWith('/upload/') ? 'Start backup upload'
        : url.pathname === '/drive/v3/files' ? (init.method === 'POST' ? 'Create backup folder' : 'Read backup history')
          : url.searchParams.get('alt') === 'media' ? 'Download selected backup' : 'Verify uploaded backup';
    let renewed = false;
    for (let attempt = 0; ; attempt++) {
      this.signal.throwIfAborted();
      if (Date.now() >= this.account.expiresAt) { await this.renew(); renewed = true; }
      this.progress(`${phase}…`);
      let response: Response;
      try {
        // Native Window.fetch requires its global receiver. Calling the stored
        // transport as a client method fails before network access in Chrome.
        response = await this.transport.call(globalThis, url.href, {
          ...init, headers: { ...init.headers, Authorization: `Bearer ${this.account.token}` },
          signal: AbortSignal.any([this.signal, AbortSignal.timeout(60_000)]), redirect: 'error', credentials: 'omit',
        });
      } catch (error) {
        if (retryable && attempt < 3 && !this.signal.aborted) { await this.pause(attempt); continue; }
        if (this.signal.aborted) throw error;
        driveFailure(phase, error);
        throw new DriveTransientError(`${phase} could not reach Google. Check your connection and browser network restrictions, then retry.`);
      }
      driveResponse(phase, response.status);
      if (response.status === 401) {
        if (renewed) throw new DriveAuthError('Google access was revoked. Cancel and reconnect.');
        await this.renew(); renewed = true; continue;
      }
      if (resumable && response.status === 308) return response;
      if (response.ok) return response;
      let reason = '';
      try { reason = (await response.clone().json()).error?.errors?.[0]?.reason ?? ''; } catch { /* Status still identifies the failure. */ }
      const transient = response.status === 429 || response.status >= 500 || ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason);
      if (transient && retryable && attempt < 3) { await this.pause(attempt); continue; }
      if (response.status === 404 || response.status === 410) throw new DriveError(`${phase} failed (HTTP ${response.status}): Drive file or upload session is missing or expired. Refresh history; your local collection is kept.`);
      if (reason === 'storageQuotaExceeded') throw new DriveError(`${phase} failed: Google Drive is full. Free space or save a local backup.`);
      // Never show Google's free-form message: it can contain account or file data.
      const reasons: Record<string, string> = {
        accessNotConfigured: 'Drive API is not enabled for this Google project',
        serviceDisabled: 'Drive API is not enabled for this Google project',
        insufficientPermissions: 'Google did not grant the required Drive file permission',
        appNotAuthorizedToFile: 'this account has not authorized CoffeeOS to access that file',
        rateLimitExceeded: 'Google temporarily limited requests',
        userRateLimitExceeded: 'Google temporarily limited requests for this account',
        dailyLimitExceeded: 'the Google project reached its daily request limit',
        forbidden: 'Google denied this operation',
      };
      const detail = reasons[reason] ?? 'Check Google access, connection and available Drive space';
      throw new (transient ? DriveTransientError : DriveError)(`${phase} failed (HTTP ${response.status}): ${detail}. Try again after resolving this issue.`);
    }
  }
  private async list(query: string): Promise<RemoteFile[]> {
    const params = new URLSearchParams({ q: `trashed = false and ${query}`, spaces: 'drive', pageSize: '1000',
      fields: `nextPageToken,incompleteSearch,files(${fields})` });
    const files: RemoteFile[] = [], pages = new Set<string>();
    do {
      const value = await (await this.request(`drive/v3/files?${params}`)).json();
      if (!Array.isArray(value.files) || value.incompleteSearch || value.files.some((f: RemoteFile) =>
        !f || typeof f.id !== 'string' || !/^[\w-]+$/.test(f.id))) throw new DriveError('Drive returned an incomplete history. Try again.');
      files.push(...value.files);
      if (!value.nextPageToken) return [...new Map(files.map(f => [f.id, f])).values()];
      if (typeof value.nextPageToken !== 'string' || pages.has(value.nextPageToken) || pages.size >= 10000) throw new DriveError('Drive returned an incomplete history. Try again.');
      pages.add(value.nextPageToken); params.set('pageToken', value.nextPageToken);
    } while (true);
  }
  async folder(create: boolean): Promise<string | null> {
    const found = await this.list(`mimeType = 'application/vnd.google-apps.folder' and ${marker('backups-folder-v1')}`);
    if (found.length) return found.map(f => f.id).sort()[0];
    if (!create) return null;
    let id: string;
    try {
      const result = await (await this.request('drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CoffeeOS Backups', mimeType: 'application/vnd.google-apps.folder', appProperties: { coffeeosKind: 'backups-folder-v1' } }) })).json();
      if (typeof result.id !== 'string' || !/^[\w-]+$/.test(result.id)) throw new Error();
      id = result.id;
    } catch (error) {
      if (this.signal.aborted) throw error;
      throw new DriveError('Backup folder creation is unconfirmed. Reconnect to rediscover it before trying again.');
    }
    const verified = await this.list(`mimeType = 'application/vnd.google-apps.folder' and ${marker('backups-folder-v1')}`);
    if (!verified.some(f => f.id === id)) throw new DriveError('Backup folder discovery changed. Refresh before uploading.');
    return verified.map(f => f.id).sort()[0];
  }
  async history(): Promise<RemoteFile[]> {
    // Account-wide app markers also find snapshots moved outside the original folder.
    const files = (await this.list(marker('snapshot-v1'))).filter(f => f.size && f.sha256Checksum && f.appProperties?.backupId && f.appProperties?.archiveSha256);
    return this.order(files);
  }
  private order(files: RemoteFile[]): RemoteFile[] {
    if (files.some(f => !Number.isFinite(Date.parse(f.createdTime)))) throw new DriveError('Drive history has an invalid upload date. Recovery stopped.');
    const time = (value: string) => BigInt(Date.parse(value)) * 1_000_000n +
      BigInt((value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '').padEnd(9, '0').slice(3, 9));
    files.sort((a, b) => time(a.createdTime) < time(b.createdTime) ? 1 : time(a.createdTime) > time(b.createdTime) ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return files;
  }
  async latest(_folder?: string): Promise<RemoteFile | null> { return (await this.history())[0] ?? null; }
  private verify(file: RemoteFile, id: string, hash: string, size: number): void {
    if (file.size !== String(size) || file.sha256Checksum?.toLowerCase() !== hash || file.appProperties?.backupId !== id ||
      file.appProperties?.archiveSha256 !== hash || file.appProperties?.coffeeosKind !== 'snapshot-v1') {
      throw new DriveError('Drive backup completion could not be verified. Keep your local backup; no second upload was attempted.');
    }
  }
  async upload(folder: string, data: Uint8Array, backupId: string, name: string): Promise<RemoteFile> {
    const hash = await sha256(data);
    const metadata = { name: name.replace('.coffeeos', `-${backupId}.coffeeos`), parents: [folder], mimeType: 'application/zip',
      appProperties: { coffeeosKind: 'snapshot-v1', backupId, archiveSha256: hash } };
    if (data.length > backupLimits.archive) throw new DriveError('This backup exceeds the supported archive size.');
    try {
      const start = await this.request(`upload/drive/v3/files?uploadType=resumable&fields=${fields}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(data.length) },
        body: JSON.stringify(metadata) });
      const location = start.headers.get('Location');
      if (!location) throw new DriveError('Drive did not return an upload session.');
      let offset = 0, failures = 0;
      while (true) {
        this.signal.throwIfAborted();
        this.progress(`Uploading ${offset} of ${data.length} bytes…`);
        let response: Response;
        try {
          const end = Math.min(offset + 1024 * 1024, data.length);
          response = await this.request(location, { method: 'PUT',
            headers: { 'Content-Type': 'application/zip', 'Content-Range': `bytes ${offset}-${end - 1}/${data.length}` },
            body: new Blob([new Uint8Array(data.subarray(offset, end))]) }, true);
        } catch (error) {
          if (this.signal.aborted || (error instanceof DriveError && !(error instanceof DriveTransientError)) || failures++ >= 3) throw error;
          await this.pause(failures - 1);
          // Probe the same session before resending any bytes, including a lost final response.
          response = await this.request(location, { method: 'PUT', headers: { 'Content-Range': `bytes */${data.length}` } }, true);
        }
        if (response.status !== 308) {
          const result = await response.json();
          if (typeof result.id !== 'string' || !/^[\w-]+$/.test(result.id)) throw new DriveError('Invalid completed file identity.');
          const remote = await (await this.request(`drive/v3/files/${result.id}?fields=${fields}`)).json();
          this.verify(remote, backupId, hash, data.length);
          return remote;
        }
        const range = response.headers.get('Range');
        const match = range?.match(/^bytes=0-(\d+)$/);
        if (range && !match) throw new DriveError('Drive returned an invalid upload range.');
        const next = match ? Number(match[1]) + 1 : 0;
        if (!Number.isSafeInteger(next) || next < offset || next >= data.length) throw new DriveError('Drive returned an invalid upload range.');
        if (next === offset && failures++ >= 3) throw new DriveError('Upload stalled.');
        offset = next;
      }
    } catch (error) {
      if (this.signal.aborted) throw error;
      // Reconcile the SAME immutable backup ID. Never POST a second archive on an uncertain result.
      try {
        const matches = await this.list(`${marker('snapshot-v1')} and appProperties has { key='backupId' and value='${escapeQuery(backupId)}' }`);
        if (matches.length === 1) { this.verify(matches[0], backupId, hash, data.length); return matches[0]; }
      } catch { /* Preserve the unconfirmed outcome, including auth failures during lookup. */ }
      const message = 'Upload result is unconfirmed. No second upload was attempted. Keep a local backup and inspect CoffeeOS Backups in Drive before another Sync now.';
      if (error instanceof DriveAuthError) throw new DriveAuthError(`${message} Reconnect to authorize again.`);
      throw new DriveError(error instanceof DriveError ? `${message} ${error.message}` : message);
    }
  }
  async download(file: RemoteFile): Promise<Uint8Array> {
    if (!file.size || !/^\d+$/.test(file.size) || !Number.isSafeInteger(Number(file.size))) {
      throw new DriveError('Drive returned an invalid backup size. Recovery stopped; keep the original file.');
    }
    const expectedSize = Number(file.size);
    if (expectedSize > backupLimits.archive) throw new DriveError('This backup exceeds the supported archive size.');
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(expectedSize); } catch { throw new DriveError('This device cannot hold that backup in memory. Choose a smaller snapshot or use another device.'); }
    const response = await this.request(`drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
    const length = response.headers.get('Content-Length');
    if (length && Number(length) !== expectedSize) {
      await response.body?.cancel();
      throw new DriveError('Drive backup size does not match its metadata. Recovery stopped; keep the original file.');
    }
    if (!response.body) throw new DriveError('Drive returned no backup content. Try again.');
    const reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        this.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > expectedSize) throw new DriveError('Drive backup size does not match its metadata. Recovery stopped; keep the original file.');
        bytes.set(value, size - value.length);
        this.progress(`Downloading ${size} of ${expectedSize} bytes…`);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (size !== expectedSize) throw new DriveError('Drive backup size does not match its metadata.');
    this.verify(file, file.appProperties?.backupId ?? '', await sha256(bytes), size);
    return bytes;
  }
}

export async function syncDrive(client: DriveClient, signal: AbortSignal): Promise<{ message: string; imported: boolean }> {
  const { snapshot, revision } = await driveStep('Capture local snapshot', captureDriveSnapshot);
  signal.throwIfAborted();
  if (snapshot.counts.beans + snapshot.counts.brew_sessions > 0) {
    const file = await driveStep('Package local snapshot', () => packageBackup(snapshot));
    const { manifest } = await driveStep('Validate packaged snapshot', () => unpackBackup(file.data));
    const folder = await driveStep('Discover backup folder', () => client.folder(true));
    await driveStep('Upload snapshot', () => client.upload(folder!, file.data, manifest.backup_id, file.name));
    return { imported: false, message: `Uploaded backup captured ${snapshot.exported_at}: ${snapshot.counts.beans} beans and ${snapshot.counts.brew_sessions} brew sessions (${file.data.length} bytes). Later edits wait for Sync now.` };
  }
  const latest = await driveStep('Read cloud history', () => client.latest());
  if (!latest) return { imported: false, message: 'No Drive backup yet. No empty backup was uploaded.' };
  const downloaded = await driveStep('Download snapshot', () => client.download(latest));
  const prepared = await driveStep('Validate downloaded snapshot', () => prepareBackup(downloaded));
  if (prepared.manifest.backup_id !== latest.appProperties?.backupId) throw new DriveError('The latest Drive backup identity does not match its archive. Recovery stopped; keep the original file.');
  const counts = Object.fromEntries(prepared.manifest.tables.map(t => [t.name, t.row_count])) as { beans: number; brew_sessions: number };
  await driveStep('Recover empty collection', () => recoverEmptyBackup(prepared.files, counts, revision, signal));
  return { imported: true, message: `Recovered ${counts.beans} beans and ${counts.brew_sessions} brew sessions from the most recently uploaded backup (${latest.createdTime}).` };
}
