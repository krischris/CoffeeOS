import { CommittedWriteError, importData, ImportDataError, listImportRecoveries, readImportRecovery } from '../db';
import type { DataTarget, ExportFile, ImportFile } from '../db';
import { backupLimits, confirmBackup, packageBackup, prepareBackup, saveBackup } from '../backups';
import type { PreparedBackup } from '../backups';
import { createDriveView } from './driveView';

export function createIOView(container: HTMLElement, onImported: () => Promise<void>): void {
  container.innerHTML = `
    <section class="card io-export" aria-labelledby="export-heading">
      <h2 id="export-heading">Save backup</h2>
      <p>Keep your beans, brew sessions and photos together in one CoffeeOS file.</p>
      <fieldset><button class="primary-button save-backup" type="button">Save backup</button></fieldset>
      <p class="export-status form-message" role="status" aria-live="polite"></p>
      <p class="export-error form-error" role="alert" hidden></p>
      <div class="export-files" hidden>
        <p class="field-hint">Download your backup, or Share to save to Files or send a copy.</p>
        <div class="download-list"></div>
        <button class="secondary-button share-files" type="button" hidden>Share backup</button>
      </div>
    </section>
    <form class="card io-import" aria-labelledby="import-heading">
      <h2 id="import-heading">Import backup</h2>
      <p class="field-hint" id="import-help">Adds new records and overwrites differing matching IDs, even from an older backup. Records absent from the backup stay in your collection. A recovery backup is kept before overwriting records.</p>
      <fieldset aria-describedby="import-help">
        <label for="import-backup">CoffeeOS backup</label>
        <input id="import-backup" name="backup" type="file" accept=".coffeeos,.zip,application/zip">
        <div class="backup-preview" hidden></div>
        <div class="io-actions">
          <button class="primary-button confirm-backup" type="submit">Review backup</button>
          <button class="secondary-button cancel-backup" type="button" hidden>Cancel</button>
        </div>
      </fieldset>
      <p class="import-status form-message" role="status" aria-live="polite">Choose a backup to preview it.</p>
      <p class="import-error form-error" role="alert" hidden></p>
    </form>
    <section class="card io-recovery" aria-labelledby="recovery-heading" hidden>
      <h2 id="recovery-heading">Recovery backups</h2>
      <p class="field-hint">Collections saved before imports overwrote or replaced records. Download a copy, then review it with Import backup to merge it back.</p>
      <fieldset class="recovery-list"></fieldset>
    </section>
    <details class="card io-legacy">
      <summary>Import an older backup</summary>
      <form class="legacy-import">
        <p>Choose one combined file, or either or both table files. CSV and Parquet can be mixed.</p>
        <p class="field-hint">Matching IDs are updated; other records stay. Sessions need their beans saved or included. In CSV, unquoted \\N means missing. Historical files without photos keep existing photos.</p>
        <fieldset>
          <label for="import-beans">Beans file</label><input id="import-beans" name="beans" type="file" accept=".parquet,.csv">
          <label for="import-sessions">Brew sessions file</label><input id="import-sessions" name="brew_sessions" type="file" accept=".parquet,.csv">
          <label for="import-combined">Or one combined file</label><input id="import-combined" name="combined" type="file" accept=".parquet,.csv">
          <button class="primary-button" type="submit">Import older files</button>
        </fieldset>
        <p class="legacy-status form-message" role="status" aria-live="polite"></p>
        <p class="legacy-error form-error" role="alert" hidden></p>
      </form>
    </details>`;
  const driveContainer = document.createElement('div');
  container.append(driveContainer);
  createDriveView(driveContainer, async () => { await onImported(); await recoveries(); });
  const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const form = find<HTMLFormElement>('.io-import');
  const input = find<HTMLInputElement>('#import-backup');
  const legacy = find<HTMLFormElement>('.legacy-import');
  const exportStatus = find('.export-status'), exportError = find('.export-error');
  const status = find('.import-status'), error = find('.import-error');
  const preview = find('.backup-preview');
  const confirm = find<HTMLButtonElement>('.confirm-backup'), cancel = find<HTMLButtonElement>('.cancel-backup');
  const share = find<HTMLButtonElement>('.share-files');
  let busy = false;
  let prepared: PreparedBackup | null = null;
  let uploaded: Uint8Array | null = null;
  let file: File | null = null;
  const urls = new Map<string, string>();
  function releaseURLs(): void { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); }
  function setBusy(value: boolean): void {
    busy = value;
    container.querySelectorAll('fieldset').forEach(fieldset => { fieldset.disabled = value; });
    share.disabled = value;
    container.setAttribute('aria-busy', String(value));
  }
  function showError(element: HTMLElement, message: string): void { element.textContent = message; element.hidden = false; }
  function detail(failure: unknown): string {
    return failure instanceof ImportDataError || failure instanceof CommittedWriteError ? failure.message
      : 'Check the backup and available storage, then try again. Keep the original file.';
  }
  function linkFor(exported: ExportFile, parent: HTMLElement, key: string, label: string): File {
    const next = new File([exported.data], exported.name, { type: exported.type });
    const url = URL.createObjectURL(next);
    const link = document.createElement('a');
    link.className = 'secondary-button download-file'; link.href = url; link.download = next.name; link.textContent = label;
    const previous = urls.get(key);
    parent.replaceChildren(link); urls.set(key, url);
    if (previous) URL.revokeObjectURL(previous);
    return next;
  }
  find('.save-backup').addEventListener('click', () => {
    if (busy) return;
    setBusy(true); exportError.hidden = true; exportStatus.textContent = 'Preparing backup…';
    void saveBackup().then(exported => {
      file = linkFor(exported, find('.download-list'), 'backup', 'Download backup');
      find('.export-files').hidden = false;
      let canShare = false;
      try { canShare = typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }); } catch { /* Download remains available. */ }
      share.hidden = !canShare;
      exportStatus.textContent = 'Backup ready. Choose Download or Share.';
    }).catch(failure => {
      showError(exportError, `Backup could not be prepared. ${detail(failure)}`);
      exportStatus.textContent = file ? 'Your earlier prepared backup is still available.' : '';
    }).finally(() => setBusy(false));
  });
  // A separate click preserves the user activation required by iOS sharing.
  share.addEventListener('click', () => {
    if (busy || !file) return;
    setBusy(true); exportError.hidden = true;
    void navigator.share({ files: [file] }).then(() => { exportStatus.textContent = 'Backup shared.'; }).catch(failure => {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) showError(exportError, 'Sharing is unavailable. Use Download backup.');
    }).finally(() => setBusy(false));
  });
  async function refreshImported(errorElement: HTMLElement): Promise<void> {
    try { await onImported(); }
    catch { showError(errorElement, 'Your import was applied, but the view could not be refreshed. Reload to view your collection; do not import again.'); }
  }
  function clearPreview(): void {
    prepared = null; preview.hidden = true; preview.replaceChildren();
    confirm.textContent = 'Review backup'; cancel.hidden = true;
  }
  function showPreview(): void {
    if (!prepared) return;
    preview.replaceChildren();
    const { manifest, preview: comparison } = prepared;
    const info = document.createElement('p');
    info.textContent = `${manifest.exported_at} · ${manifest.producer.name} ${manifest.producer.version}`;
    preview.append(info);
    for (const table of ['beans', 'brew_sessions'] as const) {
      const p = document.createElement('p'), c = comparison[table];
      p.textContent = `${manifest.tables.find(t => t.name === table)!.row_count} ${table === 'beans' ? 'beans' : 'brew sessions'}: ${c.new} new, ${c.updated} updated, ${c.unchanged} unchanged.`;
      preview.append(p);
    }
    preview.hidden = false; confirm.textContent = 'Import into collection'; cancel.hidden = false;
  }
  async function validate(): Promise<void> {
    clearPreview(); error.hidden = true;
    const selected = input.files?.[0];
    if (!selected) { showError(error, 'Choose a CoffeeOS backup first.'); return; }
    setBusy(true); status.textContent = 'Validating backup…';
    try {
      if (selected.size > backupLimits.archive) throw new ImportDataError('This backup size is unsupported. Keep the original and choose another backup.');
      uploaded ??= new Uint8Array(await selected.arrayBuffer());
      prepared = await prepareBackup(uploaded);
      showPreview(); status.textContent = 'Backup ready to import. Review the changes, then confirm.';
    } catch (failure) {
      showError(error, `Validation failed. Your selected file is still available for retry. ${detail(failure)}`);
      status.textContent = '';
    } finally { setBusy(false); }
  }
  input.addEventListener('change', () => { if (!busy) { uploaded = null; void validate(); } });
  cancel.addEventListener('click', () => {
    if (busy) return;
    clearPreview(); uploaded = null; form.reset(); error.hidden = true; status.textContent = 'Import cancelled. Your collection is unchanged.';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    if (!prepared) { void validate(); return; }
    setBusy(true); error.hidden = true; status.textContent = 'Importing backup…';
    void (async () => {
      try {
        const result = await confirmBackup(prepared!);
        if ('revision' in result) {
          prepared!.preview = result; showPreview();
          status.textContent = 'Your collection changed. Review the refreshed counts and confirm again.';
          return;
        }
        clearPreview(); uploaded = null; form.reset();
        status.textContent = `Imported ${result.beans} beans and ${result.brew_sessions} brew sessions. Matching IDs were merged; other records were kept.`;
        await refreshImported(error);
      } catch (failure) {
        if (failure instanceof CommittedWriteError) {
          clearPreview(); uploaded = null; form.reset(); status.textContent = '';
          showError(error, failure.message); await refreshImported(error);
        } else { showError(error, `Import failed. Your file is still available for retry. ${detail(failure)}`); status.textContent = ''; }
      } finally { await recoveries(); setBusy(false); }
    })();
  });
  async function recoveries(): Promise<void> {
    try {
      const copies = await listImportRecoveries();
      const list = find('.recovery-list');
      // Preserve prepared recovery downloads when refreshing the list.
      for (const copy of copies) {
        if ([...list.children].some(child => (child as HTMLElement).dataset.key === copy.key)) continue;
        const row = document.createElement('div'); row.dataset.key = copy.key;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
        button.textContent = `Prepare recovery backup · ${copy.created_at}`;
        const download = document.createElement('div'), message = document.createElement('p'); message.setAttribute('role', 'status');
        row.append(button, download, message); list.append(row);
        button.addEventListener('click', () => {
          if (busy) return;
          setBusy(true); message.textContent = 'Preparing recovery backup…';
          void readImportRecovery(copy.key).then(packageBackup).then(exported => {
            linkFor(exported, download, copy.key, `Download recovery backup · ${copy.created_at}`);
            message.textContent = 'Recovery backup ready.';
          }).catch(failure => { message.textContent = `Recovery backup could not be prepared. ${detail(failure)}`; })
            .finally(() => setBusy(false));
        });
      }
      find('.io-recovery').hidden = !copies.length;
    } catch { showError(error, 'Recovery backups could not be listed. Restore browser storage access and reload to try again.'); }
  }
  legacy.addEventListener('submit', event => {
    event.preventDefault(); if (busy) return;
    const legacyError = find('.legacy-error'), legacyStatus = find('.legacy-status');
    legacyError.hidden = true;
    const selected = [...legacy.querySelectorAll<HTMLInputElement>('input')].flatMap(input => input.files?.[0] ? [{ target: input.name as DataTarget, file: input.files[0] }] : []);
    if (!selected.length || (selected.some(item => item.target === 'combined') && selected.length > 1)) {
      showError(legacyError, 'Choose a combined file, or choose one or both table files.'); return;
    }
    setBusy(true); legacyStatus.textContent = 'Reading and merging older backup…';
    void (async () => {
      try {
        const uploads: ImportFile[] = await Promise.all(selected.map(async ({ target, file }) => ({ target, name: file.name, data: new Uint8Array(await file.arrayBuffer()) })));
        const result = await importData(uploads);
        legacy.reset(); legacyStatus.textContent = `Imported ${result.beans} ${result.beans === 1 ? 'bean' : 'beans'} and ${result.brew_sessions} brew ${result.brew_sessions === 1 ? 'session' : 'sessions'}.`;
        await refreshImported(legacyError);
      } catch (failure) {
        legacyStatus.textContent = '';
        if (failure instanceof CommittedWriteError) { legacy.reset(); showError(legacyError, failure.message); await refreshImported(legacyError); }
        else showError(legacyError, `Import failed. Your selected files are still here for retry. ${detail(failure)}`);
      } finally { setBusy(false); }
    })();
  });
  setBusy(false);
  void recoveries();
  window.addEventListener('pagehide', event => { if (!event.persisted) releaseURLs(); });
  if (import.meta.hot) import.meta.hot.dispose(releaseURLs);
}
