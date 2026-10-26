import assert from 'node:assert/strict';

export async function checkSessionDeletion({ sync, evaluate, waitFor, api, ready }) {
  const before = await evaluate(`const db = await getDB();
    return {beans: await db.getBeans(), sessions: await db.getBrewSessions()};`);
  const target = before.sessions[0];
  const selector = `.session-card[data-session-id="${target.id}"]`;
  const state = () => evaluate(`const db = await getDB();
    return {beans: await db.getBeans(), sessions: await db.getBrewSessions()};`);
  const open = async () => {
    await sync(`document.querySelector('#tab-brew-controller').click();`);
    await waitFor(`document.querySelector('.session-list').getAttribute('aria-busy') === 'false'`);
  };
  const swipe = (dx, dy, end = 'pointerup') => sync(`const summary = document.querySelector('${selector} .session-summary');
    for (const [type,x,y] of [['pointerdown',0,0],['pointermove',${dx},${dy}],['${end}',${dx},${dy}]])
      summary.dispatchEvent(new PointerEvent(type,{pointerId:1,isPrimary:true,button:0,clientX:200+x,clientY:100+y,bubbles:true}));`);
  const hidden = () => sync(`return document.querySelector('${selector} .session-delete').hidden;`);
  await open();
  assert.equal(await hidden(), true);
  assert.equal(await sync(`return getComputedStyle(document.querySelector('${selector} .session-surface')).touchAction;`), 'pan-y pinch-zoom');
  await sync(`const frame = document.createElement('iframe'); frame.id = 'session-feed-viewport';
    frame.style.cssText = 'position:fixed;inset:0;width:393px;height:852px;border:0;z-index:1000';
    document.body.append(frame); const doc = frame.contentDocument;
    for (const style of document.querySelectorAll('style,link[rel="stylesheet"]')) doc.head.append(style.cloneNode(true));
    doc.body.append(document.querySelector('#app').cloneNode(true));`);
  try {
    await waitFor(`getComputedStyle(document.querySelector('#session-feed-viewport').contentDocument.querySelector('.session-surface')).display === 'flex'`);
    for (const width of [320, 375, 393, 430]) {
      const layout = await sync(`const frame = document.querySelector('#session-feed-viewport'); frame.style.width = '${width}px';
        const doc = frame.contentDocument; const card = doc.querySelector('${selector}');
        const summary = card.querySelector('.session-summary');
        const content = doc.querySelector('.app-content');
        card.classList.add('delete-revealed'); card.querySelector('.session-delete').hidden = false;
        return {overflow: content.scrollWidth > content.clientWidth,
          controls: ['.session-summary','.session-menu','.session-delete'].map(selector => {
            const rect = card.querySelector(selector).getBoundingClientRect(); return {height:rect.height,width:rect.width};
          })};`);
      assert.equal(layout.overflow, false, `Feed fits ${width}px`);
      assert.ok(layout.controls.every(control => control.height >= 44 && control.width >= 44), JSON.stringify(layout));
    }
  } finally { await sync(`document.querySelector('#session-feed-viewport').remove();`); }
  await swipe(-100, 2);
  await sync(`document.querySelector('${selector} .session-summary').click();`);
  assert.equal(await hidden(), false);
  assert.equal(await sync(`return document.querySelector('.session-form').hidden;`), true, 'Swipe click must not open editor');
  await swipe(100, 2);
  assert.equal(await hidden(), true);
  await swipe(-5, 100);
  assert.equal(await hidden(), true, 'Vertical scroll must not reveal Delete');
  await swipe(-25, 1);
  assert.equal(await hidden(), true, 'Short swipe must not reveal Delete');
  await swipe(-100, 1, 'pointercancel');
  assert.equal(await hidden(), true, 'Cancelled gesture must not reveal Delete');
  await sync(`document.querySelector('${selector} .session-summary').click();`);
  await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy') === 'false'`);
  assert.equal(await sync(`return document.querySelector('.session-form').hidden;`), false, 'Normal tap opens full editor');
  await sync(`document.querySelector('.cancel-session').click();
    document.querySelector('${selector} .session-menu').click();`);
  assert.equal(await hidden(), false);
  assert.equal(await sync(`return document.activeElement.className;`), 'session-delete');
  await sync(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  assert.equal(await hidden(), true);
  assert.equal(await sync(`return document.activeElement.className;`), 'session-menu');
  assert.deepEqual(await state(), before, 'Reveal, dismiss, editor and cancel leave every record untouched');
  const mode = await evaluate('return (await getDB()).getStorageMode();');
  await sync(`document.querySelector('${selector} .session-menu').click();
    window.__deleteQuery = window.__testConnection.prototype.query;
    window.__testConnection.prototype.query = function(sql) {
      if (${mode === 'indexeddb' ? "sql.startsWith('COPY ')" : "sql === 'COMMIT'"}) return Promise.reject(new Error('Injected session delete failure'));
      return window.__deleteQuery.call(this, sql);
    };
    document.querySelector('${selector} .session-delete').click();`);
  await waitFor(`!document.querySelector('${selector} .form-error').hidden && !document.querySelector('${selector} .session-delete').disabled`);
  await sync(`window.__testConnection.prototype.query = window.__deleteQuery;`);
  assert.deepEqual(await state(), before, 'Failed deletion rolls back without touching beans or sibling sessions');
  await evaluate('const db = await getDB(); await db.closeDB(); await db.initDB();');
  assert.deepEqual(await state(), before, 'Failed deletion preserves durable records');
  await sync(`document.querySelector('${selector} .session-delete').click(); document.querySelector('${selector} .session-delete').click();`);
  await waitFor(`!document.querySelector('${selector}') && document.querySelector('.session-list').getAttribute('aria-busy') === 'false' && document.querySelector('.bean-list').getAttribute('aria-busy') === 'false'`);
  const remaining = { beans: before.beans, sessions: before.sessions.filter(session => session.id !== target.id) };
  assert.deepEqual(await state(), remaining, 'Delete removes exactly one session and no beans');
  assert.equal(await sync(`return document.querySelector('.session-count-total').textContent;`), `(${remaining.sessions.length})`);
  assert.equal(await sync(`return !!document.querySelector('.bean-session[data-session-id="${target.id}"]');`), false, 'Bean history refreshes');
  await api('/refresh', {}); await ready();
  assert.deepEqual(await state(), remaining, 'Successful deletion survives reload');
  // A committed change with a failed durability check must refresh the list and
  // show the backup warning, rather than offering a misleading retry.
  const committed = remaining.sessions[0];
  await open();
  await sync(`const card = document.querySelector('.session-card[data-session-id="${committed.id}"]');
    card.querySelector('.session-menu').click();
    window.__deleteQuery = window.__testConnection.prototype.query;
    window.__testConnection.prototype.query = function(sql) {
      if (sql === 'CHECKPOINT') return Promise.reject(new Error('Injected post-commit failure'));
      return window.__deleteQuery.call(this, sql);
    };
    card.querySelector('.session-delete').click();`);
  await waitFor(`!document.querySelector('.session-card[data-session-id="${committed.id}"]') && document.querySelector('.session-list').getAttribute('aria-busy') === 'false'`);
  await sync(`window.__testConnection.prototype.query = window.__deleteQuery;`);
  assert.match(await sync(`return document.querySelector('.save-message').textContent;`), /Deletion was applied.*Export a backup/);
  remaining.sessions = remaining.sessions.filter(session => session.id !== committed.id);
  assert.deepEqual(await state(), remaining);
  const recovery = await evaluate(`return new TextDecoder().decode((await (await getDB()).exportData('csv',false))[1].data);`);
  assert.equal(recovery.includes(committed.id), false, 'Warning leaves the committed collection available for backup');
  // A deliberately failed CHECKPOINT cannot promise durability on OPFS. Keep
  // the live collection open for backup, as instructed by the warning. Ordinary
  // successful deletion and pre-commit rollback were verified after reload above.
  console.log('PASS', mode, 'session swipe/dismiss/scroll/cancel, direct editing, keyboard actions, delete rollback/retry, one-record deletion, history/count refresh, committed-warning and reload');
}
