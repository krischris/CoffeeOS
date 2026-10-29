import assert from 'node:assert/strict';
import {startFixtureServer} from './fixture-server.mjs';
import {fixtureBrowser} from './fixture-browser.mjs';
import {durableState} from './startup-checks.mjs';
await import('./prepare-bean-upgrade.mjs');
const browser = await fixtureBrowser();
const host = await startFixtureServer('.cache/bean-upgrade', 'previous');
const {faults} = host;
const {api, sync, evaluate, ready, waitFor} = browser;
const base = 'http://127.0.0.1:5175/CoffeeOS/';
async function checkIsolationWorker() {
  const worker = await fetch(new URL('coi-serviceworker.js', base));
  assert.equal(worker.status, 200);
  assert.match(await worker.text(), /^const offlineBuild = null;$/m, `${faults.build} fault-injection fixture needs an isolation-only worker`);
}
try {
  const response = await fetch(base);
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  await checkIsolationWorker();
  for (const mode of (process.env.TEST_STORAGE_MODES?.split(',') ?? [process.env.TEST_FIREFOX ? 'opfs' : 'indexeddb'])) {
    faults.build = 'previous';
    await browser.open(base);
    if (mode === 'indexeddb') {
      await evaluate(`const db = await getDB(); await db.closeDB();
        const store = await new Promise((resolve, reject) => {const r = indexedDB.open('coffeos-snapshots', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
        await new Promise((resolve, reject) => {const tx = store.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put('indexeddb', 'backend-v1'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);});
        store.close(); await db.initDB();`);
    }
    assert.equal(await evaluate(`return (await getDB()).getStorageMode();`), mode);
    const seeded = await evaluate(`const db = await getDB();
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);
      const bean = await db.addBean({name: 'Old bean ☕', roast_date:'2025-01-02', freeze_date:null, photo_jpeg:canvas.toDataURL('image/jpeg')});
      const other = await db.addBean({name: 'Keep this bean'});
      const values = {dose_g: 15.123456789, water_g: 0, time_str:'', temp_c:null, grind_um:222.222222222,
        comment:'line one\\nline two ☕', yield_g:null, tds_pct:1.123456789, extraction_pct:null};
      for (const bean_id of [bean.id, bean.id, other.id]) await db.addBrewSession({...values, bean_id});
      // The schema-v1 baseline predates archive/recovery APIs and photo columns.
      // Exercise those features only on builds that actually shipped them.
      const recoveries=[],recoveryHashes=[];
      const original=typeof db.captureDriveSnapshot==='function'?await db.captureDriveSnapshot():null;
      const textCSV='id,name,roast_date,freeze_date,created_at\\n"\\t","\\n",\\\\N,\\\\N,2024-01-02T03:04:05.123456Z\\n';
      await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(textCSV)}],{preserveLegacyText:true});
      await db.addBrewSession({...values,bean_id:'\\t'});
      if(original) {
        await db.updateBean(bean.id,{...bean,name:'Old immutable recovery copy'});
        const recoveryFiles=['beans','brew_sessions'].map(target=>({target,name:target+'.parquet',data:original.snapshot.data[target]}));
        await db.mergeBackupData(recoveryFiles,original.snapshot.counts,await db.previewBackupData(recoveryFiles,original.snapshot.counts));
        recoveries.push(...await db.listImportRecoveries());
        if(!recoveries.length)throw Error('Previous build did not retain the overwritten records');
        for(const copy of recoveries)recoveryHashes.push(await db.hashBackupContents((await db.readImportRecovery(copy.key)).data));
      }
      let legacyPhoto=null;
      if('photo_jpeg' in bean) {
        // Current builds reject damaged new uploads; historical import has an
        // explicit preservation path and older builds ignore the extra options.
        const id=crypto.randomUUID();
        const photoCSV='id,name,roast_date,freeze_date,created_at,photo_jpeg\\n'+id+',Previously accepted damaged photo,\\\\N,\\\\N,'+new Date().toISOString()+',"data:image/jpeg;base64,/9j/"\\n';
        await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(photoCSV)}],{preserveLegacyPhotos:true});
        legacyPhoto=(await db.getBeans()).find(value=>value.id===id);
        if(legacyPhoto?.photo_jpeg!=='data:image/jpeg;base64,/9j/')throw Error('Previous build did not preserve the damaged historical photo');
      }
      const backups=[];
      for(const format of ['csv','parquet'])backups.push((await db.exportData(format,false)).map((f,i)=>({target:i?'brew_sessions':'beans',name:f.name,data:Array.from(f.data)})));
      return {bean, other, legacyPhoto, backups, recoveries, recoveryHashes, beans:await db.getBeans(), sessions:await db.getBrewSessions()};`);
    console.log('Seeded previous build:',mode,seeded.beans.length,'beans,',seeded.sessions.length,'sessions,',seeded.recoveries.length,'recoveries');
    await evaluate(`await navigator.serviceWorker.register('./coi-serviceworker.js'); await navigator.serviceWorker.ready;`);
    await evaluate(`await (await getDB()).closeDB();`);
    faults.build = 'candidate';
    await checkIsolationWorker();
    // Establish the current isolation-only fixture policy before opening the
    // candidate. This suite's HTML/network faults intentionally bypass shell
    // caching; the offline suite separately exercises waiting production updates.
    await evaluate(`const reg=await navigator.serviceWorker.getRegistration();await reg.update();const worker=reg.installing||reg.waiting;
      if(worker&&worker.state!=='activated')await new Promise(resolve=>worker.addEventListener('statechange',()=>{if(worker.state==='activated')resolve();}));`);
    await api('/url', {url:'about:blank'});
    // Recent previous builds already migrated photos. Inject migration failures
    // only for legacy fixtures that actually require that migration.
    const needsPhotoMigration = seeded.beans.some(bean => !('photo_jpeg' in bean));
    for (const failure of needsPhotoMigration ? (mode === 'opfs' ? ['copy', 'alter'] : ['copy']) : []) {
      faults.failPhotoMigration = failure;
      await api('/url', {url:base});
      await waitFor(`document.querySelector('.startup-status[role="alert"]')`);
      assert.equal(await evaluate('return (await getDB()).getStorageMode();'), null);
      faults.failPhotoMigration = '';
      faults.build = 'previous';
      await api('/refresh', {}); await ready();
      assert.deepEqual(await evaluate('const db=await getDB();return {beans:await db.getBeans(),sessions:await db.getBrewSessions()};'), {beans:seeded.beans,sessions:seeded.sessions});
      await evaluate('await (await getDB()).closeDB();');
      await api('/url', {url:'about:blank'});
      faults.build = 'candidate';
    }
    faults.failPhotoMigration = '';
    await api('/url', {url:base}); await ready();
    await evaluate(`const reg = await navigator.serviceWorker.getRegistration(); await reg.update();
      const worker = reg.installing || reg.waiting;
      if (worker && worker.state !== 'activated') await new Promise(resolve => worker.addEventListener('statechange', () => {if(worker.state === 'activated') resolve();}));`);
    await api('/refresh', {}); await ready();
    const state = () => evaluate(`const db = await getDB(); return {beans:await db.getBeans(), sessions:await db.getBrewSessions()};`);
    const migrated = await state();
    const migratedById = new Map(migrated.beans.map(bean=>[bean.id,bean]));
    const expected = {beans:seeded.beans.map(bean => ({photo_jpeg:null, photo_webp:null, ...bean,
      ...(migratedById.get(bean.id)?.photo_webp ? {photo_jpeg:null,photo_webp:migratedById.get(bean.id).photo_webp} : {})})), sessions:seeded.sessions};
    const convertsJPEG = Boolean(seeded.bean.photo_jpeg) && !('photo_webp' in seeded.bean);
    if(convertsJPEG) assert.ok(expected.beans.find(bean=>bean.id===seeded.bean.id).photo_webp,'old readable JPEG was converted');
    else assert.deepEqual(expected.beans.find(bean=>bean.id===seeded.bean.id),{photo_jpeg:null,photo_webp:null,...seeded.bean},'already migrated builds preserve photo fields');
    for(const bean of expected.beans)if(bean.photo_webp){
      assert.ok(bean.photo_webp.startsWith('data:image/webp;base64,'));
      assert.ok(Buffer.from(bean.photo_webp.split(',')[1],'base64').length<=100000);
    }
    assert.deepEqual(await state(), expected);
    const recoveryUpgrade=await evaluate(`const db=await getDB();
      const copies=await db.listImportRecoveries(),hashes=[];
      for(const copy of copies)hashes.push(await db.hashBackupContents((await db.readImportRecovery(copy.key)).data));
      return {copies,hashes};`);
    for(const [index,copy]of seeded.recoveries.entries()){
      const found=recoveryUpgrade.copies.findIndex(value=>value.key===copy.key);
      assert.deepEqual(recoveryUpgrade.copies[found],copy,'original recovery metadata');
      assert.equal(recoveryUpgrade.hashes[found],seeded.recoveryHashes[index],'original recovery bytes');
    }
    assert.equal(recoveryUpgrade.copies.length,seeded.recoveries.length+(convertsJPEG?1:0),'only a JPEG conversion adds a downloadable recovery');
    await api('/refresh', {}); await ready(); assert.deepEqual(await state(), expected);
    if(seeded.beans.every(bean=>'photo_jpeg' in bean)) {
      const hashes=await evaluate(`const db=await getDB();const files=${JSON.stringify(seeded.backups[1])};
        return [await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data),await db.hashBackupContents({beans:new Uint8Array(files[0].data),brew_sessions:new Uint8Array(files[1].data)})];`);
      if(convertsJPEG) assert.notEqual(hashes[0],hashes[1],'explicit JPEG conversion changes only photo representation');
      else assert.equal(hashes[0],hashes[1],'recent-build content fingerprint is unchanged');
    }
    for (const backup of seeded.backups) {
      await evaluate(`await (await getDB()).importData(${JSON.stringify(backup)}.map(f => ({...f, data:new Uint8Array(f.data)})),{preserveLegacyPhotos:true,preserveLegacyText:true});`);
      expected.beans=expected.beans.map(bean=>({...bean,photo_jpeg:seeded.beans.find(old=>old.id===bean.id).photo_jpeg??null}));
      assert.deepEqual(await state(), expected);
    }
    const legacyExport=await evaluate(`const b=await getBackups();return (await b.prepareBackup((await b.saveBackup()).data)).manifest.format_version;`);
    assert.equal(legacyExport,4,'previous-build whitespace fields and damaged photos export readable format 4');
    await evaluate(`const b=await getBackups(),db=await getDB();const saved=await b.saveBackup(),hash=await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data);await b.replaceBackup(await b.prepareBackup(saved.data));if(await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data)!==hash)throw Error('v3 upgrade roundtrip changed records');`);
    if(seeded.legacyPhoto) {
      await evaluate(`await (await getDB()).deleteBean('${seeded.legacyPhoto.id}');`);
      expected.beans=expected.beans.filter(bean=>bean.id!==seeded.legacyPhoto.id);
      seeded.beans=seeded.beans.filter(bean=>bean.id!==seeded.legacyPhoto.id);
    }
    console.log('PASS previous-build photo fields survive replacement/reload, old CSV/Parquet imports and format 4 export; JPEG conversion:',convertsJPEG);
    await evaluate(`await (await getDB()).closeDB();`);
    const beforeFailure = await durableState(evaluate);
    faults.failStartup = true;
    try {
      await api('/url', {url:'about:blank'});
      await api('/url', {url:base + '?failure=startup'});
      await waitFor(`document.querySelector('.startup-status[role="alert"]')`);
      assert.match(await sync(`return document.querySelector('.startup-status[role="alert"]').textContent;`), /reload|storage/i);
      assert.equal(await evaluate(`return (await getDB()).getStorageMode();`), null);
      await sync('indexedDB.open=window.__nativeIndexedDBOpen;');
      assert.deepEqual(await durableState(evaluate), beforeFailure, 'failed upgrade preserves durable bytes');
    } finally { faults.failStartup = false; }
    await api('/url', {url:base}); await ready();
    assert.deepEqual(await state(),expected);
    const lock = await evaluate(`const db=await getDB();await db.closeDB();
      let release; let acquired; const held=new Promise(resolve=>acquired=resolve);
      const request=navigator.locks.request('coffeos-database',async()=>{acquired();await new Promise(resolve=>release=resolve);});await held;
      try{try{await db.initDB();return false;}catch{return db.getStorageMode()===null;}}
      finally{release();await request;}`);
    assert.equal(lock,true);await api('/refresh',{});await ready();assert.deepEqual(await state(),expected);
    // Compatibility values remained present through every failed-startup probe.
    await evaluate(`await (await getDB()).deleteBean('\\t');`);
    expected.beans=expected.beans.filter(bean=>bean.id!=='\t');
    expected.sessions=expected.sessions.filter(item=>item.bean_id!=='\t');
    const added = await evaluate(`const db=await getDB();const bean=await db.addBean({name:'After upgrade'});
      const session=await db.addBrewSession({bean_id:bean.id,dose_g:null,water_g:null,time_str:null,temp_c:null,grind_um:null,comment:'new',yield_g:null,tds_pct:null,extraction_pct:null});return {bean,session};`);
    expected.beans.unshift(added.bean); expected.sessions.unshift({...added.session, bean_name:added.bean.name});
    await evaluate(`const db=await getDB();await db.updateBean(${JSON.stringify(added.bean.id)},{...${JSON.stringify(added.bean)},name:'Edited after upgrade'});`);
    expected.beans=expected.beans.map(bean=>bean.id===added.bean.id?{...bean,name:'Edited after upgrade'}:bean);
    expected.sessions=expected.sessions.map(item=>item.bean_id===added.bean.id?{...item,bean_name:'Edited after upgrade'}:item);
    await api('/refresh',{});await ready();assert.deepEqual(await state(),expected);
    await evaluate(`await (await getDB()).deleteBean(${JSON.stringify(added.bean.id)});`);
    expected.beans=expected.beans.filter(bean=>bean.id!==added.bean.id);
    expected.sessions=expected.sessions.filter(item=>item.bean_id!==added.bean.id);
    await api('/refresh',{});await ready();assert.deepEqual(await state(),expected);
    console.log('PASS', mode, 'previous-build compatibility, exact fields/recoveries, old CSV/Parquet, failed migration/open, lock and edit/write/delete/reload');
    await browser.close();
  }
} finally {
  try {await browser.close();} finally {await host.close();}
}
