import {checkDriveRecoveryView} from './drive-recovery-view-checks.mjs';
import { checkReviewRemediation, checkHistoryScale, checkRuntimeWorkerFailure } from './review-remediation-checks.mjs';
import { checkDriveRestore } from './drive-restore-checks.mjs';
import { checkSwipeRows } from './swipe-row-checks.mjs';
import { checkBackupUpgrade } from './backup-upgrade-checks.mjs';
import { checkSessionEditing } from './session-edit-checks.mjs';
import { checkSessionDeletion } from './session-delete-checks.mjs';
import { photoChecks } from './photo-checks.mjs';
import { checkBeanManager } from './bean-manager-checks.mjs';
import { checkBeanEditing } from './bean-edit-checks.mjs';
import { firefoxAdapter } from './firefox-upgrade-adapter.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
let build = 'previous';
let failStartup = false;
let failPhotoMigration = '';
let failWorker = '';
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm'};
const server = createServer(async (req, res) => {
  try {
    const requested = new URL(req.url, 'http://localhost');
    const path = requested.pathname;
    if (!path.startsWith('/CoffeeOS/')) { res.writeHead(404).end(); return; }
    const relative = path.slice('/CoffeeOS/'.length) || 'index.html';
    let data = await readFile(resolve('.cache/bean-upgrade', build, relative));
    // This matrix injects network HTML/worker startup faults. Use the isolation
    // template here so an intentional immutable shell cannot hide those probes.
    // offline-browser.mjs verifies actual production worker/build replacement.
    if (relative === 'coi-serviceworker.js') data = await readFile('public/coi-serviceworker.js');
    if (relative.includes('.worker-') && requested.searchParams.has('startup-failure')) {
      data = Buffer.from(requested.searchParams.get('startup-failure') === 'error' ? "throw new Error('Injected database worker load failure');" : '');
    }
    if (relative === 'index.html' && failWorker) data = Buffer.from(data.toString().replace('<head>', `<head><script>
      const RealWorker=Worker;window.Worker=class extends RealWorker{constructor(url,options){const target=new URL(url,location.href);let injected;
        if(target.protocol==='blob:')injected=URL.createObjectURL(new Blob([${JSON.stringify(failWorker === 'error' ? "throw new Error('Injected database worker load failure');" : '')}],{type:'text/javascript'}));
        else target.searchParams.set('startup-failure','${failWorker}');super(injected||target,options);if(injected)URL.revokeObjectURL(injected);if('${failWorker}'==='message')setTimeout(()=>this.dispatchEvent(new MessageEvent('messageerror')),0);}};
      const realTimeout=window.setTimeout;window.setTimeout=(fn,delay,...args)=>realTimeout(fn,delay===120000?100:delay,...args);
    </script>`));
    if (relative === 'index.html' && failStartup) data = Buffer.from(data.toString().replace('<head>', "<head><script>indexedDB.open = () => {throw new Error('Injected upgrade permission failure');};</script>"));
    if (relative === 'index.html' && failPhotoMigration) data = Buffer.from(data.toString().replace('<head>', `<head><script>window.__failPhotoMigration=${failPhotoMigration === 'alter'}; const put=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(value,key){if(${failPhotoMigration === 'copy'} && key==='schema-v1-before-photos') throw new Error('Injected recovery-copy failure');return put.call(this,value,key);};</script>`));
    res.writeHead(200, {'Content-Type': mime[extname(relative)] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store'});
    res.end(relative === 'coi-serviceworker.js' ? Buffer.concat([data, Buffer.from('\n// Upgrade fixture: ' + build)]) : data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5175, '127.0.0.1', resolve); });
await import('./prepare-bean-upgrade.mjs');
import assert from 'node:assert/strict';
// Start safaridriver and Vite first; Safari uses an isolated automation session.
const endpoint = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4444';
const base = 'http://127.0.0.1:5175/CoffeeOS/';
const response = await fetch(base);
assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
async function checkIsolationWorker() {
  const worker = await fetch(new URL('coi-serviceworker.js', base));
  assert.equal(worker.status, 200);
  assert.match(await worker.text(), /^const offlineBuild = null;$/m, `${build} fault-injection fixture needs an isolation-only worker`);
}
await checkIsolationWorker();
let session;
const firefoxRequest = process.env.TEST_FIREFOX ? await firefoxAdapter() : null;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  if (firefoxRequest) return firefoxRequest(path, body, method);
  const response = await fetch(endpoint + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
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
      const getDB = async () => window.__testDB;
      const getBackups = async () => window.__testBackups;
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
      startupError: document.querySelector('.startup-status[role="alert"]')?.textContent };`);
    if (state.startupError) throw new Error(state.startupError + JSON.stringify(await sync('return window.__startupErrors;')));
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
try {
  for (const mode of (process.env.TEST_STORAGE_MODES?.split(',') ?? [process.env.TEST_FIREFOX ? 'opfs' : 'indexeddb'])) {
    build = 'previous';
    const created = await request('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
    session = created.sessionId;
    await api('/timeouts', { script: 120_000, pageLoad: 45_000 });
    await api('/url', {url: base}); await ready();
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
    build = 'candidate';
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
      failPhotoMigration = failure;
      await api('/url', {url:base});
      await waitFor(`document.querySelector('.startup-status[role="alert"]')`);
      assert.equal(await evaluate('return (await getDB()).getStorageMode();'), null);
      failPhotoMigration = '';
      build = 'previous';
      await api('/refresh', {}); await ready();
      assert.deepEqual(await evaluate('const db=await getDB();return {beans:await db.getBeans(),sessions:await db.getBrewSessions()};'), {beans:seeded.beans,sessions:seeded.sessions});
      await evaluate('await (await getDB()).closeDB();');
      await api('/url', {url:'about:blank'});
      build = 'candidate';
    }
    failPhotoMigration = '';
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
    // Storage loss on the candidate must reject opening the previous data.
    const blocked = await evaluate(`const db = await getDB(); await db.closeDB();
      const original = ${mode === 'opfs' ? 'navigator.storage.getDirectory' : 'IDBObjectStore.prototype.get'};
      try {
        ${mode === 'opfs' ? "Object.defineProperty(navigator.storage, 'getDirectory', {configurable:true, value:undefined});" : "IDBObjectStore.prototype.get = function () {throw new Error('Injected snapshot read failure');};"}
        try {await db.initDB(); return false;} catch {return true;}
      } finally {
        ${mode === 'opfs' ? "Object.defineProperty(navigator.storage, 'getDirectory', {configurable:true, value:original});" : 'IDBObjectStore.prototype.get = original;'}
      }`);
    assert.equal(blocked, true); await api('/refresh', {}); await ready(); assert.deepEqual(await state(), expected);
    // Every injected startup failure must leave the engine unavailable and the
    // exact previous-build collection recoverable on retry.
    const failures = [
      ["unsupported stored schema", "const saved = window.__testConnection.prototype.query; window.__testConnection.prototype.query = function(sql){if(sql.startsWith('DESCRIBE SELECT')) return Promise.resolve({toArray:()=>[{column_name:'future',column_type:'VARCHAR'}]});return saved.call(this,sql);};", "window.__testConnection.prototype.query = saved;"],
      ["IndexedDB open", "const saved = indexedDB.open; indexedDB.open = () => {throw new Error('denied');};", "indexedDB.open = saved;"],
      ["unknown backend", "const saved = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function(key) {return saved.call(this, key === 'backend-v1' ? 'future-backend-test' : key);};", "IDBObjectStore.prototype.get = saved;"],
    ];
    await evaluate(`const store = await new Promise((resolve,reject) => {const r=indexedDB.open('coffeos-snapshots',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject)=>{const tx=store.transaction('snapshots','readwrite');tx.objectStore('snapshots').put('future-backend','future-backend-test');tx.objectStore('snapshots').put({beans:new Uint8Array([1,2,3]),brew_sessions:new Uint8Array([4,5])},'corrupt-test');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});store.close();`);
    if (mode === 'opfs') failures.push(
      ["lost isolation", "Object.defineProperty(window,'crossOriginIsolated',{configurable:true,value:false});", "delete window.crossOriginIsolated;"],
      ["OPFS permission", "const saved = navigator.storage.getDirectory; navigator.storage.getDirectory = async () => {throw new DOMException('denied','NotAllowedError');};", "navigator.storage.getDirectory = saved;"],
      ["missing remembered file", "const saved = FileSystemDirectoryHandle.prototype.getFileHandle; FileSystemDirectoryHandle.prototype.getFileHandle = async function(){throw new DOMException('missing','NotFoundError');};", "FileSystemDirectoryHandle.prototype.getFileHandle = saved;"],
    );
    if (mode === 'indexeddb') failures.push(
      ["missing snapshot", "const saved = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function(key){return saved.call(this,key === 'tables-v1' ? 'absent-test' : key);};", "IDBObjectStore.prototype.get = saved;"],
      ["unsupported snapshot", "const saved = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function(key){return saved.call(this,key === 'tables-v1' ? 'future-backend-test' : key);};", "IDBObjectStore.prototype.get = saved;"],
      ["corrupt Parquet", "const saved = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function(key){return saved.call(this,key === 'tables-v1' ? 'corrupt-test' : key);};", "IDBObjectStore.prototype.get = saved;"],
      ["interrupted restore", "const saved = window.__testConnection.prototype.query; window.__testConnection.prototype.query = function(sql){if(sql.startsWith('INSERT INTO brew_sessions BY NAME SELECT')) return Promise.reject(new Error('restore interrupted')); return saved.call(this,sql);};", "window.__testConnection.prototype.query = saved;"],
    );
    const durable = () => evaluate(`const db=await getDB(); await db.closeDB();
      const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
      const store=await new Promise((resolve,reject)=>{const r=indexedDB.open('coffeos-snapshots',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const read=key=>new Promise((resolve,reject)=>{const r=store.transaction('snapshots').objectStore('snapshots').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const backend=await read('backend-v1');const snapshot=await read('tables-v1');store.close();
      const result={backend};if(snapshot) for(const table of ['beans','brew_sessions']) result[table]=await digest(snapshot[table]);
      if(backend==='opfs'){const root=await navigator.storage.getDirectory();for(const name of ['coffeos.db','coffeos.db.wal'])result[name]=await digest(await (await (await root.getFileHandle(name)).getFile()).arrayBuffer());}
      return result;`);
    for (const failure of ['error', 'message', 'silent']) {
      const before = await durable();
      failWorker = failure;
      await api('/refresh', {});
      await waitFor(`document.querySelector('.startup-status[role="alert"]')`);
      const result = await sync(`return {mode:window.__testDB.getStorageMode(),busy:document.querySelector('#app').getAttribute('aria-busy'),
        message:document.querySelector('.startup-message').textContent,report:document.querySelector('#startup-report').value};`);
      assert.equal(result.mode, null); assert.equal(result.busy, 'false');
      assert.match(result.message, failure === 'silent' ? /stopped responding/ : /worker could not load/);
      assert.match(result.report, /Phase: Loading the database worker and Wasm/);
      assert.deepEqual(await durable(), before, failure + ' worker failure preserved durable bytes');
      failWorker = '';
      const previousDocument = await sync(`return window.__startupDocument;`);
      await sync(`document.querySelector('.startup-reload').click();`);
      await waitFor(`window.__startupDocument && window.__startupDocument !== ${JSON.stringify(previousDocument)}`);
      await ready();
      assert.deepEqual(await state(), expected, failure + ' worker retry preserved exact records');
      console.log('PASS worker', failure, 'exits startup, preserves durable bytes and reload recovers exact records');
    }
    for (const [name, inject, restore] of failures) {
      const before = await durable();
      const outcome = await evaluate(`const db=await getDB();await db.closeDB();${inject}
        try {try {await db.initDB();return {rejected:false};} catch(error){return {rejected:true,mode:db.getStorageMode(),message:String(error)};}}
        finally {${restore}}`);
      assert.equal(outcome.rejected,true,name); assert.equal(outcome.mode,null,name);
      assert.deepEqual(await durable(),before,name + ' durable bytes');
      await api('/refresh',{}); await ready(); assert.deepEqual(await state(),expected,name);
      console.log('PASS preserved previous-build data after',name);
    }
    const slowLoading = await evaluate(`const box=document.createElement('section');document.body.append(box);
      const originalNow=performance.now;const start=originalNow.call(performance);
      const view=window.__testStartupView(box,()=> 'Reading the saved backend and snapshot');
      try {
        Object.defineProperty(performance,'now',{configurable:true,value:()=>start+11000});
        await new Promise(resolve=>setTimeout(resolve,600));
        return {visible:!box.querySelector('.startup-help').hidden,busy:box.getAttribute('aria-busy'),
          phase:box.querySelector('.startup-phase').textContent,report:box.querySelector('#startup-report').value};
      } finally {view.ready();delete performance.now;box.remove();}`);
    assert.equal(slowLoading.visible,true); assert.equal(slowLoading.busy,'true');
    assert.match(slowLoading.report,/Phase: Reading the saved backend and snapshot/);
    assert.match(slowLoading.report,/Isolated: true/);
    console.log('PASS slow startup exposes read-only phase/details while database opening remains pending');
    await evaluate(`await (await getDB()).closeDB();`);
    failStartup = true;
    try {
      await api('/url', {url:'about:blank'});
      await api('/url', {url:base + '?failure=startup'});
      await waitFor(`document.querySelector('.startup-status[role="alert"]')`);
      assert.match(await sync(`return document.querySelector('.startup-status[role="alert"]').textContent;`), /reload|storage/i);
      assert.equal(await evaluate(`return (await getDB()).getStorageMode();`), null);
    } finally { failStartup = false; }
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
    seeded.beans = expected.beans; seeded.sessions = expected.sessions;
    await api('/refresh',{});await ready();assert.deepEqual(await state(),expected);
    await openBeans();
    await checkBeanManager({sync, api, waitFor});
    await checkSwipeRows({sync, evaluate, waitFor, api});
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
    await checkSessionEditing({sync,evaluate,waitFor,api,ready});
    await checkSessionDeletion({sync,evaluate,waitFor,api,ready});
    await checkBeanEditing({sync,evaluate,waitFor,api,ready});
    await photoChecks({sync,evaluate,waitFor,openBeans,api,ready,state});
    await checkBackupUpgrade({sync,evaluate,waitFor,api,ready,state});
    await checkDriveRestore({evaluate,api,ready});
    await checkReviewRemediation({sync,evaluate,waitFor,api,ready});
    await checkHistoryScale({sync,evaluate,waitFor});
    await checkDriveRecoveryView({evaluate});
    await checkRuntimeWorkerFailure({evaluate});
    console.log('PASS', mode, 'previous-build upgrade at /CoffeeOS/, exact fields, old CSV/Parquet, failed open preservation, collapse/swipe/delete/reload', mode === 'indexeddb' ? 'and failed-delete rollback' : '');
    await api('', undefined, 'DELETE'); session = undefined;
  }
} finally {
  if (session) await api('', undefined, 'DELETE');
  server.close();
}
