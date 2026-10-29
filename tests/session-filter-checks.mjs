import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkSessionFiltering({sync, evaluate, waitFor, api, state}) {
  const seeded = await evaluate(`const db=await getDB();
    const first=await db.addBean({name:'Filter bean <same name> ☕'});
    const second=await db.addBean({name:first.name});
    const empty=await db.addBean({name:'Filter bean without brews'});
    const records=[];
    for(const bean_id of [first.id,second.id,first.id])records.push(await db.addBrewSession({
      bean_id,dose_g:15.123456789,water_g:0,time_str:'',temp_c:null,grind_um:222.222222222,
      comment:'  filter fixture  ',yield_g:210.123456789,tds_pct:1.123456789,extraction_pct:19.123456789}));
    return {first,second,empty,records};`);
  const idle = () => waitFor(`document.querySelector('.session-list').getAttribute('aria-busy')==='false' && !document.querySelector('.session-filter-bean').disabled`);
  const openBrews = async () => {
    await sync(`document.querySelector('#tab-brew-controller').click();`);
    await idle();
  };
  const toggle = async () => {
    const button=await api('/element',{using:'css selector',value:'.session-filter-toggle'});
    await api('/element/'+button['element-6066-11e4-a52e-4f735466cecf']+'/click',{});
    await idle();
  };
  const select = id => sync(`const select=document.querySelector('.session-filter-bean');
    select.value=${JSON.stringify(id)};select.dispatchEvent(new Event('change',{bubbles:true}));`);
  const view = () => sync(`return {
    hidden:document.querySelector('.session-filter').hidden,
    expanded:document.querySelector('.session-filter-toggle').getAttribute('aria-expanded'),
    value:document.querySelector('.session-filter-bean').value,
    count:document.querySelector('.session-count-total').textContent,
    ids:[...document.querySelectorAll('.session-list .session-card')].map(card=>card.dataset.sessionId),
    options:[...document.querySelector('.session-filter-bean').options].map(option=>({id:option.value,name:option.textContent}))};`);
  const assertMatches = async id => {
    const sessions=(await state()).sessions;
    const expected=sessions.filter(session=>!id || session.bean_id===id).map(session=>session.id);
    const actual=await view();
    assert.equal(actual.value,id);
    assert.equal(actual.count,`(${expected.length})`);
    assert.deepEqual(actual.ids,expected,'Bean filtering preserves the database session order');
  };
  const csv = () => evaluate(`return (await (await getDB()).exportData('csv',false)).map(file=>Array.from(file.data));`);

  await openBrews();
  const original=await state(), originalCSV=await csv();
  assert.equal((await view()).hidden,true);
  assert.equal((await view()).expanded,'false');
  await toggle();
  const opened=await view();
  assert.equal(opened.hidden,false);
  assert.equal(opened.expanded,'true');
  assert.deepEqual(opened.options,[{id:'',name:'All beans'},...original.beans.map(bean=>({id:bean.id,name:bean.name}))]);
  assert.deepEqual(await sync(`const button=document.querySelector('.session-filter-toggle');return {
    type:button.type,label:button.getAttribute('aria-label'),controls:button.getAttribute('aria-controls')};`),
  {type:'button',label:'Hide and clear bean filter',controls:'session-bean-filter'});
  for(const id of [seeded.first.id,seeded.second.id,seeded.empty.id,'']) {
    await select(id); await assertMatches(id);
  }
  await select(seeded.empty.id);
  assert.match(await sync(`return document.querySelector('.session-list .empty-state').textContent;`),/No brew sessions for this bean/);

  if(!process.env.TEST_FIREFOX) {
    await sync(`const frame=document.createElement('iframe');frame.id='session-filter-viewport';
      frame.style.cssText='position:fixed;inset:0;width:393px;height:852px;border:0;z-index:1000;background:#0e1222';
      document.body.append(frame);const doc=frame.contentDocument;
      for(const style of document.querySelectorAll('style,link[rel="stylesheet"]'))doc.head.append(style.cloneNode(true));
      doc.body.append(document.querySelector('#app').cloneNode(true));`);
    try {
      await waitFor(`getComputedStyle(document.querySelector('#session-filter-viewport').contentDocument.querySelector('.session-list-header')).display==='flex'`);
      for(const [width,height] of [[320,568],[1440,900],[393,852]]) {
        const layout=await sync(`const frame=document.querySelector('#session-filter-viewport');
          frame.style.width='${width}px';frame.style.height='${height}px';const doc=frame.contentDocument;
          const rect=selector=>{const r=doc.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
          return {header:rect('.session-list-header'),heading:rect('#session-list-heading'),button:rect('.session-filter-toggle'),
            select:rect('.session-filter-bean'),font:getComputedStyle(doc.querySelector('.session-filter-bean')).fontSize,
            overflow:doc.documentElement.scrollWidth>doc.documentElement.clientWidth || doc.querySelector('.app-content').scrollWidth>doc.querySelector('.app-content').clientWidth};`);
        assert.equal(layout.overflow,false,JSON.stringify(layout));
        assert.ok(layout.button.width>=44 && layout.button.height>=44,JSON.stringify(layout));
        assert.ok(Math.abs(layout.button.right-layout.header.right)<1,JSON.stringify(layout));
        assert.ok(layout.button.left>=layout.heading.right,JSON.stringify(layout));
        assert.ok(layout.select.top>=layout.header.bottom && layout.select.height>=44,JSON.stringify(layout));
        assert.equal(layout.font,'16px');
      }
      const frame=await sync(`return document.querySelector('#session-filter-viewport');`);
      const png=await api('/element/'+frame['element-6066-11e4-a52e-4f735466cecf']+'/screenshot');
      await writeFile('.cache/session-filter-safari.png',Buffer.from(png,'base64'));
    } finally { await sync(`document.querySelector('#session-filter-viewport')?.remove();`); }
  }

  await select(seeded.first.id);
  await toggle();
  assert.equal((await view()).hidden,true);
  assert.equal((await view()).expanded,'false');
  await assertMatches('');
  await toggle(); await assertMatches('');
  await sync(`for(let i=0;i<9;i++)document.querySelector('.session-filter-toggle').click();`);
  await idle();
  assert.equal((await view()).hidden,true);
  await assertMatches('');
  assert.deepEqual(await state(),original,'Filtering and rapid toggles never modify stored records');
  assert.deepEqual(await csv(),originalCSV,'Filtering preserves exact CSV backup bytes');

  await toggle(); await select(seeded.first.id);
  await sync(`document.querySelector('#tab-bean-manager').click();`);
  await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy')==='false'`);
  await openBrews(); await assertMatches(seeded.first.id);
  await evaluate(`const db=await getDB();const bean=(await db.getBeans()).find(bean=>bean.id===${JSON.stringify(seeded.first.id)});
    await db.updateBean(bean.id,{...bean,name:'Renamed filter bean'});await db.addBean({name:'New filter choice'});`);
  await openBrews(); await assertMatches(seeded.first.id);
  assert.equal((await view()).options.find(option=>option.id===seeded.first.id).name,'Renamed filter bean');
  assert.ok((await view()).options.some(option=>option.name==='New filter choice'));

  await sync(`document.querySelector('[data-session-id="${seeded.records[0].id}"] .session-summary').click();`);
  await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy')==='false'`);
  await sync(`document.querySelector('.cancel-session').click();`);
  await assertMatches(seeded.first.id);
  await sync(`document.querySelector('[data-session-id="${seeded.records[0].id}"] .session-summary').click();`);
  await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy')==='false'`);
  await sync(`document.querySelector('#session-bean').value=${JSON.stringify(seeded.second.id)};document.querySelector('.session-form').requestSubmit();`);
  await waitFor(`document.querySelector('.session-form').hidden`); await idle();
  await assertMatches(seeded.first.id);
  assert.equal((await view()).ids.length,1,'Moving an edited session to another bean removes it from the filtered list');

  await sync(`document.querySelector('.new-session').click();`);
  await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy')==='false'`);
  await sync(`document.querySelector('#session-bean').value=${JSON.stringify(seeded.first.id)};document.querySelector('.session-form').requestSubmit();`);
  await waitFor(`document.querySelector('.session-form').hidden`); await idle();
  await assertMatches(seeded.first.id);
  assert.equal((await view()).ids.length,2,'New matching sessions appear without clearing the active filter');
  for(const id of (await view()).ids) {
    await sync(`const card=document.querySelector('[data-session-id="${id}"]');card.querySelector('.session-menu').click();card.querySelector('.session-delete').click();`);
    await waitFor(`!document.querySelector('.session-list [data-session-id="${id}"]')`);
    await idle();
  }
  await assertMatches(seeded.first.id);
  assert.equal((await view()).ids.length,0);
  await evaluate(`await (await getDB()).deleteBean(${JSON.stringify(seeded.first.id)});`);
  await openBrews(); await assertMatches('');
  assert.equal((await view()).hidden,false);
  assert.ok(!(await view()).options.some(option=>option.id===seeded.first.id));
  await toggle();
  console.log('PASS session bean filter: native toggle, choices/duplicate names, counts/order/empty results, clear/reopen/races, phone/desktop layout, exact records/backups, navigation and edit/save/delete refresh');
}
