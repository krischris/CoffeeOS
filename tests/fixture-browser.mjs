import {firefoxAdapter} from './firefox-upgrade-adapter.mjs';

export async function fixtureBrowser() {
  let session;
  const endpoint = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4444';
  const firefoxRequest = process.env.TEST_FIREFOX ? await firefoxAdapter() : null;
  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    if (firefoxRequest) return firefoxRequest(path, body, method);
    const response = await fetch(endpoint + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const { value } = await response.json();
    if (!response.ok || typeof value?.error === 'string') throw new Error(JSON.stringify(value));
    return value;
  }
  const api = (path, body, method) => request(`/session/${session}${path}`, body, method);
  const sync = (script) => api('/execute/sync', { script, args: [] });
  const evaluate = (script) => api('/execute/async', {
    script: `const done = arguments[arguments.length - 1];
      (async () => {
        const getDB = async () => window.__testDB;
        const getBackups = async () => window.__testBackups;
        ${script}
      })().then(value => done({ value }), error => done({ error: String(error), stack: error.stack }));`,
    args: [],
  }).then((result) => {
    if (result.error) throw new Error(JSON.stringify(result));
    return result.value;
  });
  async function ready() {
    for (let i = 0; i < 100; i++) {
      const state = await sync(`return { ready: document.querySelector('#app')?.getAttribute('aria-busy') === 'false',
        startupError: document.querySelector('.startup-status[role="alert"]')?.textContent };`);
      if (state.startupError) throw new Error(state.startupError + JSON.stringify(await sync('return window.__startupErrors;')));
      if (state.ready) {
        await sync(`if (!window.__safariErrors) {
          window.__safariErrors = [];
          addEventListener('unhandledrejection', event => window.__safariErrors.push(String(event.reason)));
          addEventListener('error', event => window.__safariErrors.push(event.message));
        }`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Startup timed out: ' + JSON.stringify(await sync(`return {
      html: document.querySelector('#app')?.innerHTML, isolated: crossOriginIsolated,
      resources: performance.getEntriesByType('resource').map(resource => ({ url: resource.name, duration: resource.duration })),
    };`)));
  }
  async function waitFor(script) {
    for (let i = 0; i < 100; i++) {
      if (await sync(`return Boolean(${script});`)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${script}`);
  }
  async function openBeans() {
    await sync(`document.querySelector('#tab-bean-manager').click();`);
    await waitFor(`document.querySelector('.bean-list')?.getAttribute('aria-busy') === 'false'`);
  }
  return {request, api, sync, evaluate, ready, waitFor, openBeans,
    async open(base) {
      session = (await request('/session', {capabilities:{alwaysMatch:{browserName:'safari'}}})).sessionId;
      await api('/timeouts', {script:120_000, pageLoad:45_000});
      await api('/url', {url:base}); await ready();
    },
    async close() {if (session) {await api('', undefined, 'DELETE'); session = undefined;}}
  };
}
