import { driveStep, driveFailure } from '../driveDiagnostics';
import { authorizeDrive, verifyDriveAccount } from '../driveAuth';
import { driveAuthorizationKey, driveSwitchKey, readDriveSwitchPending, setDriveSwitchPending, forgetDriveAuthorization, readDriveAuthorization, saveDriveAuthorization } from '../driveAuthorization';
import { DriveAuthError, DriveClient, DriveError, syncDrive } from '../drive';
import type { DriveAccount, RemoteFile } from '../drive';
import { CommittedWriteError, ImportDataError, DatabaseRuntimeError } from '../db';
import { confirmBackup, prepareBackup, replaceBackup } from '../backups';
import type { PreparedBackup } from '../backups';
import { googleDriveClientId } from '../driveConfig';
import { DriveBackupTrackingError } from '../driveBackupTracking';

export function createDriveView(container: HTMLElement, onImported: () => Promise<void>): void {
  container.innerHTML = `<section class="card io-drive" aria-labelledby="drive-heading">
    <h2 id="drive-heading">Google Drive backup</h2>
    <p>Connect to save your collection to Drive, or recover the most recently uploaded backup into an empty collection. Unchanged collections skip the upload. Sync now repeats this once.</p>
    <p class="field-hint">Keeps the latest two backups from this device for each Google account. Older tracked backups move to Drive Trash after a verified upload.</p>
    <p class="drive-account">Not connected</p>
    <div class="io-actions">
      <button class="secondary-button drive-connect" type="button">Connect Google Drive</button>
      <button class="primary-button drive-sync" type="button" disabled>Sync now</button>
      <button class="secondary-button drive-switch" type="button" disabled>Switch account</button>
      <button class="secondary-button drive-disconnect" type="button" disabled>Disconnect</button>
      <button class="secondary-button drive-cancel" type="button" hidden>Cancel transfer</button>
    </div>
    <p class="drive-status form-message" role="status" aria-live="polite"></p>
    <p class="drive-error form-error" role="alert" hidden></p>
    <div class="drive-history" hidden>
      <h3>Restore from Drive</h3>
      <p class="field-hint">Most recently uploaded does not necessarily mean latest edits. After an upload, the previous cloud backup stays selected when available.</p>
      <label for="drive-snapshot">Backup snapshot</label>
      <select id="drive-snapshot"></select>
      <div class="io-actions">
        <button class="secondary-button drive-refresh" type="button">Refresh history</button>
        <button class="primary-button drive-review" type="button">Review selected backup</button>
      </div>
      <div class="drive-preview" hidden></div>
      <div class="io-actions drive-confirm" hidden>
        <button class="primary-button drive-merge" type="button">Merge with local collection</button>
        <button class="secondary-button drive-replace" type="button">Replace local collection</button>
        <button class="secondary-button drive-dismiss" type="button">Cancel restore</button>
      </div>
    </div>
    <p class="drive-retention field-hint"></p>
    <p class="field-hint">Disconnect keeps local records and Drive files. Revoke Google access separately in your Google account. Brewing and file backups work offline. No background sync. Transfers pause for reconnect when authorization expires; keep this page open.</p>
  </section>`;
  const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const connect = find<HTMLButtonElement>('.drive-connect'), sync = find<HTMLButtonElement>('.drive-sync');
  const disconnect = find<HTMLButtonElement>('.drive-disconnect'), cancel = find<HTMLButtonElement>('.drive-cancel');
  const select = find<HTMLSelectElement>('#drive-snapshot');
  const status = find('.drive-status'), error = find('.drive-error');
  let account: DriveAccount | null = null;
  let verified = false, storageUnavailable = false;
  let operation: AbortController | null = null;
  let generation = 0, committing = false, switching = false, enabled = true;
  let history: RemoteFile[] = [], prepared: PreparedBackup | null = null, pinned: RemoteFile | null = null;
  let renew: ((account: DriveAccount) => void) | null = null;
  function remember(): void {
    storageUnavailable = Boolean(account && !saveDriveAuthorization(googleDriveClientId, account, enabled));
  }
  function restore(): void {
    const saved = readDriveAuthorization(googleDriveClientId);
    account = saved?.account ?? null; verified = false; storageUnavailable = false;
    switching = readDriveSwitchPending() || saved?.enabled === false;
    enabled = !switching && (saved?.enabled ?? true);
    if (saved) status.textContent = enabled ? 'Connection remembered. Choose Sync now to back up or recover your collection.' : 'Confirm enabling backup to the displayed account before any transfer.';
    render();
  }
  function clearPreview(): void {
    prepared = null; pinned = null; find('.drive-preview').hidden = true; find('.drive-confirm').hidden = true;
  }
  function render(): void {
    container.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = Boolean(operation); });
    connect.disabled = Boolean(operation) ? !renew : Boolean(account);
    connect.textContent = renew ? 'Reconnect to resume transfer' : 'Connect Google Drive';
    sync.disabled = Boolean(operation) || !account;
    sync.textContent = enabled ? 'Sync now' : 'Enable backup to this account';
    disconnect.disabled = committing || (!operation && !account);
    cancel.hidden = !operation || committing; cancel.disabled = committing;
    find<HTMLButtonElement>('.drive-switch').disabled = Boolean(operation) || !account;
    select.disabled = Boolean(operation);
    find<HTMLButtonElement>('.drive-review').disabled = Boolean(operation) || !select.value || !enabled;
    find<HTMLButtonElement>('.drive-refresh').disabled = Boolean(operation) || !account || !enabled;
    find('.drive-account').textContent = account ? `Connected: ${account.email}${enabled ? '' : ' · confirm enabling backup before any transfer'}` : 'Not connected';
    find('.drive-retention').textContent = account && storageUnavailable
      ? 'This connection lasts while the page stays open. Browser storage is unavailable; reconnect after reopening.'
      : 'Your connection is remembered on this device until Google’s token expires. Reopening does not start a sync. Disconnect removes the saved connection.';
    find('.drive-history').hidden = !account;
    container.setAttribute('aria-busy', String(Boolean(operation)));
  }
  function showHistory(preferred = select.value): void {
    select.replaceChildren();
    for (const [index, file] of history.entries()) {
      const option = document.createElement('option'); option.value = file.id;
      option.textContent = `${index === 0 ? 'Most recently uploaded · ' : ''}${file.createdTime} · ${file.size} bytes`;
      select.append(option);
    }
    if (history.some(f => f.id === preferred)) select.value = preferred;
  }
  function preview(): void {
    if (!prepared || !pinned) return;
    const box = find('.drive-preview'); box.replaceChildren();
    const intro = document.createElement('p');
    intro.textContent = `Selected snapshot ${pinned.id}, uploaded ${pinned.createdTime}; captured ${prepared.manifest.exported_at}.`;
    box.append(intro);
    if (prepared.manifest.format_version >= 2) {
      const note = document.createElement('p'); note.textContent = prepared.manifest.format_version === 4
        ? 'This backup supports WebP photos. Restore with a current CoffeeOS version. Any declared legacy fields and photo bytes are preserved exactly.'
        : prepared.manifest.format_version === 3 ? 'This backup preserves legacy whitespace-only names and IDs, and any damaged photo bytes. Restoring requires CoffeeOS backup format 3 support.' : 'This backup preserves damaged legacy photo bytes. Some photos may not display; restoring requires CoffeeOS backup format 2 support.'; box.append(note);
    }
    for (const table of ['beans', 'brew_sessions'] as const) {
      const c = prepared.preview[table], p = document.createElement('p');
      p.textContent = `${table === 'beans' ? 'Beans' : 'Brew sessions'}: cloud ${c.new + c.updated + c.unchanged}, local ${c.localOnly + c.updated + c.unchanged}; ${c.new} added, ${c.updated} overwritten, ${c.unchanged} unchanged. Merge keeps ${c.localOnly} local-only records; Replace removes them.`;
      box.append(p);
    }
    const warning = document.createElement('p');
    warning.textContent = 'Merge is recommended. Matching cloud IDs overwrite local edits, even if older. Replace adopts exactly this snapshot, including an empty snapshot. Choose an action to confirm.';
    box.append(warning); box.hidden = false; find('.drive-confirm').hidden = false;
  }
  async function run(task: (client: DriveClient, signal: AbortSignal) => Promise<void>, authorize = false): Promise<void> {
    if (operation) return;
    const controller = new AbortController(); operation = controller;
    const current = ++generation;
    error.hidden = true; render();
    try {
      if (authorize) {
        status.textContent = 'Continue in the Google authorization window…';
        const next = await driveStep('Authorize Google', () => authorizeDrive(googleDriveClientId, controller.signal));
        controller.signal.throwIfAborted(); account = next; verified = true; enabled = !switching; if (!enabled) setDriveSwitchPending(true); remember();
      }
      if (!account) return;
      if (!verified && Date.now() < account.expiresAt) {
        status.textContent = 'Checking the remembered Google connection…';
        const next = await driveStep('Authorize Google', () => verifyDriveAccount(account!, controller.signal));
        controller.signal.throwIfAborted(); account = next; verified = true; remember();
      }
      const client = new DriveClient(account, controller.signal, fetch, message => {
        if (current === generation) status.textContent = message;
      }, () => new Promise<DriveAccount>((resolve, reject) => {
        renew = resolve; status.textContent = 'Authorization expired. Reconnect with the same account to resume this operation.';
        controller.signal.addEventListener('abort', () => { renew = null; reject(controller.signal.reason); }, { once: true }); render();
      }), invalid => forgetDriveAuthorization(invalid.token));
      render(); await task(client, controller.signal);
    } catch (failure) {
      driveFailure('Drive operation', failure);
      if (current !== generation) return;
      if (failure instanceof DriveAuthError) { forgetDriveAuthorization(account?.token); account = null; verified = false; }
      status.textContent = '';
      error.textContent = failure instanceof DatabaseRuntimeError || failure instanceof DriveError || failure instanceof DriveBackupTrackingError || failure instanceof ImportDataError || failure instanceof CommittedWriteError
        ? failure.message : 'Drive operation could not finish. Your collection and earlier backups are kept. Check your connection and storage, then retry.';
      error.hidden = false;
      if (failure instanceof CommittedWriteError) { clearPreview(); await onImported().catch(() => undefined); }
    } finally {
      if (current === generation) { renew = null; operation = null; committing = false; render(); }
    }
  }
  async function synchronize(client: DriveClient, signal: AbortSignal): Promise<void> {
    clearPreview();
    history = await driveStep('Read cloud history', () => client.history()); const previous = history[0]?.id;
    showHistory(previous);
    const result = await syncDrive(client, signal, () => { committing = true; status.textContent = 'Applying recovered records. Keep this page open…'; render(); });
    status.textContent = result.message;
    if (result.imported) {
      await driveStep('Refresh app views', onImported);
      return; // Local outcome is final; a subsequent network failure must not hide it.
    }
    signal.throwIfAborted();
    history = await driveStep('Read cloud history', () => client.history()); signal.throwIfAborted(); showHistory(previous); status.textContent = result.message;
  }
  connect.addEventListener('click', () => {
    if (renew && operation) {
      const resolve = renew, controller = operation, expected = account?.sub;
      renew = null; render();
      void authorizeDrive(googleDriveClientId, controller.signal).then(next => {
        if (controller !== operation || controller.signal.aborted) return;
        if (next.sub !== expected) {
          renew = resolve; error.textContent = 'Choose the same account to resume, or cancel before switching accounts.'; error.hidden = false; render(); return;
        }
        account = next; verified = true; remember(); resolve(next); render();
      }).catch(() => {
        if (controller !== operation) return;
        renew = resolve; error.textContent = 'Authorization did not complete. Reconnect to resume or cancel.'; error.hidden = false; render();
      });
      return;
    }
    void run(async (client, signal) => {
      if (switching) { enabled = false; switching = false; status.textContent = 'Confirm enabling backup to the displayed account before sending your collection.'; return; }
      await synchronize(client, signal);
    }, true);
  });
  sync.addEventListener('click', () => { if (operation) return; enabled = true; switching = false; setDriveSwitchPending(false); if (account) remember(); void run(synchronize); });
  find('.drive-refresh').addEventListener('click', () => { void run(async (client, signal) => {
    clearPreview(); history = await driveStep('Read cloud history', () => client.history()); signal.throwIfAborted(); showHistory(); status.textContent = history.length ? 'History refreshed.' : 'No Drive backup yet.';
  }); });
  select.addEventListener('change', clearPreview);
  find('.drive-review').addEventListener('click', () => { void run(async (client, signal) => {
    clearPreview(); const selected = history.find(file => file.id === select.value); if (!selected) return;
    const downloaded = await driveStep('Download snapshot', () => client.download(selected));
    const validated = await driveStep('Validate downloaded snapshot', () => prepareBackup(downloaded)); signal.throwIfAborted();
    if (validated.manifest.backup_id !== selected.appProperties?.backupId) throw new DriveError('Drive backup identity does not match the archive.');
    pinned = selected; prepared = validated; preview(); status.textContent = 'Review this snapshot before confirming a restore.';
  }); });
  for (const mode of ['merge', 'replace'] as const) find(`.drive-${mode}`).addEventListener('click', () => {
    if (!prepared) return;
    void run(async () => {
      committing = true; render();
      const result = await driveStep(mode === 'merge' ? 'Merge snapshot' : 'Replace snapshot', () => mode === 'merge' ? confirmBackup(prepared!) : replaceBackup(prepared!));
      if ('revision' in result) { prepared!.preview = result; preview(); status.textContent = 'Your collection changed. Review the refreshed counts and confirm again.'; return; }
      clearPreview(); status.textContent = `${mode === 'merge' ? 'Merged' : 'Replaced with'} ${result.beans} beans and ${result.brew_sessions} brew sessions. No automatic upload was started.`;
      await driveStep('Refresh app views', onImported);
    });
  });
  find('.drive-dismiss').addEventListener('click', () => { clearPreview(); status.textContent = 'Restore cancelled. Your collection is unchanged.'; });
  function clear(): void {
    generation++; operation?.abort(); operation = null; renew = null; account = null; verified = false; storageUnavailable = false; history = []; clearPreview(); showHistory();
    render();
  }
  cancel.addEventListener('click', () => {
    if (committing) return;
    generation++; operation?.abort(); operation = null; renew = null; clearPreview(); render();
    status.textContent = 'Transfer cancelled. A file already accepted by Drive may still finish; refresh history before another upload.';
  });
  disconnect.addEventListener('click', () => {
    if (committing) return;
    forgetDriveAuthorization(); setDriveSwitchPending(false);
    clear(); switching = false; enabled = true; error.hidden = true;
    status.textContent = 'Disconnected. Local records and Drive files are kept. A transfer already accepted by Drive may still finish.';
  });
  find('.drive-switch').addEventListener('click', () => {
    if (operation) return;
    if (!setDriveSwitchPending(true)) {
      error.textContent = 'Account switch could not start because browser storage cannot retain the required confirmation. Restore storage access and try again. Your current connection is kept.';
      error.hidden = false; return;
    }
    forgetDriveAuthorization();
    clear(); error.hidden = true; switching = true; enabled = false; status.textContent = 'Connect the new Google account, then confirm enabling backup.';
  });
  const hidden = () => { if (!committing) clear(); };
  window.addEventListener('pagehide', hidden);
  const shown = (event: PageTransitionEvent) => { if (event.persisted && !committing) restore(); };
  window.addEventListener('pageshow', shown);
  const changed = (event: StorageEvent) => {
    if ((event.key === driveAuthorizationKey || event.key === driveSwitchKey || event.key === null) && event.storageArea === localStorage) {
      if (committing) { verified = false; return; }
      clear(); switching = readDriveSwitchPending(); status.textContent = 'The Drive connection changed in another window. Reconnect to continue.';
    }
  };
  window.addEventListener('storage', changed);
  if (import.meta.hot) import.meta.hot.dispose(() => {
    clear(); window.removeEventListener('pagehide', hidden); window.removeEventListener('pageshow', shown); window.removeEventListener('storage', changed);
  });
  restore();
}
