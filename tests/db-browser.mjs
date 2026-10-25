import assert from 'node:assert/strict';

// Run a Vite dev server and an isolated Firefox with --remote-debugging-port first.
// Tests use a fresh Firefox container and remove it at the end. Use a test profile.
const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173/';
const primaryStorage = process.env.TEST_MVP ? 'indexeddb' : 'opfs';
const socket = new WebSocket(process.env.FIREFOX_BIDI_URL ?? 'ws://127.0.0.1:9223/session');
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const exceptions = [];
const logs = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === 'event') {
    if (message.method === 'log.entryAdded') {
      logs.push(message.params);
      if (message.params.type === 'javascript') exceptions.push(message.params);
    }
    return;
  }
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  clearTimeout(task.timer);
  if (message.type === 'error') task.reject(new Error(JSON.stringify(message)));
  else task.resolve(message.result);
});

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 45_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

let context;
let userContext;
async function evaluate(expression, target = context) {
  const result = await command('script.evaluate', {
    expression: `(async () => JSON.stringify(await (async () => {
      const getDB = () => import(performance.getEntriesByType('resource').find(r =>
        new URL(r.name).pathname === '/src/db.ts')?.name ?? '/src/db.ts');
      ${expression.replaceAll("import('/src/db.ts')", 'getDB()')}
    })()))()`,
    target: { context: target }, awaitPromise: true,
  });
  if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value === undefined ? undefined : JSON.parse(result.result.value);
}

async function ready() {
  for (let i = 0; i < 100; i++) {
    const state = await evaluate(`return {
      ready: document.querySelector('#app')?.getAttribute('aria-busy') === 'false',
      error: document.querySelector('.startup-status[role="alert"]')?.textContent,
    };`);
    if (state.error) throw new Error(state.error + JSON.stringify(logs));
    if (state.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Application did not initialize: ' + JSON.stringify({
    state: await evaluate('return { html: document.body.innerHTML, resources: performance.getEntriesByType("resource").map(r => r.name) };'),
    logs,
  }));
}

async function reload() {
  await command('browsingContext.reload', { context, wait: 'complete' });
  await ready();
}

