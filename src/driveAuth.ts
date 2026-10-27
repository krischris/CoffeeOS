import { DRIVE_SCOPE, DriveAuthError } from './drive';
import type { DriveAccount } from './drive';

/** The isolated database window never loads Google's script or relaxes its headers. */
export function authorizeDrive(clientId: string, signal: AbortSignal): Promise<DriveAccount> {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) return Promise.reject(new DriveAuthError('Google Drive is not configured correctly. Please contact the app owner.'));
  const channelId = crypto.randomUUID();
  const channel = new BroadcastChannel(`coffeeos-drive-${channelId}`);
  const helper = new URL('drive-auth.html', location.href);
  helper.hash = channelId; // A one-time channel name, never a credential.
  return new Promise((resolve, reject) => {
    let settled = false;
    const stop = (error?: Error, account?: DriveAccount) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); channel.postMessage({ type: 'cancel' }); channel.close();
      signal.removeEventListener('abort', cancel);
      if (account) resolve(account); else reject(error);
    };
    const cancel = () => stop(new DriveAuthError('Drive connection cancelled. Connect to try again.'));
    const timer = setTimeout(() => stop(new DriveAuthError('Google authorization timed out or the window was closed. Connect to try again.')), 180_000);
    signal.addEventListener('abort', cancel, { once: true });
    channel.onmessage = event => {
      if (settled || signal.aborted) return;
      const data = event.data;
      if (data?.type === 'ready') { channel.postMessage({ type: 'configure', clientId }); return; }
      if (data?.type === 'error') { stop(new DriveAuthError('Google authorization was denied, closed or unavailable. Connect to try again.')); return; }
      if (data?.type !== 'authorized') return;
      const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/) : [];
      if (typeof data.token !== 'string' || !data.token || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() ||
        !scopes.includes(DRIVE_SCOPE) || !scopes.includes('openid') || !scopes.some((s: string) => s === 'email' || s === 'https://www.googleapis.com/auth/userinfo.email')) {
        stop(new DriveAuthError('Google did not grant all required permissions. Reconnect and allow Drive file access and email.')); return;
      }
      // Consume a callback only once, before asynchronous identity verification.
      channel.onmessage = null;
      void fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${data.token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        credentials: 'omit', redirect: 'error',
      }).then(async response => {
        if (!response.ok) throw new Error();
        const identity = await response.json();
        if (typeof identity.sub !== 'string' || !identity.sub || typeof identity.email !== 'string' || identity.email_verified !== true) throw new Error();
        if (!settled) stop(undefined, { token: data.token, expiresAt: data.expiresAt, sub: identity.sub, email: identity.email });
      }).catch(() => stop(new DriveAuthError('The selected Google account could not be verified. Reconnect to try again.')));
    };
    if (signal.aborted) { cancel(); return; }
    // Synchronous open preserves the Connect click's user activation.
    // COOP severs Window references; BroadcastChannel survives that separation.
    try { window.open(helper.href, '_blank', 'popup,width=500,height=680,noopener'); }
    catch { stop(new DriveAuthError('The authorization window could not open. Allow popups and Connect again.')); }
  });
}
