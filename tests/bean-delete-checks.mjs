import assert from 'node:assert/strict';

export async function checkBeanDeletion({sync, evaluate, api, ready, waitFor, state, openBeans, mode}) {
    const expected = await state();
    const bean = expected.beans.find(bean => expected.sessions.filter(item => item.bean_id === bean.id).length >= 2);
    const seeded = {...expected, bean, other: expected.beans.find(item => item.id !== bean?.id)};
    assert.ok(seeded.bean && seeded.other, 'bean deletion fixture needs two beans');
    await openBeans();
    const selector = `.bean-card[data-bean-id="${seeded.bean.id}"]`;
    assert.equal(await sync(`return document.querySelector('${selector} details').open;`), false);
    await sync(`document.querySelector('${selector} summary').click();`);
    assert.equal(await sync(`return document.querySelector('${selector} details').open;`), true);
    await sync(`document.querySelector('${selector} summary').click();`);
    const swipe = async (x, y) => sync(`const surface = document.querySelector('${selector} .bean-surface');
      for (const [type, dx, dy] of [['pointerdown',0,0],['pointermove',${x},${y}],['pointerup',${x},${y}]])
        surface.dispatchEvent(new PointerEvent(type,{pointerId:1,isPrimary:true,button:0,clientX:200+dx,clientY:100+dy,bubbles:true}));`);
    await swipe(-100, 2);
    await sync(`document.querySelector('${selector} summary').click();`);
    assert.equal(await sync(`return document.querySelector('${selector} details').open;`), false);
    assert.equal(await sync(`return document.querySelector('${selector} .bean-delete').hidden;`), false);
    await swipe(100, 2);
    assert.equal(await sync(`return document.querySelector('${selector} .bean-delete').hidden;`), true);
    await swipe(-5, 100);
    assert.equal(await sync(`return document.querySelector('${selector} .bean-delete').hidden;`), true);
    await sync(`document.querySelector('${selector} .bean-actions').click();`);
    // Fail after removing the old child table, before snapshot/commit. Rollback
    // must restore the original schema and records, including on OPFS.
    await sync(`window.__query = window.__testConnection.prototype.query;
      window.__testConnection.prototype.query = function(sql) {
        if (sql.startsWith('ALTER TABLE bean_delete_sessions')) return Promise.reject(new Error('Injected deletion failure'));
        return window.__query.call(this, sql);
      };`);
    await sync(`document.querySelector('${selector} .bean-delete').click();`);
    await waitFor(`!document.querySelector('${selector} .form-error').hidden`);
    await sync(`window.__testConnection.prototype.query = window.__query;`);
    assert.deepEqual(await state(), expected);
    await api('/refresh', {}); await ready(); assert.deepEqual(await state(), expected);
    await openBeans(); await sync(`document.querySelector('${selector} .bean-actions').click();`);
    if (mode === 'indexeddb') {
      await sync(`window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(){throw new Error('Injected quota failure');};`);
      await sync(`document.querySelector('${selector} .bean-delete').click();`);
      await waitFor(`!document.querySelector('${selector} .form-error').hidden`);
      await sync(`IDBObjectStore.prototype.put = window.__put;`);
      assert.deepEqual(await state(), expected);
      await api('/refresh', {}); await ready(); assert.deepEqual(await state(), expected);
      await openBeans(); await sync(`document.querySelector('${selector} .bean-actions').click();`);
    }
    await sync(`document.querySelector('${selector} .bean-delete').click(); document.querySelector('${selector} .bean-delete').click();`);
    await waitFor(`!document.querySelector('${selector}')`);
    const remaining = {beans:seeded.beans.filter(b => b.id !== seeded.bean.id), sessions:seeded.sessions.filter(s => s.bean_id !== seeded.bean.id)};
    assert.deepEqual(await state(), remaining);
    await api('/refresh', {}); await ready(); assert.deepEqual(await state(), remaining);
    // A new child can still be added: FK and table schema survive deletion.
    await evaluate(`const db = await getDB(); await db.addBrewSession({bean_id:${JSON.stringify(seeded.other.id)}, dose_g:null, water_g:null,time_str:null,temp_c:null,grind_um:null,comment:null,yield_g:null,tds_pct:null,extraction_pct:null});`);
    await api('/refresh', {}); await ready(); assert.equal((await state()).sessions.length, remaining.sessions.length + 1);
}