try {
  await command('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: false } } });
  await command('session.subscribe', { events: ['log.entryAdded'] });
  ({ userContext } = await command('browser.createUserContext'));
  if (process.env.TEST_MVP) {
    await command('script.addPreloadScript', {
      functionDeclaration: '() => { WebAssembly.validate = () => false; }',
    });
  }
  ({ context } = await command('browsingContext.create', { type: 'tab', userContext }));
  await command('browsingContext.navigate', { context, url: base, wait: 'complete' });
  await ready();
  const initial = await evaluate(`return {
    isolated: crossOriginIsolated,
    tab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(),
    forms: document.querySelectorAll('form').length,
  };`);
  assert.equal(initial.isolated, true);
  assert.equal(initial.tab, 'Brew Controller');
  assert.equal(initial.forms, 3);

  if (process.env.TEST_PRODUCTION) {
    assert.ok(logs.some((entry) => entry.text?.includes(`database ready (${primaryStorage})`)));
    const firstContext = context;
    ({ context } = await command('browsingContext.create', { type: 'tab', userContext }));
    await command('browsingContext.navigate', { context, url: base, wait: 'complete' });
    let error;
    for (let i = 0; i < 100; i++) {
      error = await evaluate(`return document.querySelector('.startup-status[role="alert"]')?.textContent;`);
      if (error) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.match(error, /already open/);
    await command('browsingContext.close', { context: firstContext });
    await reload();
    const resources = await evaluate(`return performance.getEntriesByType('resource').map(r => r.name);`);
    assert.ok(resources.every((url) => new URL(url).origin === new URL(base).origin));
    assert.ok(logs.some((entry) => entry.text?.includes(`database ready (${primaryStorage})`) && entry.source.context === firstContext));
    assert.deepEqual(exceptions, []);
    console.log(`PASS Firefox production boot (${primaryStorage}), local workers/Wasm/Parquet, isolation, and shell`);
  } else {
    assert.ok(logs.some((entry) => entry.text?.includes(`database ready (${primaryStorage})`)), JSON.stringify(logs));
    const seed = await evaluate(`
      const db = await import('/src/db.ts');
      await Promise.all([db.initDB(), db.initDB(), db.initDB()]);
      const bean = await db.addBean({ name: "  Test's coffee ☕  ", roast_date: '2026-10-01' });
      const other = await db.addBean({ name: 'Second bean', freeze_date: '2026-10-25' });
      const metrics = { dose_g: 15, water_g: 250, time_str: '02:30', temp_c: 94,
        grind_um: 700, comment: "It's good; DROP TABLE beans; --", yield_g: 210,
        tds_pct: 1.4, extraction_pct: 19.6 };
      const first = await db.addBrewSession({ bean_id: bean.id, ...metrics });
      const second = await db.addBrewSession({ bean_id: other.id, ...metrics, dose_g: null, comment: null });
      let invalidRejected = false;
      try { await db.addBrewSession({ bean_id: 'missing', ...metrics }); } catch { invalidRejected = true; }
      let blankRejected = false;
      try { await db.addBean({ name: ' ' }); } catch { blankRejected = true; }
      return { bean, other, first, second, invalidRejected, blankRejected,
        beans: await db.getBeans(), sessions: await db.getBrewSessions(),
        filtered: await db.getBrewSessions(bean.id), empty: await db.getBrewSessions('') };
    `);
    assert.equal(seed.bean.name, "Test's coffee ☕");
    assert.equal(seed.bean.roast_date, '2026-10-01');
    assert.equal(seed.bean.freeze_date, null);
    assert.equal(typeof seed.bean.created_at, 'string');
    assert.equal(new Date(seed.bean.created_at).toISOString(), seed.bean.created_at);
    assert.equal(seed.first.extraction_pct, 19.6);
    assert.equal(seed.second.dose_g, null);
    assert.equal(seed.invalidRejected, true);
    assert.equal(seed.blankRejected, true);
    assert.equal(seed.beans[0].id, seed.other.id);
    assert.equal(seed.sessions[0].id, seed.second.id);
    assert.equal(seed.filtered.length, 1);
    assert.equal(seed.filtered[0].bean_name, seed.bean.name);
    assert.deepEqual(seed.empty, []);
    await reload();
    assert.deepEqual(await evaluate(`return await (await import('/src/db.ts')).getBeans();`), seed.beans);
    assert.deepEqual(await evaluate(`return await (await import('/src/db.ts')).getBrewSessions();`), seed.sessions);
    const guards = await evaluate(`
      const db = await import('/src/db.ts');
      let invalidDate = false;
      try { await db.addBean({ name: 'Bad date', roast_date: '10000-01-01' }); } catch { invalidDate = true; }
      let invalidNumber = false;
      try { await db.addBrewSession({ bean_id: (await db.getBeans())[0].id, dose_g: Infinity,
        water_g: null, time_str: null, temp_c: null, grind_um: null, comment: null,
        yield_g: null, tds_pct: null, extraction_pct: null }); } catch { invalidNumber = true; }
      const mode = db.getStorageMode();
      if (mode === 'opfs') {
        await db.closeDB();
        const original = navigator.storage.getDirectory;
        Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: undefined });
        let rejected = false;
        try { await db.initDB(); } catch (error) { rejected = error.message.includes('needs OPFS'); }
        finally { Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: original }); }
        if (!rejected) throw new Error('OPFS must not silently switch datasets');
        await db.initDB();
      }
      return { invalidDate, invalidNumber };
    `);
    assert.deepEqual(guards, { invalidDate: true, invalidNumber: true });
    console.log(`PASS Firefox ${primaryStorage} CRUD, SQL binding, dates/nulls, joins/filter/order, constraints, and reload persistence`);

    // A second tab must never open a competing engine or overwrite snapshots.
    const firstContext = context;
    ({ context } = await command('browsingContext.create', { type: 'tab', userContext }));
    await command('browsingContext.navigate', { context, url: base, wait: 'complete' });
    const ownershipError = await evaluate(`
      try { await (await import('/src/db.ts')).initDB(); return ''; } catch (error) { return String(error); }
    `);
    assert.match(ownershipError, /already open/);
    await evaluate(`await (await import('/src/db.ts')).closeDB();`, firstContext);
    // Explicitly select the fallback fixture; application startup never switches
    // an existing OPFS dataset to an empty snapshot on a lock failure.
    await evaluate(`await new Promise((resolve, reject) => {
      const request = indexedDB.open('coffeos-snapshots', 1);
      request.onsuccess = () => {
        const store = request.result;
        const tx = store.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put('indexeddb', 'backend-v1');
        tx.oncomplete = () => { store.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      }; request.onerror = () => reject(request.error);
    });`);
    await reload();
    assert.ok(logs.some((entry) => entry.text?.includes('database ready (indexeddb)')));
    const fallback = await evaluate(`
      const db = await import('/src/db.ts');
      const beans = await Promise.all(Array.from({ length: 4 }, (_, n) => db.addBean({ name: 'Fallback ' + n })));
      const session = await db.addBrewSession({ bean_id: beans[0].id, dose_g: null, water_g: null,
        time_str: null, temp_c: null, grind_um: null, comment: null, yield_g: null,
        tds_pct: null, extraction_pct: null });
      return { beans: await db.getBeans(), sessions: await db.getBrewSessions(), session };
    `);
    assert.equal(fallback.beans.length, process.env.TEST_MVP ? 6 : 4);
    await reload();
    assert.deepEqual(await evaluate(`return await (await import('/src/db.ts')).getBeans();`), fallback.beans);
    assert.deepEqual(await evaluate(`return await (await import('/src/db.ts')).getBrewSessions();`), fallback.sessions);
    const snapshot = await evaluate(`return await new Promise((resolve, reject) => {
      const request = indexedDB.open('coffeos-snapshots', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const storage = request.result;
        const read = storage.transaction('snapshots').objectStore('snapshots').get('tables-v1');
        read.onsuccess = () => { storage.close(); resolve({
          beans: [...read.result.beans.slice(0, 4)], sessions: [...read.result.brew_sessions.slice(0, 4)]
        }); };
      };
    });`);
    assert.deepEqual(snapshot.beans, [80, 65, 82, 49]); // PAR1
    assert.deepEqual(snapshot.sessions, [80, 65, 82, 49]);
    console.log(`PASS Firefox ${process.env.TEST_MVP ? 'snapshot backend' : 'exclusive ownership and explicit fallback fixture'}, serialized writes, atomic Parquet snapshots, and IndexedDB restore`);

    const failedSave = await evaluate(`
      const db = await import('/src/db.ts');
      const original = IDBObjectStore.prototype.put;
      let rejected = false;
      IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota failure', 'QuotaExceededError'); };
      try { await db.addBean({ name: 'Must roll back' }); } catch { rejected = true; }
      finally { IDBObjectStore.prototype.put = original; }
      const afterFailure = await db.getBeans();
      const recovered = await db.addBean({ name: 'Recovered' });
      return { rejected, afterFailure, recovered };
    `);
    assert.equal(failedSave.rejected, true);
    assert.deepEqual(failedSave.afterFailure, fallback.beans);
    assert.equal(failedSave.recovered.name, 'Recovered');
    console.log('PASS failed IndexedDB save rolls back and later writes recover');

    const corruptSnapshot = await evaluate(`
      const db = await getDB();
      await db.closeDB();
      const storage = await new Promise((resolve, reject) => {
        const request = indexedDB.open('coffeos-snapshots', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const saved = await new Promise((resolve) => {
        const transaction = storage.transaction('snapshots');
        const request = transaction.objectStore('snapshots').get('tables-v1');
        transaction.oncomplete = () => resolve(request.result);
      });
      const put = (value) => new Promise((resolve, reject) => {
        const transaction = storage.transaction('snapshots', 'readwrite');
        transaction.objectStore('snapshots').put(value, 'tables-v1');
        transaction.oncomplete = resolve;
        transaction.onabort = reject;
      });
      await put({ ...saved, beans: new Uint8Array([1, 2, 3]) });
      let rejected = false;
      try { await db.initDB(); } catch { rejected = true; }
      await put(saved);
      storage.close();
      await db.initDB();
      return { rejected, count: (await db.getBeans()).length };
    `);
    assert.equal(corruptSnapshot.rejected, true);
    assert.equal(corruptSnapshot.count, fallback.beans.length + 1);
    console.log('PASS corrupt snapshot rejects initialization without replacing saved data; retry recovers');

    await evaluate(`
      const db = await getDB();
      await db.closeDB();
      Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value: false });
      await db.initDB();
      delete window.crossOriginIsolated;
      return (await db.getBeans()).length;
    `).then((count) => assert.equal(count, fallback.beans.length + 1));

    // Feature absence and denied persistent-storage permission should also initialize.
    await evaluate(`
      await (await import('/src/db.ts')).closeDB();
      Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: undefined });
      Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => { throw new Error('Denied'); } });
      await (await import('/src/db.ts')).initDB();
      return (await (await import('/src/db.ts')).getBeans()).length;
    `).then((count) => assert.equal(count, fallback.beans.length + 1));
    await evaluate(`
      const db = await import('/src/db.ts');
      await db.closeDB();
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
      await db.initDB();
      const bean = await db.addBean({ name: 'Memory only' });
      return { bean, beans: await db.getBeans() };
    `).then(({ beans }) => assert.equal(beans.length, 1));
    assert.ok(logs.some((entry) => entry.text?.includes('database ready (memory)')));
    await evaluate(`await (await import('/src/db.ts')).closeDB();`);
    await evaluate(`await (await import('/src/db.ts')).closeDB();`, firstContext);
    console.log('PASS absent isolation/OPFS, denied storage permission, memory-only fallback, and teardown');
    assert.deepEqual(exceptions, []);
    console.log('PASS zero unhandled browser exceptions/rejections');
  }
} finally {
  if (context) await command('browsingContext.close', { context }).catch(() => {});
  if (userContext) await command('browser.removeUserContext', { userContext }).catch(() => {});
  await command('session.end').catch(() => {});
  socket.close();
}
