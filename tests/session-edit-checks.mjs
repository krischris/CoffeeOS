import assert from 'node:assert/strict';

export async function checkSessionEditing({sync, evaluate, waitFor, api, ready}) {
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
  await sync(`const form = document.querySelector('.session-form');
    for (const [name,value] of Object.entries({dose_g:'20.123456789',water_g:'320.123456789',time_str:'03:15',temp_c:'93.123456789',grind_um:'650.123456789',comment:'Changed',yield_g:'280.123456789',tds_pct:'1.23456789',brewed_at:'2024-05-06T12:34:56.789'})) {
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
