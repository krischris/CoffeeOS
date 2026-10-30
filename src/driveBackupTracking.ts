export interface TrackedDriveBackup {
  backupId: string;
  archiveSha256: string;
  fileId?: string;
}
export interface DriveBackupTracking {
  version: 1;
  sessionId: string;
  backups: TrackedDriveBackup[];
}

// Independent of credentials: reconnecting/switching back must retain ownership.
export const driveBackupTrackingKey = (accountId: string) =>
  `coffeeos-drive-backups:${new URL('.', location.href).pathname}:${encodeURIComponent(accountId)}`;

export class DriveBackupTrackingError extends Error {
  constructor() {
    super('Backup tracking could not be saved or read on this device. Restore browser storage access before syncing again. Existing backups and local records are kept.');
  }
}

export function readDriveBackupTracking(accountId: string): DriveBackupTracking | null {
  try {
    const raw = localStorage.getItem(driveBackupTrackingKey(accountId));
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (value?.version !== 1 || typeof value.sessionId !== 'string' || !/^[\w-]+$/.test(value.sessionId) ||
      !Array.isArray(value.backups) || value.backups.some((entry: TrackedDriveBackup) => !entry ||
        typeof entry.backupId !== 'string' || !entry.backupId ||
        typeof entry.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.archiveSha256) ||
        (entry.fileId !== undefined && (typeof entry.fileId !== 'string' || !/^[\w-]+$/.test(entry.fileId)))) ||
      new Set(value.backups.map((entry: TrackedDriveBackup) => entry.backupId)).size !== value.backups.length) {
      throw new DriveBackupTrackingError();
    }
    return value;
  } catch { throw new DriveBackupTrackingError(); }
}

export function saveDriveBackupTracking(accountId: string, tracking: DriveBackupTracking): void {
  try {
    const key = driveBackupTrackingKey(accountId), raw = JSON.stringify(tracking);
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) throw new DriveBackupTrackingError();
  } catch { throw new DriveBackupTrackingError(); }
}
