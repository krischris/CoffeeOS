import { driveStep, driveResponse, driveFailure } from './driveDiagnostics';
import { backupLimits, packageBackup, prepareBackup, preservesLegacyPhotos, preservesLegacyText, sha256, unpackBackup } from './backups';
import { captureDriveSnapshot, hashBackupContents, recoverEmptyBackup } from './db';
import { driveBackupTrackingKey, readDriveBackupTracking, saveDriveBackupTracking } from './driveBackupTracking';
import type { TrackedDriveBackup } from './driveBackupTracking';

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

/** All requests are bounded and cancellation-aware; the view owns credential caching. */
export class DriveClient {
  constructor(private account: DriveAccount, private signal: AbortSignal, private transport: typeof fetch = fetch,
    private progress: (message: string) => void = () => undefined,
    private reauthorize?: () => Promise<DriveAccount>,
    private invalidateAccount: (account: DriveAccount) => void = () => undefined) {}
  private async renew(): Promise<void> {
    this.invalidateAccount(this.account);
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
          : init.method === 'PATCH' ? 'Remove older backup'
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
        this.invalidateAccount(this.account);
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
  private verify(file: RemoteFile, id: string, hash: string, size: number, contentHash?: string, contentVersion: 1 | 2 = 1, sessionId?: string): void {
    if (file.size !== String(size) || file.sha256Checksum?.toLowerCase() !== hash || file.appProperties?.backupId !== id ||
      file.appProperties?.archiveSha256 !== hash || file.appProperties?.coffeeosKind !== 'snapshot-v1' ||
      (contentHash !== undefined && file.appProperties?.[`contentSha256V${contentVersion}`] !== contentHash) ||
      (sessionId !== undefined && file.appProperties?.backupSessionId !== sessionId)) {
      throw new DriveError('Drive backup completion could not be verified. Keep your local backup; no second upload was attempted.');
    }
  }
  async upload(folder: string, data: Uint8Array, backupId: string, name: string, contentHash?: string, contentVersion: 1 | 2 = 1, sessionId?: string): Promise<RemoteFile> {
    const hash = await sha256(data);
    const metadata = { name: name.replace('.coffeeos', `-${backupId}.coffeeos`), parents: [folder], mimeType: 'application/zip',
      appProperties: { coffeeosKind: 'snapshot-v1', backupId, archiveSha256: hash,
        ...(sessionId ? { backupSessionId: sessionId } : {}),
        ...(contentHash ? { [`contentSha256V${contentVersion}`]: contentHash } : {}) } };
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
          this.verify(remote, backupId, hash, data.length, contentHash, contentVersion, sessionId);
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
        if (matches.length === 1) { this.verify(matches[0], backupId, hash, data.length, contentHash, contentVersion, sessionId); return matches[0]; }
      } catch { /* Preserve the unconfirmed outcome, including auth failures during lookup. */ }
      const message = 'Upload result is unconfirmed. No second upload was attempted. Keep a local backup and inspect CoffeeOS Backups in Drive before another Sync now.';
      if (error instanceof DriveAuthError) throw new DriveAuthError(`${message} Reconnect to authorize again.`);
      throw new DriveError(error instanceof DriveError ? `${message} ${error.message}` : message);
    }
  }
  async withBackupLock<T>(task: () => Promise<T>): Promise<T> {
    return navigator.locks.request(driveBackupTrackingKey(this.account.sub), { signal: this.signal }, task);
  }
  async uploadTracked(folder: string, data: Uint8Array, backupId: string, name: string, contentHash: string, contentVersion: 1 | 2): Promise<RemoteFile> {
    const tracking = readDriveBackupTracking(this.account.sub) ?? { version: 1, sessionId: crypto.randomUUID(), backups: [] };
    const entry = { backupId, archiveSha256: await sha256(data) };
    tracking.backups.push(entry);
    // Persist intent before sending bytes so lost responses/cancellation can be
    // reconciled after reload without adopting another phone's backups.
    saveDriveBackupTracking(this.account.sub, tracking);
    const remote = await this.upload(folder, data, backupId, name, contentHash, contentVersion, tracking.sessionId);
    // The pending identity already proves ownership if this save fails.
    tracking.backups[tracking.backups.length - 1] = { ...entry, fileId: remote.id };
    try { saveDriveBackupTracking(this.account.sub, tracking); }
    catch { /* Cleanup reconciles the durable pending identity before removing anything. */ }
    return remote;
  }
  async cleanupBackups(history: RemoteFile[]): Promise<void> {
    const tracking = readDriveBackupTracking(this.account.sub);
    if (!tracking) return;
    const matches = (file: RemoteFile, entry: TrackedDriveBackup) =>
      (!entry.fileId || file.id === entry.fileId) && file.appProperties?.coffeeosKind === 'snapshot-v1' &&
      file.appProperties.backupSessionId === tracking.sessionId && file.appProperties.backupId === entry.backupId &&
      file.appProperties.archiveSha256 === entry.archiveSha256 && file.sha256Checksum?.toLowerCase() === entry.archiveSha256 &&
      Boolean(file.size && /^\d+$/.test(file.size) && Number(file.size) > 0);
    const owned: RemoteFile[] = [];
    const before = JSON.stringify(tracking);
    tracking.backups = tracking.backups.filter(entry => {
      const found = history.filter(file => matches(file, entry));
      if (found.length === 1) { entry.fileId = found[0].id; owned.push(found[0]); }
      // Keep unresolved intents, but forget confirmed files no longer in history
      // (including a trash request whose successful response was lost).
      return !entry.fileId || history.some(file => file.id === entry.fileId);
    });
    if (JSON.stringify(tracking) !== before) saveDriveBackupTracking(this.account.sub, tracking);
    // Only complete, locally tracked files count toward the two retained copies.
    // Recheck each candidate's identity immediately before moving it to Trash.
    for (const file of this.order(owned).slice(2).reverse()) {
      this.signal.throwIfAborted();
      const entry = tracking.backups.find(entry => entry.fileId === file.id)!;
      const current = await (await this.request(`drive/v3/files/${file.id}?fields=${fields},trashed`)).json();
      if (current.id !== file.id || current.trashed || !matches(current, entry)) {
        throw new DriveError('An older backup changed during cleanup. Refresh history and sync again.');
      }
      const removed = await (await this.request(`drive/v3/files/${file.id}?fields=id,trashed`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
      })).json();
      if (removed.id !== file.id || removed.trashed !== true) throw new DriveError('Older backup removal could not be confirmed. Sync again to retry cleanup.');
      tracking.backups = tracking.backups.filter(entry => entry.fileId !== file.id);
      saveDriveBackupTracking(this.account.sub, tracking);
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

function formatBackupSize(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let size = bytes, unit = 0;
  while (size >= 1000 && unit < units.length - 1) { size /= 1000; unit++; }
  return `${size.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export async function syncDrive(client: DriveClient, signal: AbortSignal, onRecoveryCommit?: () => void): Promise<{ message: string; imported: boolean }> {
  return client.withBackupLock(() => syncDriveLocked(client, signal, onRecoveryCommit));
}

async function cleanupAfterSync(client: DriveClient, history: RemoteFile[]): Promise<string> {
  try { await driveStep('Clean up older backups', () => client.cleanupBackups(history)); return ''; }
  catch { return ' Backup cleanup is pending. Sync now again to retry; the latest backups are kept.'; }
}

async function syncDriveLocked(client: DriveClient, signal: AbortSignal, onRecoveryCommit?: () => void): Promise<{ message: string; imported: boolean }> {
  const { snapshot, revision } = await driveStep('Capture local snapshot', captureDriveSnapshot);
  signal.throwIfAborted();
  if (snapshot.counts.beans + snapshot.counts.brew_sessions > 0) {
    const hash = await driveStep('Fingerprint local snapshot', () => hashBackupContents(snapshot.data));
    const history = await driveStep('Read cloud history', () => client.history());
    const latest = history[0] ?? null;
    const contentVersion = snapshot.webpPhotos ? 2 : 1;
    let cloudHash = latest?.appProperties?.[`contentSha256V${contentVersion}`];
    let needsPreservingBackup = false;
    if (latest) {
      if (latest.sha256Checksum?.toLowerCase() !== latest.appProperties?.archiveSha256) {
        throw new DriveError('The latest Drive backup checksum does not match its metadata. Refresh history and keep the original file.');
      }
      // Earlier exporters could label damaged legacy photos as format 1. An equal
      // content hash alone must not keep pointing to an unreadable archive.
      if (snapshot.legacyPhotos || snapshot.legacyText) {
        const bytes = await driveStep('Download snapshot for comparison', () => client.download(latest));
        const { manifest } = await driveStep('Validate comparison snapshot', () => unpackBackup(bytes));
        if (manifest.backup_id !== latest.appProperties?.backupId) throw new DriveError('Drive backup identity does not match the archive. Keep the original file.');
        needsPreservingBackup = Boolean(snapshot.legacyText && !preservesLegacyText(manifest) || snapshot.legacyPhotos && !preservesLegacyPhotos(manifest));
        if (!needsPreservingBackup) await driveStep('Validate comparison snapshot', () => prepareBackup(bytes));
      }
      if (!needsPreservingBackup && (!cloudHash || !/^[a-f0-9]{64}$/.test(cloudHash))) {
        // Older snapshots lack the optional logical hash. Validate their existing
        // archive and compare records without rewriting or replacing the backup.
        const downloaded = await driveStep('Download snapshot for comparison', () => client.download(latest));
        const prepared = await driveStep('Validate comparison snapshot', () => prepareBackup(downloaded));
        if (prepared.manifest.backup_id !== latest.appProperties?.backupId) throw new DriveError('Drive backup identity does not match the archive. Comparison stopped; keep the original file.');
        cloudHash = await driveStep('Fingerprint cloud snapshot', () => hashBackupContents({
          beans: prepared.files.find(f => f.target === 'beans')!.data,
          brew_sessions: prepared.files.find(f => f.target === 'brew_sessions')!.data,
        }));
      }
    }
    signal.throwIfAborted();
    if (!needsPreservingBackup && hash === cloudHash) return { imported: false,
      message: `Already backed up. Your collection captured ${snapshot.exported_at} matches the most recently uploaded Drive backup (${latest!.createdTime}). No upload needed. Later edits wait for Sync now.${await cleanupAfterSync(client, history)}` };
    // Resolve any previous cleanup failure before allowing another new archive.
    await driveStep('Clean up older backups', () => client.cleanupBackups(history));
    const file = await driveStep('Package local snapshot', () => packageBackup(snapshot));
    const { manifest } = await driveStep('Validate packaged snapshot', () => unpackBackup(file.data));
    const folder = await driveStep('Discover backup folder', () => client.folder(true));
    signal.throwIfAborted();
    const uploaded = await driveStep('Upload snapshot', () => client.uploadTracked(folder!, file.data, manifest.backup_id, file.name, hash, contentVersion));
    const cleanup = await cleanupAfterSync(client, [...history.filter(file => file.id !== uploaded.id), uploaded]);
    return { imported: false, message: `Uploaded backup captured ${snapshot.exported_at}: ${snapshot.counts.beans} beans and ${snapshot.counts.brew_sessions} brew sessions (${formatBackupSize(file.data.length)}). Later edits wait for Sync now.${cleanup}` };
  }
  const latest = await driveStep('Read cloud history', () => client.latest());
  if (!latest) return { imported: false, message: 'No Drive backup yet. No empty backup was uploaded.' };
  const downloaded = await driveStep('Download snapshot', () => client.download(latest));
  const prepared = await driveStep('Validate downloaded snapshot', () => prepareBackup(downloaded));
  if (prepared.manifest.backup_id !== latest.appProperties?.backupId) throw new DriveError('The latest Drive backup identity does not match its archive. Recovery stopped; keep the original file.');
  const counts = Object.fromEntries(prepared.manifest.tables.map(t => [t.name, t.row_count])) as { beans: number; brew_sessions: number };
  await driveStep('Recover empty collection', () => recoverEmptyBackup(prepared.files, counts, revision, signal, onRecoveryCommit, preservesLegacyPhotos(prepared.manifest), preservesLegacyText(prepared.manifest)));
  return { imported: true, message: `Recovered ${counts.beans} beans and ${counts.brew_sessions} brew sessions from the most recently uploaded backup (${latest.createdTime}).` };
}
