import { CommittedWriteError, exportData, importData, ImportDataError } from '../db';
import type { DataFormat, DataTarget, ImportFile } from '../db';

export function createIOView(container: HTMLElement, onImported: () => Promise<void>): void {
  container.innerHTML = `
    <section class="card io-export" aria-labelledby="export-heading">
      <h2 id="export-heading">Export your coffee data</h2>
      <fieldset>
        <label for="export-layout">Backup layout</label>
        <select id="export-layout">
          <option value="tables">Full backup · two files</option>
          <option value="combined">Combined · one file</option>
        </select>
        <p class="field-hint">Full backups contain separate beans and brew_sessions files. Combined files include every bean, even those with no sessions.</p>
        <div class="io-actions">
          <button class="primary-button" type="button" data-format="parquet">Export Parquet</button>
          <button class="secondary-button" type="button" data-format="csv">Export CSV</button>
        </div>
      </fieldset>
      <p class="export-status form-message" role="status"></p>
      <p class="export-error form-error" role="alert" hidden></p>
      <div class="export-files" hidden>
        <h3>Your files are ready</h3>
        <p class="field-hint">Save each file, or use Share to save to Files or send a copy.</p>
        <div class="download-list"></div>
        <button class="secondary-button share-files" type="button" hidden>Share files</button>
      </div>
    </section>
    <form class="card io-import" aria-labelledby="import-heading">
      <h2 id="import-heading">Import a backup</h2>
      <p>Choose a combined file, or select either or both table files. CSV and Parquet files can be mixed.</p>
      <p class="field-hint" id="import-help">Matching IDs are updated; other records stay in your collection. Sessions need their beans, either already saved or included here. Keep the original column headers. In CSV, unquoted \\N means a missing value.</p>
      <fieldset aria-describedby="import-help">
        <label for="import-beans">Beans file</label>
        <input id="import-beans" name="beans" type="file" accept=".parquet,.csv">
        <label for="import-sessions">Brew sessions file</label>
        <input id="import-sessions" name="brew_sessions" type="file" accept=".parquet,.csv">
        <p class="io-or">Or restore one combined file</p>
        <label for="import-combined">Combined file</label>
        <input id="import-combined" name="combined" type="file" accept=".parquet,.csv">
        <button class="primary-button" type="submit">Import files</button>
      </fieldset>
      <p class="import-status form-message" role="status" aria-live="polite"></p>
      <p class="import-error form-error" role="alert" hidden></p>
    </form>`;
  const exportFieldset = container.querySelector<HTMLFieldSetElement>('.io-export fieldset')!;
  const importForm = container.querySelector<HTMLFormElement>('.io-import')!;
  const importFieldset = importForm.querySelector('fieldset')!;
  const layout = container.querySelector<HTMLSelectElement>('#export-layout')!;
  const exportStatus = container.querySelector<HTMLElement>('.export-status')!;
  const importStatus = container.querySelector<HTMLElement>('.import-status')!;
  const exportError = container.querySelector<HTMLElement>('.export-error')!;
  const importError = container.querySelector<HTMLElement>('.import-error')!;
  const ready = container.querySelector<HTMLElement>('.export-files')!;
  const downloads = container.querySelector<HTMLElement>('.download-list')!;
  const share = container.querySelector<HTMLButtonElement>('.share-files')!;
  const submit = importForm.querySelector<HTMLButtonElement>('button')!;
  let busy = false;
  let sharing = false;
  let files: File[] = [];
  let urls: string[] = [];

  function releaseURLs(): void {
    urls.forEach(url => URL.revokeObjectURL(url));
    urls = [];
  }
  function setBusy(value: boolean): void {
    busy = value;
    exportFieldset.disabled = value;
    importFieldset.disabled = value;
    share.disabled = value;
    container.setAttribute('aria-busy', String(value));
  }
  function showError(element: HTMLElement, message: string): void {
    element.textContent = message;
    element.hidden = false;
  }
  container.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button => {
    button.addEventListener('click', () => {
      if (!busy && !sharing) void prepareExport(button.dataset.format as DataFormat);
    });
  });
  async function prepareExport(format: DataFormat): Promise<void> {
    setBusy(true);
    exportError.hidden = true;
    exportStatus.textContent = 'Preparing your files…';
    try {
      const exported = await exportData(format, layout.value === 'combined');
      releaseURLs();
      downloads.replaceChildren();
      files = exported.map(file => new File([file.data], file.name, { type: file.type }));
      for (const file of files) {
        const url = URL.createObjectURL(file);
        urls.push(url);
        const link = document.createElement('a');
        link.className = 'secondary-button download-file';
        link.href = url;
        link.download = file.name;
        link.textContent = `Save ${file.name}`;
        downloads.append(link);
      }
      let canShare = false;
      try { canShare = typeof navigator.share === 'function' && navigator.canShare?.({ files }); } catch { /* Download remains available. */ }
      share.hidden = !canShare;
      ready.hidden = false;
      exportStatus.textContent = `Prepared ${files.length} ${files.length === 1 ? 'file' : 'files'}. Choose Save or Share below.`;
    } catch (failure) {
      console.error('Could not export coffee data.', failure);
      showError(exportError, 'Your files could not be prepared. Please try again.');
      exportStatus.textContent = '';
    } finally {
      setBusy(false);
    }
  }
  // This separate click retains the user activation required by the iOS share sheet.
  share.addEventListener('click', () => {
    if (busy || sharing) return;
    sharing = true;
    setBusy(true);
    exportError.hidden = true;
    void navigator.share({ files }).then(() => {
      exportStatus.textContent = 'Files shared.';
    }).catch((failure: unknown) => {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
        showError(exportError, 'Sharing is unavailable. Use the Save links to download your files.');
      }
    }).finally(() => {
      sharing = false;
      setBusy(false);
    });
  });
  importForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!busy && !sharing) void restore();
  });
  async function restore(): Promise<void> {
    const selected = [...importForm.querySelectorAll<HTMLInputElement>('input[type="file"]')]
      .flatMap(input => input.files?.[0] ? [{ target: input.name as DataTarget, file: input.files[0] }] : []);
    importError.hidden = true;
    importStatus.textContent = '';
    if (!selected.length || (selected.some(item => item.target === 'combined') && selected.length > 1)) {
      showError(importError, 'Choose a combined file, or choose one or both table files.');
      return;
    }
    setBusy(true);
    submit.textContent = 'Importing…';
    importStatus.textContent = 'Reading and merging your backup…';
    try {
      const uploads: ImportFile[] = await Promise.all(selected.map(async ({ target, file }) => ({
        target, name: file.name, data: new Uint8Array(await file.arrayBuffer()),
      })));
      const result = await importData(uploads);
      importForm.reset();
      importStatus.textContent = `Imported ${result.beans} ${result.beans === 1 ? 'bean' : 'beans'} and ${result.brew_sessions} brew ${result.brew_sessions === 1 ? 'session' : 'sessions'}. Matching IDs were merged.`;
    } catch (failure) {
      console.error('Could not import coffee data.', failure);
      if (failure instanceof CommittedWriteError) {
        importForm.reset();
        importStatus.textContent = '';
        showError(importError, failure.message);
        await onImported();
        return;
      }
      const detail = failure instanceof ImportDataError ? failure.message : 'Check the file format, column values, and available storage, then try again.';
      showError(importError, `Import failed. Your selected files are still here for retry. ${detail}`);
      importStatus.textContent = '';
      return;
    } finally {
      setBusy(false);
      submit.textContent = 'Import files';
    }
    await onImported();
  }
  // Blob URLs live until replaced or the page is discarded; keep them on bfcache restores.
  window.addEventListener('pagehide', event => { if (!event.persisted) releaseURLs(); });
  if (import.meta.hot) import.meta.hot.dispose(releaseURLs);
}
