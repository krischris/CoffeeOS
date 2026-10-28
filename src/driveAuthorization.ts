import type { DriveAccount } from './drive';

// Scope credentials to this app path, rather than other apps on a shared Pages origin.
export const driveAuthorizationKey = `coffeeos-drive-authorization:${new URL('.', location.href).pathname}`;
export interface SavedDriveAuthorization { account: DriveAccount; enabled: boolean }
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

/** Optional credential cache only. Never reads or changes collection storage. */
export function forgetDriveAuthorization(token?: string): void {
  try {
    const raw = localStorage.getItem(driveAuthorizationKey);
    let saved: { account?: { token?: string }; enabled?: boolean } | null = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch { /* Malformed credentials must still be removable. */ }
    if (token && raw && saved?.account?.token !== token) return;
    if (saved?.enabled === false) setDriveSwitchPending(true);
    localStorage.removeItem(driveAuthorizationKey);
  } catch { /* Blocked browser storage must not block local brewing or in-memory auth. */ }
  clearTimeout(expiryTimer);
}

function expire(account: DriveAccount): void {
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    if (Date.now() < account.expiresAt) expire(account);
    else forgetDriveAuthorization(account.token);
  }, Math.min(Math.max(0, account.expiresAt - Date.now()), 2_147_483_647));
}

export function readDriveAuthorization(clientId: string): SavedDriveAuthorization | null {
  try {
    const raw = localStorage.getItem(driveAuthorizationKey);
    if (!raw) return null;
    const saved = JSON.parse(raw), account = saved?.account;
    if (saved?.version === 1 && saved.clientId === clientId && saved.enabled === false) setDriveSwitchPending(true);
    if (saved?.version !== 1 || saved.clientId !== clientId || typeof saved.enabled !== 'boolean' ||
      !account || typeof account.token !== 'string' || !account.token ||
      !Number.isSafeInteger(account.expiresAt) || account.expiresAt <= Date.now() ||
      typeof account.sub !== 'string' || !account.sub || typeof account.email !== 'string' || !account.email) {
      forgetDriveAuthorization(); return null;
    }
    expire(account);
    return { account: { token: account.token, expiresAt: account.expiresAt, sub: account.sub, email: account.email }, enabled: saved.enabled };
  } catch { forgetDriveAuthorization(); return null; }
}

export function saveDriveAuthorization(clientId: string, account: DriveAccount, enabled: boolean): boolean {
  if (!enabled) setDriveSwitchPending(true);
  if (account.expiresAt <= Date.now()) { forgetDriveAuthorization(account.token); return false; }
  try {
    localStorage.setItem(driveAuthorizationKey, JSON.stringify({ version: 1, clientId, account, enabled }));
    expire(account); return true;
  } catch { return false; }
}

// Decision state survives credential expiry/revocation. It contains no account/token.
export const driveSwitchKey = driveAuthorizationKey.replace('authorization:', 'switch:');
export function setDriveSwitchPending(pending: boolean): boolean {
  let saved = false;
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      if (pending) { if (storage().getItem(driveSwitchKey) !== 'pending') storage().setItem(driveSwitchKey, 'pending'); }
      else storage().removeItem(driveSwitchKey);
      saved = true;
    } catch { /* Other storage and conservative read remain available. */ }
  }
  return saved;
}
export function readDriveSwitchPending(): boolean {
  let writable = false;
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      if (storage().getItem(driveSwitchKey) === 'pending') return true;
      // With neither store usable we cannot prove that a pending choice was absent.
      const probe = driveSwitchKey + ':probe';
      storage().setItem(probe, '1'); storage().removeItem(probe); writable = true;
    } catch { /* Require confirmation when no decision storage is usable. */ }
  }
  return !writable;
}
