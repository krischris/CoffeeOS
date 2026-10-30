import assert from 'node:assert/strict';

export async function checkSessionEditing({sync, evaluate, waitFor, api, ready, showWindow}) {
  const initial = await evaluate(`const db = await getDB();
    const beans = await db.getBeans();
    return await db.addBrewSession({bean_id:beans[0].id, dose_g:15.123456789, water_g:0,
      time_str:'', temp_c:null, grind_um:222.222222222, comment:'  line one\\nline two  ',
      yield_g:210.123456789, tds_pct:1.123456789, extraction_pct:19.123456789});`);
  const read = () => evaluate(`return (await (await getDB()).getBrewSessions()).find(s => s.id === ${JSON.stringify(initial.id)});`);
  const open = async () => {
    await sync(`document.querySelector('#tab-brew-controller').click();`);
    await waitFor(`document.querySelector('.session-list').getAttribute('aria-busy') === 'false'`);
    await sync(`document.querySelector('[data-session-id="${initial.id}"] .session-summary').click();`);
    await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy') === 'false'`);
  };
  const save = async () => {
    await sync(`document.querySelector('.session-form').requestSubmit(); document.querySelector('.session-form').requestSubmit();`);
    await waitFor(`document.querySelector('.session-form').hidden && document.querySelector('.session-list').getAttribute('aria-busy') === 'false'`);
  };
  await evaluate(`const db=await getDB(); const record=(await db.getBrewSessions()).find(s=>s.id===${JSON.stringify(initial.id)});
    await db.updateBrewSession(record.id,{...record,brewed_at:'2024-01-02T03:04:00.000123Z'});`);
  const exported = () => evaluate(`return new TextDecoder().decode((await (await getDB()).exportData('csv',false))[1].data);`);
  const beforeExport = await exported();
  assert.match(beforeExport, /000123/);
  const original = await read();
  await open(); await save();
  assert.equal(await exported(),beforeExport,'Unchanged save preserves sub-millisecond timestamps in backups');
  assert.deepEqual(await read(), original, 'Unchanged save preserves precision, dates, nulls, empty strings, whitespace and multiline comments');
  await open();
  await sync(`document.querySelector('#session-dose').value = '99'; document.querySelector('.cancel-session').click();`);
  assert.deepEqual(await read(), original, 'Cancel leaves stored record untouched');
  await open();
  assert.equal(await sync(`return document.querySelector('#session-dose').value;`), String(initial.dose_g));
  const values = {dose_g:'20.123456789',water_g:'320.123456789',time_str:'03:15',temp_c:'93.123456789',grind_um:'650.123456789',comment:'Changed',yield_g:'280.123456789',tds_pct:'1.23456789',brewed_at:'2024-05-06T12:34:56.789'};
  // Use native Safari keystrokes: number inputs do not expose selectionStart,
  // and assigning .value would bypass the replacement behavior being tested.
  if (!process.env.TEST_FIREFOX) {
    await showWindow();
    await sync(`window.__measurementClicks = 0;
      window.__measurementClickController = new AbortController();
      document.querySelector('.session-form').addEventListener('click', event => {
        if (event.isTrusted && event.target.matches('input[type="number"], input[name="time_str"]')) window.__measurementClicks++;
      }, {signal:window.__measurementClickController.signal});`);
    const type = text => api('/actions', {actions:[{type:'key',id:'measurement-typing',
      actions:[...text].flatMap(value => [{type:'keyDown',value},{type:'keyUp',value}])}]});
    const click = async selector => {
      const previous = await sync('return window.__measurementClicks;');
      const element = await sync(`return document.querySelector('${selector}');`);
      await api('/element/'+element['element-6066-11e4-a52e-4f735466cecf']+'/click',{});
      // Wait for delivery of this one native click before submitting keystrokes.
      // Safari can acknowledge WebDriver input before DOM dispatch completes.
      await waitFor(`window.__measurementClicks === ${previous + 1}`);
    };
    try {
      for (const name of ['dose_g','water_g','time_str','temp_c','grind_um','yield_g','tds_pct']) {
        const selector = `.session-form input[name="${name}"]`;
        if (name === 'water_g') await type('\uE004'); // Tab forward from dose.
        else await sync(`document.querySelector('${selector}').focus();`);
        assert.equal(await sync(`return document.activeElement.name;`), name, `${name}: focus`);
        await type('7.5');
        assert.equal(await sync(`return document.querySelector('${selector}').value;`), '7.5', `${name}: focus replaces the whole value`);
        await type('9');
        assert.equal(await sync(`return document.querySelector('${selector}').value;`), '7.59', `${name}: continued typing keeps the caret`);
        for (const replacement of ['0', values[name]]) {
          await click(selector);
          await type(replacement);
          assert.equal(await sync(`return document.querySelector('${selector}').value;`), replacement, `${name}: repeat click replaces the whole value`);
        }
      }
      // Select the populated TDS again, then clear it with native Backspace.
      await click('#session-tds');
      await type('\uE003');
      assert.equal(await sync(`return document.querySelector('#session-tds').value;`), '', 'Optional measurements can be cleared');
      assert.equal(await sync(`return document.querySelector('#session-extraction').value;`), '—');
      await type(values.tds_pct);
      assert.equal(await sync(`return document.querySelector('#session-extraction').value;`), `${(Number(values.yield_g)*Number(values.tds_pct)/Number(values.dose_g)).toFixed(2)}%`);
      const comment = await sync(`const field=document.querySelector('#session-comment');
        field.focus();field.setSelectionRange(2,2);document.querySelector('#new-session-heading').focus();field.focus();
        return field.value;`);
      await type('!');
      assert.equal(await sync(`return document.querySelector('#session-comment').value;`), comment.slice(0,2)+'!'+comment.slice(2), 'Comment focus keeps ordinary caret editing');
    } finally {
      try { await api('/actions',undefined,'DELETE'); }
      finally {
        await sync(`window.__measurementClickController.abort();
          delete window.__measurementClickController; delete window.__measurementClicks;`);
      }
    }
    console.log('PASS native Safari measurement replacement: focus, Tab, repeat clicks, continued typing, zero/empty/precise values, clearing, extraction and ordinary comment editing');
  }
  const scriptedValues = process.env.TEST_FIREFOX ? values : {comment:values.comment,brewed_at:values.brewed_at};
  await sync(`const form = document.querySelector('.session-form');
    for (const [name,value] of Object.entries(${JSON.stringify(scriptedValues)})) {
      form.elements[name].value=value;form.elements[name].dispatchEvent(new Event('input',{bubbles:true}));
    }
    const select=form.elements.bean_id; if(select.options.length > 2) select.value=select.options[select.value===select.options[1].value ? 2 : 1].value;
    window.__editedBean=select.value;
    window.__editedDate=new Date(form.elements.brewed_at.value).toISOString();`);
  // Force the existing transaction snapshot/flush path to reject before commit.
  const storage = await evaluate('return (await getDB()).getStorageMode();');
  await sync(`window.__editQuery=window.__testConnection.prototype.query;
    window.__testConnection.prototype.query=function(sql){if(${storage === 'indexeddb' ? "sql.startsWith('COPY ')" : "sql==='COMMIT'"}) return Promise.reject(new Error('Injected edit failure')); return window.__editQuery.call(this,sql);};
    document.querySelector('.session-form').requestSubmit();`);
  await waitFor(`!document.querySelector('.session-form .form-error').hidden && !document.querySelector('.save-session').disabled`);
  await sync(`window.__testConnection.prototype.query=window.__editQuery;`);
  assert.deepEqual(await read(), original, 'Failed edit rolls back');
  await evaluate('const db=await getDB(); await db.closeDB(); await db.initDB();');
  assert.deepEqual(await read(), original, 'Failed edit preserves persisted record after reopen');
  assert.equal(await sync(`return document.querySelector('#session-comment').value;`), 'Changed');
  await save();
  const updated = await read();
  assert.equal(updated.id, original.id);
  assert.equal(updated.bean_id, await sync('return window.__editedBean;'));
  assert.equal(updated.brewed_at, await sync('return window.__editedDate;'));
  for (const [key,value] of Object.entries({dose_g:20.123456789,water_g:320.123456789,time_str:'03:15',temp_c:93.123456789,grind_um:650.123456789,comment:'Changed',yield_g:280.123456789,tds_pct:1.23456789})) assert.equal(updated[key],value,key);
  assert.equal(updated.extraction_pct, updated.yield_g * updated.tds_pct / updated.dose_g);
  await api('/refresh',{}); await ready();
  assert.deepEqual(await read(),updated,'Edited record survives reload');
  console.log('PASS session edits: unchanged fidelity, cancel/reopen, all fields, relationship/date, rollback/retry, duplicate-submit guard and reload');
}
