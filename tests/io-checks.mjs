import assert from 'node:assert/strict';

const beanKeys = ['id', 'name', 'roast_date', 'freeze_date', 'created_at'];
const sessionKeys = ['id', 'bean_id', 'brewed_at', 'dose_g', 'water_g', 'time_str', 'temp_c', 'grind_um', 'comment', 'yield_g', 'tds_pct', 'extraction_pct'];
const csv = (keys, rows) => [keys.join(','), ...rows.map(row => keys.map(key =>
  row[key] == null ? '\\N' : `"${String(row[key]).replaceAll('"', '""')}"`).join(','))].join('\n') + '\n';

export async function checkIO({ sync, evaluate, waitFor, reload, production }) {
  const counts = () => sync(`return { beans: document.querySelectorAll('.bean-card').length,
    sessions: document.querySelectorAll('.session-card').length };`);
  await sync(`document.querySelector('#tab-bean-manager').click();`);
  await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy') === 'false'`);
  await sync(`document.querySelector('#tab-brew-controller').click();`);
  await waitFor(`document.querySelector('.session-list').getAttribute('aria-busy') === 'false'`);
  const before = await counts();
  await sync(`document.querySelector('#tab-io').click();`);
  await sync(`document.querySelector('.io-import').requestSubmit();`);
  assert.match(await sync(`return document.querySelector('.import-error').textContent;`), /Choose/);
  const layout = await sync(`return {
    overflow: document.querySelector('.app-content').scrollWidth > document.querySelector('.app-content').clientWidth,
    fields: [...document.querySelectorAll('#io input, #io select')].map(field => ({
      font: getComputedStyle(field).fontSize, height: field.getBoundingClientRect().height })),
    buttons: [...document.querySelectorAll('#io fieldset button')].map(button => button.getBoundingClientRect().height),
  };`);
  assert.equal(layout.overflow, false);
  assert.ok(layout.fields.every(field => field.font === '16px' && field.height >= 44), JSON.stringify(layout));
  assert.ok(layout.buttons.every(height => height >= 44));

  async function exportFiles(format, combined = false) {
    await sync(`document.querySelector('#export-layout').value = '${combined ? 'combined' : 'tables'}';
      document.querySelector('[data-format="${format}"]').click();`);
    await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
    assert.equal(await sync(`return document.querySelector('.export-error').hidden;`), true,
      await sync(`return document.querySelector('.export-error').textContent;`));
    return evaluate(`return await Promise.all([...document.querySelectorAll('.download-file')].map(async link => ({
      name: link.download, data: [...new Uint8Array(await (await fetch(link.href)).arrayBuffer())], href: link.href,
    })));`);
  }
  async function importFiles(files) {
    await sync(`const form = document.querySelector('.io-import'); form.reset();
      for (const item of ${JSON.stringify(files)}) {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(item.data)], item.name));
        form.elements[item.target].files = transfer.files;
      }
      form.requestSubmit(); form.requestSubmit();`);
    await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
    await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy') === 'false' && document.querySelector('.session-list').getAttribute('aria-busy') === 'false'`);
    return sync(`return { error: !document.querySelector('.import-error').hidden,
      message: document.querySelector('.import-status').textContent,
      detail: document.querySelector('.import-error').textContent };`);
  }
  for (const format of ['csv', 'parquet']) {
    const files = await exportFiles(format);
    assert.deepEqual(files.map(file => file.name), [`beans.${format}`, `brew_sessions.${format}`]);
    if (format === 'parquet') assert.ok(files.every(file => String.fromCharCode(...file.data.slice(0, 4)) === 'PAR1'));
    else assert.match(new TextDecoder().decode(new Uint8Array(files[0].data)), /^"?id"?,/);
    const imported = await importFiles(files.map((file, index) => ({ ...file, target: index ? 'brew_sessions' : 'beans' })));
    assert.equal(imported.error, false, imported.detail);
    assert.match(imported.message, new RegExp(`Imported ${before.beans} beans and ${before.sessions} brew sessions`));
    assert.deepEqual(await counts(), before);
    const combined = await exportFiles(format, true);
    assert.equal(combined.length, 1);
    assert.equal(combined[0].name, `coffeeos.${format}`);
    const merged = await importFiles([{ ...combined[0], target: 'combined' }]);
    assert.equal(merged.error, false, merged.detail);
    assert.deepEqual(await counts(), before);
  }
  await sync(`Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: ({ files }) => files.length > 0 });
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async ({ files }) => {
      window.__sharedFileNames = files.map(file => file.name);
    } });`);
  try {
    await exportFiles('csv');
    assert.equal(await sync(`return document.querySelector('.share-files').hidden;`), false);
    await sync(`document.querySelector('.share-files').click();`);
    await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
    assert.deepEqual(await sync(`return window.__sharedFileNames;`), ['beans.csv', 'brew_sessions.csv']);
    await sync(`navigator.share = async () => { throw new DOMException('Cancelled', 'AbortError'); };
      document.querySelector('.share-files').click();`);
    await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
    assert.equal(await sync(`return document.querySelector('.export-error').hidden;`), true);
    await sync(`navigator.share = async () => { throw new Error('Unsupported share'); };
      document.querySelector('.share-files').click();`);
    await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
    assert.match(await sync(`return document.querySelector('.export-error').textContent;`), /Save links/);
    assert.equal(await sync(`return document.querySelectorAll('.download-file').length;`), 2);
    await sync(`navigator.canShare = () => false;`);
    await exportFiles('csv');
    assert.equal(await sync(`return document.querySelector('.share-files').hidden;`), true);
  } finally {
    await sync(`delete navigator.share; delete navigator.canShare; delete window.__sharedFileNames;`);
  }
  console.log('PASS IO two-file and combined CSV/Parquet exports, file contents, duplicate-free UI re-imports, import counts, and narrow layout');

  const tag = String(Date.now());
  const bean = { id: `000${tag}`, name: `IO's <img src=x> 咖啡, "quoted"\nSecond line`, roast_date: '2026-10-01', freeze_date: null, created_at: '2026-10-25T10:20:30.123Z' };
  const emptyBean = { ...bean, id: `empty-${tag}`, name: 'No sessions', roast_date: null };
  const brew = { id: `session-${tag}`, bean_id: bean.id, brewed_at: '2026-10-25T10:21:30.456Z',
    dose_g: 18, water_g: 0, time_str: '', temp_c: null, grind_um: 700, comment: '\\N',
    yield_g: 250, tds_pct: 1.43, extraction_pct: 250 * 1.43 / 18 };
  const encoded = (target, keys, rows) => ({ target, name: `${target}.csv`, data: [...new TextEncoder().encode(csv(keys, rows))] });
  const emptyImport = await importFiles([encoded('beans', beanKeys, []), encoded('brew_sessions', sessionKeys, [])]);
  assert.equal(emptyImport.error, false, emptyImport.detail);
  assert.match(emptyImport.message, /Imported 0 beans and 0 brew sessions/);
  assert.deepEqual(await counts(), before);
  // Reordered columns verify names are used, not SELECT * position.
  const fixtures = [encoded('brew_sessions', [...sessionKeys].reverse(), [brew]), encoded('beans', [...beanKeys].reverse(), [bean, emptyBean])];
  let result = await importFiles(fixtures);
  assert.equal(result.error, false, result.detail);
  assert.match(result.message, /Imported 2 beans and 1 brew session/);
  assert.deepEqual(await counts(), { beans: before.beans + 2, sessions: before.sessions + 1 });
  assert.equal(await sync(`return [...document.querySelectorAll('.bean-card')].find(card => card.dataset.beanId === '${bean.id}').querySelector('h3').textContent;`), bean.name);
  assert.equal(await sync(`return document.querySelectorAll('.bean-card img').length;`), 0);
  const updatedBean = { ...bean, name: 'Updated referenced bean' };
  const updatedBrew = { ...brew, bean_id: emptyBean.id, comment: 'Updated, "quoted"\nComment', water_g: null };
  result = await importFiles([encoded('beans', beanKeys, [updatedBean]), encoded('brew_sessions', sessionKeys, [updatedBrew])]);
  assert.equal(result.error, false, result.detail);
  assert.match(result.message, /Imported 1 bean and 1 brew session/);
  assert.equal(await sync(`return document.querySelector('[data-bean-id="${emptyBean.id}"] .session-count').textContent;`), '1 brew session');
  assert.equal(await sync(`return document.querySelector('[data-bean-id="${bean.id}"] .session-count').textContent;`), '0 brew sessions');
  assert.equal(await sync(`return document.querySelector('.session-card[data-session-id="${brew.id}"] h3').textContent;`), emptyBean.name);
  const currentCounts = await counts();
  result = await importFiles([encoded('beans', beanKeys, [{ ...bean, id: `rollback-${tag}` }]),
    encoded('brew_sessions', sessionKeys, [{ ...brew, id: `orphan-${tag}`, bean_id: 'missing-bean' }])]);
  assert.equal(result.error, true);
  assert.match(result.detail, /missing beans/);
  assert.equal(await sync(`return document.querySelector('#import-beans').files.length;`), 1);
  assert.deepEqual(await counts(), currentCounts);
  console.log('PASS UI CSV inserts, reordered headers, Unicode/quoted/multiline values, referenced-bean/session updates, immediate histories, orphan rollback, retained files, and duplicate-submit guard');

  if (!production) {
    const state = () => evaluate(`const db = await getDB(); return { beans: await db.getBeans(), sessions: await db.getBrewSessions() };`);
    let stored = await state();
    assert.deepEqual(stored.beans.find(item => item.id === bean.id), { ...updatedBean, photo_jpeg: null });
    assert.deepEqual(stored.sessions.find(item => item.id === brew.id), { ...updatedBrew, bean_name: emptyBean.name });
    // Import a literal null marker, an empty string, and a NULL in separate string fields.
    result = await importFiles([encoded('brew_sessions', sessionKeys, [brew])]);
    assert.equal(result.error, false, result.detail);
    stored = await state();
    assert.deepEqual(stored.sessions.find(item => item.id === brew.id), { ...brew, bean_name: updatedBean.name });
    for (const format of ['csv', 'parquet']) {
      for (const combined of [false, true]) {
        const exported = await exportFiles(format, combined);
        result = await importFiles(exported.map((file, i) => ({ ...file, target: combined ? 'combined' : i ? 'brew_sessions' : 'beans' })));
        assert.equal(result.error, false, result.detail);
        assert.deepEqual(await state(), stored);
      }
    }
    // Each invalid batch includes a new valid bean to prove all-or-nothing behavior.
    const valid = encoded('beans', beanKeys, [{ ...bean, id: `never-insert-${tag}` }]);
    const badSessions = [
      [{ ...brew, id: null }], [{ ...brew, dose_g: 'not-a-number' }], [{ ...brew, dose_g: 'NaN' }],
      [{ ...brew, brewed_at: '10000-01-01' }], [{ ...brew, brewed_at: '0001-01-01 (BC)' }], [{ ...brew, brewed_at: 'infinity' }], [{ ...brew, brewed_at: 'not-a-date' }], [brew, brew],
    ];
    for (const rows of badSessions) {
      result = await importFiles([valid, encoded('brew_sessions', sessionKeys, rows)]);
      assert.equal(result.error, true, JSON.stringify(rows));
      assert.deepEqual(await state(), stored);
    }
    for (const upload of [
      encoded('beans', beanKeys, [{ ...bean, name: '  ' }]),
      encoded('beans', beanKeys, [{ ...bean, roast_date: '2026-02-30' }]),
      encoded('beans', beanKeys, [{ ...bean, roast_date: '10000-01-01' }]),
      { target: 'beans', name: 'wrong.csv', data: [...new TextEncoder().encode('id,wrong\nx,y\n')] },
      { target: 'beans', name: 'broken.parquet', data: [1, 2, 3] },
      { target: 'beans', name: 'wrong.txt', data: [1] },
      encoded('combined', ['bean_id', 'bean_name', 'bean_roast_date', 'bean_freeze_date', 'bean_created_at',
        'session_id', ...sessionKeys.filter(key => !['id', 'bean_id'].includes(key))], [{
        ...brew, bean_id: bean.id, bean_name: bean.name, bean_created_at: bean.created_at, session_id: null,
      }]),
    ]) {
      result = await importFiles([upload]);
      assert.equal(result.error, true);
      assert.deepEqual(await state(), stored);
    }
    const failure = await evaluate(`
      const db = await getDB();
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota failure', 'QuotaExceededError'); };
      try {
        await db.importData(${JSON.stringify([valid])}.map(file => ({ ...file, data: new Uint8Array(file.data) })));
        return 'unexpected success';
      } catch (error) { return String(error); }
      finally { IDBObjectStore.prototype.put = original; }
    `);
    assert.match(failure, /quota failure/);
    assert.deepEqual(await state(), stored);
    result = await importFiles([valid]);
    assert.equal(result.error, false, result.detail);
    stored = await state();
    await reload();
    assert.deepEqual(await state(), stored);
    console.log('PASS exact CSV/Parquet round trips (null/empty/literal \\N, dates, zeroes, full precision), strict invalid-file rejection, atomic failed snapshots, successful retry, and reload persistence');
    // Restore each backup into a genuinely empty engine, isolated from durable browser data.
    const isolated = await evaluate(`
      const db = await getDB();
      const originalIndexedDB = Object.getOwnPropertyDescriptor(window, 'indexedDB');
      const originalDirectory = Object.getOwnPropertyDescriptor(navigator.storage, 'getDirectory');
      const originalIsolation = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
      const realIDB = indexedDB;
      const testStores = [];
      const expected = { beans: await db.getBeans(), sessions: await db.getBrewSessions() };
      const results = [];
      try {
        for (const format of ['csv', 'parquet']) for (const combined of [false, true]) {
          const exported = await db.exportData(format, combined);
          await db.closeDB();
          const testName = 'coffeeos-import-test-' + crypto.randomUUID();
          testStores.push(testName);
          Object.defineProperty(window, 'indexedDB', { configurable: true, value: {open: () => realIDB.open(testName, 1)} });
          Object.defineProperty(window, 'crossOriginIsolated', {configurable:true, value:false});
          Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: async () => ({getFileHandle: async () => {throw new DOMException('missing', 'NotFoundError');}}) });
          await db.initDB();
          const initial = { beans: await db.getBeans(), sessions: await db.getBrewSessions() };
          const inputs = files => files.map((file, i) => ({ ...file,
            target: combined ? 'combined' : i ? 'brew_sessions' : 'beans' }));
          const empty = await db.importData(inputs(await db.exportData(format, combined)));
          const imported = await db.importData(inputs(exported));
          results.push({ initial, empty, imported,
            equal: JSON.stringify({ beans: await db.getBeans(), sessions: await db.getBrewSessions() }) === JSON.stringify(expected) });
        }
      } finally {
        await db.closeDB();
        if (originalIndexedDB) Object.defineProperty(window, 'indexedDB', originalIndexedDB);
        else delete window.indexedDB;
        if (originalDirectory) Object.defineProperty(navigator.storage, 'getDirectory', originalDirectory);
        else delete navigator.storage.getDirectory;
        if (originalIsolation) Object.defineProperty(window, 'crossOriginIsolated', originalIsolation);
        else delete window.crossOriginIsolated;
        for (const name of testStores) realIDB.deleteDatabase(name);
        await db.initDB();
      }
      return results;
    `);
    assert.equal(isolated.length, 4);
    for (const result of isolated) {
      assert.deepEqual(result.initial, { beans: [], sessions: [] });
      assert.deepEqual(result.empty, { beans: 0, brew_sessions: 0 });
      assert.deepEqual(result.imported, { beans: stored.beans.length, brew_sessions: stored.sessions.length });
      assert.equal(result.equal, true);
    }
    assert.deepEqual(await state(), stored);
    console.log('PASS all backup formats/layouts restore into an empty isolated test database, empty exports re-import, and durable data stays intact');
  } else {
    await reload();
    await sync(`document.querySelector('#tab-bean-manager').click();`);
    await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy') === 'false'`);
    await waitFor(`document.querySelector('.session-list').getAttribute('aria-busy') === 'false'`);
    assert.deepEqual(await counts(), currentCounts);
    console.log('PASS production IO import reload persistence');
  }
}
