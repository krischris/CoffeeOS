import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function checkBeanEditing({sync, evaluate, waitFor, api, ready}) {
  const seeded = await evaluate(`const db=await getDB();
    const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
    const photo=canvas.toDataURL('image/jpeg');
    const bean=await db.addBean({name:'Bean to edit',roast_date:'2025-01-02',photo_jpeg:photo});
    const session=await db.addBrewSession({bean_id:bean.id,dose_g:15.123456789,water_g:0,
      time_str:'',temp_c:null,grind_um:222.222222222,comment:'  line one\\nline two  ',
      yield_g:210.123456789,tds_pct:1.123456789,extraction_pct:19.123456789});
    const csv=['id,name,roast_date,freeze_date,created_at',
      [bean.id,'  Bean to edit  ','2025-01-02','\\\\N','2024-01-02T03:04:00.000123Z'].join(',')].join('\\n');
    await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(csv)}]);
    return {bean:(await db.getBeans()).find(b=>b.id===bean.id),session};`);
  const selector = `.bean-card[data-bean-id="${seeded.bean.id}"]`;
  const read = () => evaluate(`const db=await getDB();return {
    beans:await db.getBeans(),sessions:await db.getBrewSessions()};`);
  const exported = () => evaluate(`return (await (await getDB()).exportData('csv',false)).map(f=>new TextDecoder().decode(f.data));`);
  const openBeans = async () => {
    await sync(`document.querySelector('#tab-bean-manager').click();`);
    await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy')==='false'`);
  };
  const menu = () => sync(`document.querySelector('${selector} .bean-actions').click();`);
  const edit = async () => {
    await openBeans(); await menu();
    await sync(`document.querySelector('${selector} .bean-edit').click();`);
    assert.equal(await sync(`return document.querySelector('.bean-form').hidden;`), false);
    assert.equal(await sync(`return document.activeElement.id;`), 'bean-name');
    assert.equal(await sync(`return document.querySelector('.app-content').scrollTop;`), 0);
  };
  const save = async () => {
    await sync(`const form=document.querySelector('.bean-form');form.requestSubmit();form.requestSubmit();`);
    await waitFor(`!document.querySelector('.bean-form fieldset').disabled && (document.querySelector('.bean-form').hidden || !document.querySelector('.bean-form .form-error').hidden)`);
    assert.equal(await sync(`return document.querySelector('.bean-form').hidden;`),true,
      await sync(`return document.querySelector('.bean-form .form-error').textContent;`));
    await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy')==='false'`);
  };
  const swipe = (x,y=2) => sync(`const surface=document.querySelector('${selector} .bean-surface');
    for(const [type,dx,dy] of [['pointerdown',0,0],['pointermove',${x},${y}],['pointerup',${x},${y}]])
      surface.dispatchEvent(new PointerEvent(type,{pointerId:1,isPrimary:true,button:0,clientX:200+dx,clientY:100+dy,bubbles:true}));`);
  const original = await read();
  const originalCSV = await exported();
  assert.match(originalCSV[0],/000123/);
  await openBeans();
  await swipe(100);
  assert.deepEqual(await sync(`const card=document.querySelector('${selector}');return {
    edit:card.querySelector('.bean-edit').hidden,remove:card.querySelector('.bean-delete').hidden,
    color:getComputedStyle(card.querySelector('.bean-edit')).backgroundColor};`),
  {edit:false,remove:true,color:'rgb(245, 197, 66)'});
  await sync(`document.querySelector('${selector} summary').click();`);
  assert.equal(await sync(`return document.querySelector('${selector} details').open;`),false,'Swipe suppresses accidental expand');
  await swipe(-100);
  assert.equal(await sync(`return document.querySelector('${selector} .bean-edit').hidden;`),true);
  assert.equal(await sync(`return document.querySelector('${selector} .bean-delete').hidden;`),false);
  await sync(`document.querySelector('${selector}').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  await swipe(2,100);
  assert.equal(await sync(`return document.querySelector('${selector} .bean-edit').hidden;`),true,'Vertical scrolling does not reveal Edit');
  await menu();
  assert.deepEqual(await sync(`const card=document.querySelector('${selector}');return [
    card.querySelector('.bean-edit').hidden,card.querySelector('.bean-delete').hidden,
    card.querySelector('.bean-actions').getAttribute('aria-expanded')];`),[false,false,'true']);
  await sync(`document.querySelector('${selector} .bean-edit').click();`);
  assert.deepEqual(await sync(`return [...document.querySelectorAll('.bean-form input')].map(input=>input.value);`),
    [seeded.bean.name,'2025-01-02','','']);
  assert.equal(await sync(`return document.querySelector('.photo-preview').src;`),seeded.bean.photo_jpeg);
  assert.equal(await sync(`return document.querySelector('.cancel-bean').hidden;`),false);
  if (!process.env.TEST_FIREFOX) {
    await sync(`const frame=document.createElement('iframe');frame.id='bean-edit-viewport';
      frame.style.cssText='position:fixed;inset:0;width:393px;height:852px;border:0;z-index:1000;background:#0e1222';
      document.body.append(frame);const doc=frame.contentDocument;
      for(const style of document.querySelectorAll('style,link[rel="stylesheet"]'))doc.head.append(style.cloneNode(true));
      doc.body.append(document.querySelector('#app').cloneNode(true));`);
    try {
      await waitFor(`getComputedStyle(document.querySelector('#bean-edit-viewport').contentDocument.querySelector('.bean-form-actions')).display==='flex'`);
      for (const [width,height] of [[320,568],[393,852]]) {
        const layout=await sync(`const frame=document.querySelector('#bean-edit-viewport');frame.style.width='${width}px';frame.style.height='${height}px';
          const doc=frame.contentDocument;doc.querySelector('.app-header').style.paddingTop='67px';doc.querySelector('.tab-bar').style.paddingBottom='34px';
          const rect=selector=>{const r=doc.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
          return {overflow:doc.querySelector('.app-content').scrollWidth>doc.querySelector('.app-content').clientWidth,
            form:rect('.bean-form'),navigation:rect('.tab-bar'),cancel:rect('.cancel-bean'),save:rect('.bean-form button[type=submit]')};`);
        assert.equal(layout.overflow,false);
        assert.ok(layout.cancel.height>=44 && layout.save.height>=44 && layout.cancel.width>=44 && layout.save.width>=44,JSON.stringify(layout));
        if(width===393)assert.ok(layout.form.bottom<=layout.navigation.top,JSON.stringify(layout));
      }
      const element=await sync(`return document.querySelector('#bean-edit-viewport');`);
      const png=await api('/element/'+element['element-6066-11e4-a52e-4f735466cecf']+'/screenshot');
      await writeFile('.cache/bean-edit-safari.png',Buffer.from(png,'base64'));
    } finally {
      await sync(`document.querySelector('#bean-edit-viewport')?.remove();`);
    }
  }
  await save();
  assert.deepEqual(await read(),original);
  assert.deepEqual(await exported(),originalCSV,'Unchanged save preserves timestamp precision and all bean/session fields');
  await edit();
  await sync(`document.querySelector('#bean-name').value='Cancelled';document.querySelector('.remove-photo').click();document.querySelector('.cancel-bean').click();`);
  assert.deepEqual(await read(),original,'Cancel leaves durable data untouched');
  await edit();
  assert.equal(await sync(`return document.querySelector('.photo-preview').src;`),seeded.bean.photo_jpeg);
  // Cancel while a new photo is decoding: a late result must not refill add mode.
  await evaluate(`window.__beanDecode=HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode=function(){const image=this;return new Promise((resolve,reject)=>{
      window.__finishBeanDecode=()=>window.__beanDecode.call(image).then(resolve,reject);});};
    const transfer=new DataTransfer();transfer.items.add(new File([await (await fetch(${JSON.stringify(seeded.bean.photo_jpeg)})).blob()],'pending.jpg',{type:'image/jpeg'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  assert.equal(await sync(`return document.querySelector('.bean-form button[type=submit]').disabled;`),true);
  await sync(`document.querySelector('.cancel-bean').click();HTMLImageElement.prototype.decode=window.__beanDecode;window.__finishBeanDecode();`);
  await waitFor(`!document.querySelector('.bean-form button[type=submit]').disabled`);
  assert.equal(await sync(`return document.querySelector('.photo-preview').hidden;`),true);
  assert.deepEqual(await read(),original);
  await edit();
  await sync(`document.querySelector('#bean-name').value='Escape';document.querySelector('#bean-name').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  assert.equal(await sync(`return document.querySelector('.bean-form').hidden;`),true);
  assert.deepEqual(await read(),original);
  await openBeans();
  await sync(`document.querySelector('${selector} summary').click();document.querySelector('${selector} .bean-actions').click();`);
  assert.equal(await sync(`return document.querySelector('${selector} details').open;`),true,'Menu retains expanded history');
  await sync(`document.querySelector('${selector} .bean-edit').click();`);
  assert.equal(await sync(`return document.querySelector('${selector}').classList.contains('is-expanded');`),false);
  assert.equal(await sync(`return document.querySelector('.bean-form').hidden;`),false);
  // Blank names remain invalid in edit mode.
  await sync(`document.querySelector('#bean-name').value=' ';document.querySelector('.bean-form').requestSubmit();`);
  assert.equal(await sync(`return document.querySelector('#bean-name').validity.customError;`),true);
  await sync(`for(const [id,value] of Object.entries({'bean-name':'Renamed <bean>','bean-roast-date':'','bean-freeze-date':'2026-10-27'})){
    const input=document.getElementById(id);
    // Safari's .value='' leaves date segments invalid despite validity.valid.
    // Reset the native date value so the optional field is truly empty.
    input.value=value;
    if(input.type==='date' && !value)input.valueAsDate=null;
    if(input.type==='text')input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  const storage = await evaluate('return (await getDB()).getStorageMode();');
  await sync(`window.__beanEditQuery=window.__testConnection.prototype.query;
    window.__testConnection.prototype.query=function(sql){
      if(${storage==='indexeddb' ? "sql.startsWith('COPY ')" : "sql==='COMMIT'"}) return Promise.reject(new Error('Injected bean edit failure'));
      return window.__beanEditQuery.call(this,sql);};
    document.querySelector('.bean-form').requestSubmit();`);
  await waitFor(`!document.querySelector('.bean-form .form-error').hidden && !document.querySelector('.bean-form fieldset').disabled`);
  await sync(`window.__testConnection.prototype.query=window.__beanEditQuery;`);
  assert.deepEqual(await read(),original,'Failed edit rolls back');
  await evaluate('const db=await getDB();await db.closeDB();await db.initDB();');
  assert.deepEqual(await read(),original,'Failed edit preserves durable records after reopen');
  assert.equal(await sync(`return document.querySelector('#bean-name').value;`),'Renamed <bean>');
  await save();
  const updated = await read();
  assert.deepEqual(updated.beans,original.beans.map(bean=>bean.id===seeded.bean.id
    ? {...bean,name:'Renamed <bean>',roast_date:null,freeze_date:'2026-10-27'} : bean));
  assert.deepEqual(updated.sessions,original.sessions.map(session=>session.bean_id===seeded.bean.id
    ? {...session,bean_name:'Renamed <bean>'} : session));
  assert.equal(await sync(`return document.querySelector('${selector} h3').textContent;`),'Renamed <bean>');
  await api('/refresh',{}); await ready();
  assert.deepEqual(await read(),updated,'Edited bean and linked sessions survive reload');
  // Replacing/removing photos is explicit; changing unrelated fields retained the old photo.
  await edit();
  await evaluate(`const canvas=document.createElement('canvas');canvas.width=6;canvas.height=6;
    canvas.getContext('2d').fillRect(0,0,6,6);
    const transfer=new DataTransfer();transfer.items.add(new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))],'replacement.png',{type:'image/png'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  await waitFor(`document.querySelector('.photo-status').textContent.includes('JPEG ready')`);
  const replacement = await sync(`return document.querySelector('.photo-preview').src;`);
  assert.notEqual(replacement,seeded.bean.photo_jpeg);
  await save();
  assert.equal((await read()).beans.find(bean=>bean.id===seeded.bean.id).photo_jpeg,replacement);
  await edit();await sync(`document.querySelector('.remove-photo').click();`);await save();
  assert.equal((await read()).beans.find(bean=>bean.id===seeded.bean.id).photo_jpeg,null);
  // A flush error after commit must not leave an edit that can be submitted as a new bean.
  await edit();
  await sync(`document.querySelector('#bean-name').value='Committed bean edit';
    window.__beanEditQuery=window.__testConnection.prototype.query;
    window.__testConnection.prototype.query=function(sql){if(sql==='CHECKPOINT')return Promise.reject(new Error('Injected bean flush failure'));return window.__beanEditQuery.call(this,sql);};
    document.querySelector('.bean-form').requestSubmit();`);
  await waitFor(`!document.querySelector('.bean-form .form-error').hidden && !document.querySelector('.bean-form fieldset').disabled`);
  await sync(`window.__testConnection.prototype.query=window.__beanEditQuery;`);
  assert.equal(await sync(`return document.querySelector('.cancel-bean').hidden;`),true);
  assert.equal(await sync(`return document.querySelector('#bean-name').value;`),'');
  assert.match(await sync(`return document.querySelector('.bean-form .form-error').textContent;`),/already in your collection/);
  const committed = await read();
  assert.equal(committed.beans.length,original.beans.length);
  assert.equal(committed.beans.find(bean=>bean.id===seeded.bean.id).name,'Committed bean edit');
  // Flush through a later ordinary write, then verify exact reload state.
  await evaluate(`const db=await getDB();const bean=(await db.getBeans()).find(b=>b.id===${JSON.stringify(seeded.bean.id)});await db.updateBean(bean.id,bean);`);
  await api('/refresh',{}); await ready();assert.deepEqual(await read(),committed);
  const missing = await evaluate(`const db=await getDB();try {await db.updateBean('missing-bean',{name:'Missing',roast_date:null,freeze_date:null});return false;}catch{return true;}`);
  assert.equal(missing,true);
  assert.deepEqual(await read(),committed,'Missing beans are never recreated');
  await openBeans();
  console.log('PASS bean editing: swipe/menu, expanded history, prefill/top, unchanged fidelity, cancel/Escape, validation, rollback/retry, rename/dates/photo, duplicate-submit guard, committed-flush recovery and reload');
}
