import assert from 'node:assert/strict';
import { checkIO } from './io-checks.mjs';
import { checkBrewingChart } from './brewing-chart-checks.mjs';
import { checkBrewEditor } from './brew-editor-checks.mjs';
// Start safaridriver and Vite first; Safari uses an isolated automation session.
const endpoint = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4444';
const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173/';
let session;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(endpoint + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
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
      const getDB = () => import(performance.getEntriesByType('resource').find(r =>
        new URL(r.name).pathname === '/src/db.ts')?.name ?? '/src/db.ts');
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
      error: document.querySelector('.startup-status[role="alert"]')?.textContent };`);
    if (state.error) throw new Error(state.error);
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
async function openBrews() {
  await sync(`document.querySelector('#tab-brew-controller').click();`);
  await waitFor(`document.querySelector('.session-list')?.getAttribute('aria-busy') === 'false'`);
}
async function openSession() {
  await openBrews();
  await sync(`document.querySelector('.new-session').click();`);
  await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy') === 'false'`);
}
async function fillSession(values) {
  await sync(`const form = document.querySelector('.session-form');
    for (const [key, value] of Object.entries(${JSON.stringify(values)})) {
      form.elements[key].value = value;
      form.elements[key].dispatchEvent(new Event('input', { bubbles: true }));
    }`);
}
async function saveSession() {
  await sync(`const form = document.querySelector('.session-form'); form.requestSubmit(); form.requestSubmit();`);
  await waitFor(`!document.querySelector('.session-form fieldset').disabled`);
  await waitFor(`document.querySelector('.session-list').getAttribute('aria-busy') === 'false' && document.querySelector('.bean-list').getAttribute('aria-busy') === 'false'`);
}
const brewCards = async () => {
  await openBeans(); await openBrews();
  await waitFor(`document.querySelector('.session-form').hidden || document.querySelector('.session-form').getAttribute('aria-busy') === 'false'`);
  return sync(`return [...document.querySelectorAll('.session-card')].map(card => ({
  id: card.dataset.sessionId, name: card.querySelector('.session-name').textContent,
  date: card.querySelector('time').dateTime,
  metrics: Object.fromEntries([...document.querySelectorAll('.bean-session[data-session-id="' + card.dataset.sessionId + '"] .session-metrics > div')].filter(field => field.querySelector('dt').textContent !== 'Comment').map(field =>
    [field.querySelector('dt').textContent, field.querySelector('dd').textContent])),
  comment: [...document.querySelectorAll('.bean-session[data-session-id="' + card.dataset.sessionId + '"] .session-metrics > div')].find(field => field.querySelector('dt').textContent === 'Comment')?.querySelector('dd').textContent.replace(/^—$/, '') || null,
}));`);
};
async function submitBean(name, roast = '', freeze = '') {
  await sync(`
    const form = document.querySelector('.bean-form');
    for (const [key, value] of Object.entries(${JSON.stringify({ name, roast_date: roast, freeze_date: freeze })})) {
      form.elements[key].value = value;
      form.elements[key].dispatchEvent(new Event('input', { bubbles: true }));
    }
    form.requestSubmit();
    form.requestSubmit(); // A repeated submission while saving must not insert twice.
  `);
  await waitFor(`!document.querySelector('.bean-form fieldset').disabled`);
}
const beanCards = () => sync(`return [...document.querySelectorAll('.bean-card')].map(card => ({
  id: card.dataset.beanId, name: card.querySelector('h3').textContent,
  dates: [...card.querySelectorAll('.bean-dates time')].map(time => time.dateTime),
  empty: card.querySelector('.bean-empty')?.textContent,
  sessions: [...card.querySelectorAll('.bean-session')].map(session => ({
    id: session.dataset.sessionId, date: session.querySelector('time').dateTime,
    metrics: Object.fromEntries([...session.querySelectorAll('.session-metrics > div')].map(field =>
      [field.querySelector('dt').textContent, field.querySelector('dd').textContent])),
  })),
}));`);
try {
  const created = await request('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  session = created.sessionId;
  console.log('Safari:', created.capabilities.browserVersion, created.capabilities.platformName);
  await api('/timeouts', { script: 45_000, pageLoad: 45_000 });
  await api('/url', { url: base });
  await ready();
  const initial = await sync(`return {
    isolated: crossOriginIsolated, opfs: typeof navigator.storage?.getDirectory === 'function',
    active: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(),
    forms: document.querySelectorAll('form').length,
    agent: navigator.userAgent,
  };`);
  assert.equal(initial.isolated, true);
  assert.equal(initial.active, 'Brew Controller');
  assert.equal(initial.forms, 3);
  console.log('PASS Safari boot and isolation', initial);
  assert.deepEqual(await sync(`return [...document.querySelectorAll('[role="tab"]')].map(tab => {
    tab.click(); return { selected: tab.getAttribute('aria-selected'), visible: !document.getElementById(tab.getAttribute('aria-controls')).hidden };
  });`), Array.from({length: 3}, () => ({ selected: 'true', visible: true })));
  console.log('PASS tab navigation');
  await openSession();
  const noBeans = await sync(`return !document.querySelector('.no-beans').hidden;`);
  if (noBeans) {
    assert.equal(await sync(`return document.querySelector('.session-form fieldset').disabled;`), true);
    await sync(`document.querySelector('.no-beans button').click();`);
    assert.equal(await sync(`return document.activeElement.id;`), 'bean-name');
    console.log('PASS no-beans prompt and Bean Manager navigation');
  } else await sync(`document.querySelector('.cancel-session').click();`);
  await openBeans();
  const before = await beanCards();
  if (!before.length) assert.match(await sync(`return document.querySelector('.bean-list').textContent;`), /No beans yet/);
  await submitBean('   ');
  assert.equal((await beanCards()).length, before.length);
  assert.equal(await sync(`return document.querySelector('#bean-name').validity.customError;`), true);
  const nameOnly = `Safari name only ${Date.now()}`;
  await submitBean(nameOnly);
  let cards = await beanCards();
  assert.equal(cards.length, before.length + 1);
  assert.equal(cards[0].name, nameOnly);
  assert.deepEqual(cards[0].dates, []);
  assert.equal(cards[0].empty, 'No brew sessions yet');
  assert.deepEqual(await sync(`return [...document.querySelectorAll('.bean-form input')].map(input => input.value);`), ['', '', '', '']);
  const datedName = `Safari's <img src=x onerror=alert(1)> ☕ ${Date.now()}`;
  await submitBean(`  ${datedName}  `, '2026-10-01', '2026-10-20');
  cards = await beanCards();
  assert.equal(cards.length, before.length + 2);
  assert.equal(cards[0].name, datedName);
  assert.deepEqual(cards[0].dates, ['2026-10-01', '2026-10-20']);
  assert.equal(await sync(`return document.querySelectorAll('.bean-card img').length;`), 0);
  await api('/refresh', {});
  await ready();
  await openBeans();
  assert.deepEqual(await beanCards(), cards);
  console.log('PASS Bean Manager name validation, name-only/dated saves, reset, duplicate-submit guard, safe text, empty histories, and reload persistence');

  await api('/window/rect', { width: 390, height: 844 });
  const layout = await sync(`return {
    width: innerWidth,
    overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('.app-content').scrollWidth > document.querySelector('.app-content').clientWidth,
    fields: [...document.querySelectorAll('.bean-form input')].map(input => ({
      font: getComputedStyle(input).fontSize, height: input.getBoundingClientRect().height,
    })),
    buttonHeight: document.querySelector('.bean-form button[type=submit]').getBoundingClientRect().height,
  };`);
  assert.equal(layout.overflow, false);
  assert.ok(layout.fields.every(field => field.font === '16px' && field.height >= 44));
  assert.ok(layout.buttonHeight >= 44);
  console.log('PASS Safari narrow-window layout and iOS input/touch sizing', layout);

  await openSession();
  assert.deepEqual(await sync(`return [...document.querySelectorAll('.spec-table')].map(table => ({
    caption: table.caption.textContent, headings: [...table.tHead.rows[0].cells].map(cell => cell.textContent),
    rows: table.tBodies[0].rows.length,
  }));`), [
    { caption: 'Input', headings: ['Field', 'Value'], rows: 5 },
    { caption: 'Output', headings: ['Field', 'Value'], rows: 3 },
  ]);
  assert.equal(await sync(`return getComputedStyle(document.querySelector('.tab-bar')).display;`), 'none');
  assert.equal(await sync(`return getComputedStyle(document.querySelector('#brew-controller > h1')).display;`), 'none');
  const formLayout = await sync(`return {
    overflow: document.querySelector('.app-content').scrollWidth > document.querySelector('.app-content').clientWidth,
    fields: [...document.querySelectorAll('.session-form input, .session-form select')].filter(field => field.getBoundingClientRect().height > 0).map(field => ({
      font: getComputedStyle(field).fontSize, height: field.getBoundingClientRect().height,
    })),
    buttons: [...document.querySelectorAll('.save-session, .cancel-session')].map(button => button.getBoundingClientRect().height),
  };`);
  assert.equal(formLayout.overflow, false);
  assert.ok(formLayout.fields.every(field => field.font === '16px' && field.height >= 44), JSON.stringify(formLayout));
  assert.ok(formLayout.buttons.every(height => height >= 44));
  await sync(`document.querySelector('.session-form').requestSubmit();`);
  assert.equal(await sync(`return document.querySelector('#session-bean').validity.valueMissing;`), true);
  assert.equal(await sync(`return document.querySelector('.session-form').hidden;`), false);
  const extractionOutput = () => sync(`return document.querySelector('#session-extraction').value;`);
  assert.equal(await extractionOutput(), '—');
  await checkBrewingChart({ sync, fillSession });
  await fillSession({ dose_g: '15', yield_g: '210', tds_pct: '1.4' });
  assert.equal(await extractionOutput(), '19.60%');
  for (const field of ['dose_g', 'yield_g', 'tds_pct']) {
    const positive = { dose_g: '15', yield_g: '210', tds_pct: '1.4' };
    for (const value of ['', '0', '-1']) {
      await fillSession({ [field]: value });
      assert.equal(await extractionOutput(), '—');
    }
    await fillSession({ [field]: positive[field] });
    assert.equal(await extractionOutput(), '19.60%');
  }
  await fillSession({ dose_g: '18', yield_g: '250', tds_pct: '1.43' });
  assert.equal(await extractionOutput(), '19.86%');
  await fillSession({ bean_id: cards[0].id });
  await openBeans();
  const draftBeanName = `Added while drafting ${Date.now()}`;
  await submitBean(draftBeanName);
  await openBrews();
  await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy') === 'false'`);
  assert.equal(await sync(`return document.querySelector('#session-bean').value;`), cards[0].id);
  assert.ok(await sync(`return [...document.querySelector('#session-bean').options].some(option => option.text === ${JSON.stringify(draftBeanName)});`));
  assert.equal(await extractionOutput(), '19.86%');
  await sync(`document.querySelector('.cancel-session').click();`);
  assert.equal(await sync(`return document.activeElement.classList.contains('new-session');`), true);
  assert.notEqual(await sync(`return getComputedStyle(document.querySelector('.tab-bar')).display;`), 'none');
  assert.notEqual(await sync(`return getComputedStyle(document.querySelector('#brew-controller > h1')).display;`), 'none');
  await openSession();
  assert.equal(await extractionOutput(), '—');
  assert.equal(await sync(`return document.querySelector('.session-form .brewing-chart-result').hasAttribute('hidden');`), true);
  assert.deepEqual(await sync(`return [...document.querySelectorAll('.session-form input, .session-form select')].filter(field => field.getBoundingClientRect().height > 0).map(field => field.value);`), Array(9).fill(''));
  const beforeBrews = await brewCards();
  const comment = "Tasting <img src=x onerror=alert(1)> & coffee's notes";
  const fields = { bean_id: cards[0].id, dose_g: '18', water_g: '300', time_str: '02:30',
    temp_c: '94', grind_um: '700', comment, yield_g: '250', tds_pct: '1.43' };
  await fillSession(fields);
  await checkBrewEditor({ sync, api });
  await saveSession();
  assert.equal(await sync(`return document.querySelector('.session-form').hidden;`), true);
  let brews = await brewCards();
  assert.equal(brews.length, beforeBrews.length + 1);
  assert.equal(brews[0].name, cards[0].name);
  assert.equal(brews[0].comment, comment);
  assert.deepEqual(brews[0].metrics, {
    'Dose (g)': '18', 'Water (g)': '300', 'Time': '02:30', 'Temp (°C)': '94',
    'Grind (µm)': '700', 'Yield (g)': '250', 'TDS (%)': '1.43', 'Extraction (%)': '19.86',
  });
  assert.equal(await sync(`return document.querySelectorAll('.session-card img').length;`), 0);
  await api('/window/rect', { width: 393, height: 852 });
  assert.equal(await sync(`return document.querySelector('.session-summary .session-ey').textContent;`), 'EY 19.86%');
  await sync(`document.querySelector('.session-summary').click();`);
  await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy') === 'false'`);
  assert.equal(await sync(`return document.querySelector('.session-form h2').textContent;`), 'Edit Session');
  assert.match(await sync(`return document.querySelector('.session-form figcaption').textContent;`), /19.86% extraction · 1.43% TDS/);
  await checkBrewEditor({ sync, api });
  await sync(`document.querySelector('.cancel-session').click();`);
  assert.equal(await sync(`return document.querySelector('.session-form').hidden;`), true);
  console.log('PASS session tap opens populated editor, saved chart, fixed actions and cancel');
  // Inspect the hidden Bean Manager before visiting it: saving must refresh both views immediately.
  let beanHistory = (await beanCards()).find(card => card.id === cards[0].id);
  assert.equal(beanHistory.sessions[0].id, brews[0].id);
  assert.equal(beanHistory.sessions[0].metrics.Comment, comment);
  if (!process.env.TEST_PRODUCTION) {
    const stored = await evaluate(`return (await (await getDB()).getBrewSessions(${JSON.stringify(cards[0].id)}))[0];`);
    assert.equal(stored.extraction_pct, 250 * 1.43 / 18);
  }
  await openSession();
  await fillSession({ bean_id: cards[1].id, dose_g: '0' });
  await saveSession();
  brews = await brewCards();
  assert.equal(brews.length, beforeBrews.length + 2);
  assert.equal(brews[0].name, cards[1].name);
  assert.equal(brews[0].metrics['Dose (g)'], '0');
  for (const [label, value] of Object.entries(brews[0].metrics)) if (label !== 'Dose (g)') assert.equal(value, '—');
  assert.equal(brews[0].comment, null);
  assert.deepEqual(brews.map(brew => brew.date), brews.map(brew => brew.date).sort().reverse());
  beanHistory = (await beanCards()).find(card => card.id === cards[1].id);
  assert.equal(beanHistory.sessions[0].id, brews[0].id);
  await api('/refresh', {});
  await ready();
  await waitFor(`document.querySelector('.session-list').getAttribute('aria-busy') === 'false'`);
  assert.equal(await sync(`return document.querySelector('[role="tab"][aria-selected="true"]').id;`), 'tab-brew-controller');
  assert.deepEqual(await brewCards(), brews);
  await openBeans();
  assert.equal((await beanCards()).find(card => card.id === cards[1].id).sessions[0].id, brews[0].id);
  console.log('PASS Brew Controller tables, bean requirement, optional metrics, live extraction/rounding, cancel/reset, safe text, duplicate-submit guard, immediate feed/history refresh, chronology, narrow layout, and reload persistence');
  if (!process.env.TEST_PRODUCTION) {
    const seed = await evaluate(`
      const db = await getDB();
      await Promise.all([db.initDB(), db.initDB()]);
      const bean = await db.addBean({ name: "Safari's coffee ☕", roast_date: '2026-10-01' });
      const brew = await db.addBrewSession({ bean_id: bean.id, dose_g: 15, water_g: 250,
        time_str: '02:30', temp_c: 94, grind_um: 700, comment: null, yield_g: 210,
        tds_pct: 1.4, extraction_pct: 19.6 });
      return { bean, brew, sessions: await db.getBrewSessions(bean.id), errors: window.__safariErrors };
    `);
    assert.equal(seed.bean.roast_date, '2026-10-01');
    assert.equal(seed.bean.freeze_date, null);
    assert.equal(seed.sessions[0].bean_name, seed.bean.name);
    assert.equal(seed.sessions[0].extraction_pct, 19.6);
    assert.deepEqual(seed.errors, []);
    await api('/refresh', {});
    await ready();
    const restored = await evaluate(`const db = await getDB(); return {
      beans: await db.getBeans(), sessions: await db.getBrewSessions(${JSON.stringify(seed.bean.id)})
    };`);
    assert.ok(restored.beans.some(bean => bean.id === seed.bean.id));
    assert.deepEqual(restored.sessions, seed.sessions);
    console.log('PASS Safari bean/brew writes, joins, dates/nulls, and reload persistence');
    await openBeans();
    const history = (await beanCards()).find(card => card.id === seed.bean.id);
    assert.equal(history.sessions.length, 1);
    assert.equal(history.sessions[0].id, seed.brew.id);
    assert.deepEqual(history.sessions[0].metrics, {
      'Dose (g)': '15', 'Water (g)': '250', 'Grind (µm)': '700', 'Temp (°C)': '94',
      Time: '02:30', 'Yield (g)': '210', 'TDS (%)': '1.4', 'Extraction (%)': '19.60', Comment: '—',
    });
    const sparse = await evaluate(`
      const db = await getDB();
      const sparse = await db.addBrewSession({ bean_id: ${JSON.stringify(seed.bean.id)}, dose_g: 0,
        water_g: null, time_str: null, temp_c: null, grind_um: null,
        comment: '<script>never execute</script>\\nSecond line', yield_g: null, tds_pct: null, extraction_pct: null });
      const other = await db.addBrewSession({ bean_id: ${JSON.stringify(cards[0].id)}, dose_g: null,
        water_g: null, time_str: null, temp_c: null, grind_um: null, comment: null,
        yield_g: null, tds_pct: null, extraction_pct: null });
      return { sparse, other };
    `);
    await sync(`document.querySelector('#tab-brew-controller').click();`);
    await openBeans();
    const refreshed = await beanCards();
    const updated = refreshed.find(card => card.id === seed.bean.id);
    assert.deepEqual(updated.sessions.map(session => session.id), [sparse.sparse.id, seed.brew.id]);
    assert.equal(updated.sessions[0].date, sparse.sparse.brewed_at);
    assert.equal(updated.sessions[0].metrics['Dose (g)'], '0');
    assert.equal(updated.sessions[0].metrics['Water (g)'], '—');
    assert.equal(updated.sessions[0].metrics.Comment, sparse.sparse.comment);
    assert.deepEqual(refreshed.find(card => card.id === cards[0].id).sessions.map(session => session.id), [sparse.other.id, brews[1].id]);
    assert.equal(await sync(`return document.querySelectorAll('.bean-session script').length;`), 0);
    assert.equal(await sync(`return document.querySelector('.app-content').scrollWidth > document.querySelector('.app-content').clientWidth;`), false);
    await api('/refresh', {});
    await ready();
    await openBeans();
    assert.deepEqual(await beanCards(), refreshed);
    assert.deepEqual(await sync(`return window.__safariErrors;`), []);
    console.log('PASS all brew summary fields, date order, bean filtering, zero/null metrics, safe multiline comments, tab refresh, and history persistence');
    const firstHandle = await api('/window');
    const second = await api('/window/new', { type: 'tab' });
    await api('/window', { handle: second.handle });
    await api('/url', { url: base });
    await waitFor(`document.querySelector('.startup-status[role="alert"]')`);
    assert.match(await sync(`return document.querySelector('.startup-status').textContent;`), /already open/);
    await api('/window', { handle: firstHandle });
    const primaryMode = await evaluate(`const db = await getDB(); const mode = db.getStorageMode(); await db.closeDB(); return mode;`);
    await api('/window', { handle: second.handle });
    await evaluate(`
      const db = await getDB();
      const original = navigator.storage.getDirectory;
      Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: undefined });
      try {
        let error;
        try { await db.initDB(); } catch (failure) { error = String(failure); }
        if (${JSON.stringify(primaryMode)} === 'opfs' && !error?.includes('needs OPFS')) throw new Error('Existing OPFS must not silently switch to empty fallback: ' + error);
        await db.closeDB();
        // Deliberately start a separate fallback fixture after verifying the guard.
        const store = await new Promise((resolve, reject) => {
          const request = indexedDB.open('coffeos-snapshots', 1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = store.transaction('snapshots', 'readwrite');
          tx.objectStore('snapshots').delete('backend-v1');
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
        store.close();
        await db.initDB();
        await db.addBean({ name: 'Fallback survives OPFS becoming available again' });
      } finally { Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: original }); }
    `);
    await api('/refresh', {});
    await ready();
    assert.equal(await evaluate(`return (await getDB()).getStorageMode();`), 'indexeddb');
    assert.equal(await evaluate(`return (await (await getDB()).getBeans())[0].name;`), 'Fallback survives OPFS becoming available again');
    console.log('PASS second-tab exclusion, lock release, OPFS capability-loss guard, and sticky IndexedDB fallback');
    const fallbackBean = await evaluate(`return await (await getDB()).addBean({ name: 'Safari fallback' });`);
    await openBeans();
    const beforeFailure = await beanCards();
    await sync(`
      window.__originalSnapshotPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota failure', 'QuotaExceededError'); };
    `);
    try {
      await submitBean('Retry after storage failure', '2026-10-01');
      assert.equal(await sync(`return document.querySelector('.bean-form .form-error').hidden;`), false);
      assert.deepEqual(await sync(`return [...document.querySelectorAll('.bean-form input')].map(input => input.value);`), ['Retry after storage failure', '2026-10-01', '', '']);
      assert.deepEqual(await beanCards(), beforeFailure);
    } finally {
      await sync(`IDBObjectStore.prototype.put = window.__originalSnapshotPut; delete window.__originalSnapshotPut;`);
    }
    await submitBean('Retry after storage failure', '2026-10-01');
    assert.equal((await beanCards()).length, beforeFailure.length + 1);
    assert.equal(await sync(`return document.querySelector('.bean-form .form-error').hidden;`), true);
    console.log('PASS failed save preserves form and list; retry adds exactly one bean');
    await openSession();
    await fillSession({ bean_id: fallbackBean.id, dose_g: '15', yield_g: '210', tds_pct: '1.4', comment: 'Retry brew' });
    const beforeFailedBrew = await brewCards();
    const beforeFailedHistory = await beanCards();
    await sync(`window.__originalSnapshotPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota failure', 'QuotaExceededError'); };`);
    try {
      await saveSession();
      assert.equal(await sync(`return document.querySelector('.session-form .form-error').hidden;`), false);
      assert.equal(await sync(`return document.querySelector('.session-form').hidden;`), false);
      assert.equal(await sync(`return document.querySelector('#session-dose').value;`), '15');
      assert.equal(await extractionOutput(), '19.60%');
      assert.deepEqual(await brewCards(), beforeFailedBrew);
      assert.deepEqual(await beanCards(), beforeFailedHistory);
    } finally {
      await sync(`IDBObjectStore.prototype.put = window.__originalSnapshotPut; delete window.__originalSnapshotPut;`);
    }
    await saveSession();
    assert.equal((await brewCards()).length, beforeFailedBrew.length + 1);
    assert.equal(await sync(`return document.querySelector('.session-form .form-error').hidden;`), true);
    assert.equal((await beanCards()).find(card => card.id === fallbackBean.id).sessions.length, 1);
    console.log('PASS failed session save preserves entries and histories; retry saves exactly once');
    await api('/refresh', {});
    await ready();
    assert.ok(await evaluate(`return (await (await getDB()).getBeans()).some(bean => bean.id === ${JSON.stringify(fallbackBean.id)});`));
    console.log('PASS Safari IndexedDB database write and reload');
    await openBeans();
    const beforeCommitted = (await beanCards()).length;
    await evaluate(`
      const url = performance.getEntriesByType('resource').find(r => r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js'))?.name;
      if (!url) throw new Error('Missing DuckDB module URL');
      const { AsyncDuckDB } = await import(url);
      const original = AsyncDuckDB.prototype.flushFiles;
      window.__restoreFlush = () => { AsyncDuckDB.prototype.flushFiles = original; };
      AsyncDuckDB.prototype.flushFiles = async () => { throw new Error('Test flush failure after commit'); };
    `);
    try {
      await submitBean('Committed despite flush failure');
      assert.equal((await beanCards()).length, beforeCommitted + 1);
      assert.match(await sync(`return document.querySelector('.bean-form .form-error').textContent;`), /already in your collection/);
      assert.equal(await sync(`return document.querySelector('#bean-name').value;`), '');
    } finally { await sync(`window.__restoreFlush(); delete window.__restoreFlush;`); }
    await api('/refresh', {});
    await ready();
    await openBeans();
    assert.equal((await beanCards()).filter(bean => bean.name === 'Committed despite flush failure').length, 1);
    console.log('PASS post-commit flush failure refreshes the collection, clears the draft, and warns against duplicate retries');
  }
  await sync(`document.querySelector('#tab-io').click();`);
  await checkIO({ sync, evaluate, waitFor, production: Boolean(process.env.TEST_PRODUCTION),
    reload: async () => { await api('/refresh', {}); await ready(); } });
  assert.deepEqual(await sync(`return window.__safariErrors;`), []);
  console.log('PASS Safari smoke checks');
} finally {
  if (session) await api('', undefined, 'DELETE');
}
