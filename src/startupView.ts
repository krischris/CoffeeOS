/** Read-only diagnostics remain available when the database cannot finish opening. */
export function createStartupView(app: HTMLElement, phase: () => string): { ready: () => void; failed: (message: string, failure: unknown) => void } {
  const started = performance.now();
  // Keep the static app description and privacy link available until startup succeeds.
  app.insertAdjacentHTML('beforeend', `<div class="startup-status">
    <p class="startup-message" role="status">Loading your coffee data…</p>
    <p class="startup-phase"></p>
    <div class="startup-help" hidden>
      <p class="startup-guidance">Loading is taking longer than usual. You can copy the startup details or reload to try again.</p>
      <button type="button" class="startup-reload">Reload</button>
      <details><summary>Startup details</summary>
        <label for="startup-report">Copy these details when reporting a loading problem</label>
        <textarea id="startup-report" rows="10" readonly spellcheck="false"></textarea>
        <button type="button" class="startup-copy">Copy startup details</button>
      </details>
    </div>
  </div>`);
  app.setAttribute('aria-busy', 'true');
  const find = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
  const report = find<HTMLTextAreaElement>('#startup-report');
  let stopped = false;
  let failureName = '';
  function update(): void {
    find('.startup-phase').textContent = phase();
    const elapsed = Math.round((performance.now() - started) / 1000);
    if (elapsed >= 10) find('.startup-help').hidden = false;
    const base = new URL('.', location.href);
    const assets = performance.getEntriesByType('resource').filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
      .filter(entry => {
        const url = new URL(entry.name);
        return url.origin === base.origin && url.pathname.startsWith(base.pathname) && /(?:\.wasm|\.worker[^/]*\.js|coi-serviceworker\.js)$/.test(url.pathname);
      }).map(entry => `${new URL(entry.name).pathname.slice(base.pathname.length)}: ${Math.round(entry.duration)} ms`);
    report.value = `CoffeeOS startup details\nBrowser: ${navigator.userAgent}\nOrigin: ${location.origin}\nPath: ${location.pathname}\nOnline: ${navigator.onLine}\nSecure context: ${isSecureContext}\nIsolated: ${crossOriginIsolated}\nHome Screen: ${matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)}\nService worker controls page: ${Boolean(navigator.serviceWorker?.controller)}\nPhase: ${phase()}\nElapsed: ${elapsed}s\n${failureName ? `Failure type: ${failureName}\n` : ''}${assets.join('\n')}`;
  }
  const timer = setInterval(update, 500);
  const stop = () => { if (!stopped) { stopped = true; clearInterval(timer); } };
  find('.startup-reload').addEventListener('click', () => location.reload());
  find('.startup-copy').addEventListener('click', () => {
    update(); report.focus(); report.select();
    void navigator.clipboard?.writeText(report.value).catch(() => undefined);
  });
  window.addEventListener('pagehide', stop, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(stop);
  update();
  return {
    ready: stop,
    failed(message, failure) {
      stop(); failureName = failure instanceof Error ? failure.name : 'Unknown error';
      update(); app.setAttribute('aria-busy', 'false');
      const status = find('.startup-status'); status.setAttribute('role', 'alert');
      const text = find('.startup-message'); text.removeAttribute('role'); text.textContent = message;
      find('.startup-help').hidden = false;
      find('.startup-guidance').textContent = 'Your saved data has been kept. Reload to try again, or copy the startup details to report the problem.';
    },
  };
}
