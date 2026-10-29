import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { firefoxAdapter } from './firefox-upgrade-adapter.mjs';

// Production build replacement at a stable origin/profile, followed by cold
// launches with the entire origin unavailable. Never use a normal browser profile.
process.env.TEST_PREVIOUS_REF ??= '6ec3ef8';
await import('./prepare-bean-upgrade.mjs');
const root = resolve('.cache/bean-upgrade');
const source = resolve(root, 'candidate-source');
const indexPath = resolve(source, 'index.html');
const index = (await readFile(indexPath, 'utf8')).replace('<head>', `<head><script>
  window.__offlineWorkerErrors=[];
  const OfflineRealWorker=Worker;
  window.Worker=class extends OfflineRealWorker {constructor(url,options){super(url,options);this.addEventListener('error',event=>window.__offlineWorkerErrors.push({url:String(url),message:event.message,filename:event.filename}));}};
  if(sessionStorage.getItem('offline-test-storage-failure')) {
    window.__offlineOriginalGet=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(){throw new Error('Injected offline metadata read failure');};
  }
</script>`);
const workerPath = resolve(source, 'public/coi-serviceworker.js');
const worker = await readFile(workerPath, 'utf8');
function build(folder) {
  execFileSync('uv', ['run', 'node', resolve('node_modules/vite/bin/vite.js'), 'build', source, '--outDir', '../' + folder], { stdio: 'pipe' });
}
await writeFile(indexPath, index);
build('candidate');
await writeFile(indexPath, index.replace('<head>', '<head><meta name="offline-test-build" content="next">'));
build('offline-next');
await writeFile(workerPath, worker.replace('const bytes = await response.arrayBuffer();', `
  if(file.path.includes('.worker-')) throw new DOMException('Injected shell quota failure','QuotaExceededError');
  const bytes = await response.arrayBuffer();`));
build('offline-quota');
await writeFile(workerPath, worker);

const manifests = {};
for (const name of ['candidate', 'offline-next', 'offline-quota']) {
  const text = await readFile(resolve(root, name, 'coi-serviceworker.js'), 'utf8');
  manifests[name] = JSON.parse(text.match(/^const offlineBuild = (.+);$/m)[1]);
}
const prefix = '/CoffeeOS/';
let served = 'previous', offline = false, failedAsset = '', failedKind = '', blocked = 0;
const workerRequests = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  if (offline) { blocked++; req.socket.destroy(); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    const path = url.pathname.slice(prefix.length) || 'index.html';
    if (path.includes('.worker-') || path.endsWith('.wasm')) workerRequests.push({ path, served, destination: req.headers['sec-fetch-dest'] });
    if (path.includes('..')) { res.writeHead(400).end(); return; }
    if (path === failedAsset) {
      if (failedKind === 'network') { req.socket.destroy(); return; }
      if (failedKind === 'missing') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end('corrupt build bytes');
      return;
    }
    const data = await readFile(resolve(root, served, path));
    const headers = { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
    // The old build seeds OPFS with host isolation. Every new build simulates
    // Pages with NO host isolation headers: the actual worker must provide them.
    if (served === 'previous') Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    res.writeHead(200, headers).end(data);
  } catch (error) { console.log('Origin request failed', req.url, String(error)); res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5177, '127.0.0.1', resolve); });
const base = 'http://127.0.0.1:5177/CoffeeOS/';
const endpoint = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4444';
const firefox = process.env.TEST_FIREFOX ? await firefoxAdapter() : null;
let session;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  if (firefox) return firefox(path, body, method);
  const response = await fetch(endpoint + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw new Error(JSON.stringify(value));
  return value;
}
const api = (path, body, method) => request('/session/' + session + path, body, method);
const sync = script => api('/execute/sync', { script, args: [] });
const evaluate = script => api('/execute/async', { script: `const done=arguments[arguments.length-1];(async()=>{${script}})().then(value=>done({value}),error=>done({error:String(error),stack:error.stack}));`, args: [] }).then(result => {
  if (result.error) throw new Error(JSON.stringify(result));
  return result.value;
});
async function wait(expression) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await sync('return Boolean(' + expression + ');')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out: ' + expression + ' ' + JSON.stringify(await sync(`return {html:document.querySelector('#app')?.innerHTML.slice(0,1200),status:window.coffeeosOffline};`)));
}
async function ready() {
  await wait(`document.querySelector('#app')?.getAttribute('aria-busy')==='false'`);
  const failure = await sync(`return document.querySelector('.startup-status[role="alert"]')?.textContent;`);
  if (failure) console.log('Startup diagnostics', workerRequests, await sync(`return {report:document.querySelector('#startup-report')?.value,workers:window.__offlineWorkerErrors,errors:window.__startupErrors,resources:performance.getEntriesByType('resource').map(r=>({url:r.name,size:r.transferSize}))};`));
  assert.ok(failure == null, failure);
  assert.equal(await sync('return crossOriginIsolated;'), true);
}
const state = () => evaluate(`const db=window.__testDB;return {beans:await db.getBeans(),sessions:await db.getBrewSessions(),hash:await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data)};`);
async function coldLaunch(url = base) {
  await evaluate('await window.__testDB.closeDB();');
  // Actually close the old window. Merely navigating to about:blank can keep
  // a controlled document in Firefox's back/forward cache and block activation.
  const old = await api('/window');
  const next = await api('/window/new', {type:'tab'});
  await api('/window', {handle:old});
  await api('/window', undefined, 'DELETE');
  await api('/window', {handle:next.handle});
  await api('/url', { url });
  await ready();
  if (offline) await wait(`window.coffeeosOffline?.state==='ready'`);
}
async function updateState() {
  return evaluate(`const reg=await navigator.serviceWorker.getRegistration();const worker=reg.installing||reg.waiting;
    if(!worker)return {state:'none',active:reg.active?.scriptURL};
    if(!['installed','redundant','activated'].includes(worker.state))await new Promise(resolve=>worker.addEventListener('statechange',()=>{if(['installed','redundant','activated'].includes(worker.state))resolve();}));
    return {state:worker.state,waiting:Boolean(reg.waiting)};`);
}
async function cacheKeys() { return evaluate('return await caches.keys();'); }
const shellName = name => 'coffeeos-shell:' + base + ':' + manifests[name].id;

try {
  const created = await request('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  session = created.sessionId;
  console.log('Offline production upgrade:', process.env.TEST_FIREFOX ? 'Firefox / OPFS' : 'Safari / IndexedDB', 'previous', process.env.TEST_PREVIOUS_REF);
  await api('/timeouts', { script: 120_000, pageLoad: 45_000 });
  await api('/url', { url: base }); await ready();
  const mode = await evaluate('return window.__testDB.getStorageMode();');
  assert.equal(mode, process.env.TEST_FIREFOX ? 'opfs' : 'indexeddb');
  const seeded = await evaluate(`const db=window.__testDB;
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);
    const bean=await db.addBean({name:'Before offline ☕',roast_date:'2025-01-02',freeze_date:null,photo_jpeg:canvas.toDataURL('image/jpeg')});
    await db.addBean({name:'No sessions',roast_date:null,freeze_date:null});
    const brew=await db.addBrewSession({bean_id:bean.id,dose_g:18.123456789,water_g:0,time_str:'',temp_c:null,grind_um:222.222222222,comment:'Unicode ☕\\nquote " and literal \\\\N',yield_g:null,tds_pct:1.123456789,extraction_pct:null});
    await db.updateBrewSession(brew.id,{...brew,brewed_at:'2024-01-02T03:04:05.123456Z'});
    const line=String.fromCharCode(10),nullField=String.fromCharCode(92)+'N';
    await db.importData([{target:'beans',name:'precision.csv',data:new TextEncoder().encode('id,name,roast_date,freeze_date,created_at'+line+[bean.id,'Before offline ☕','2025-01-02',nullField,'2024-01-02T03:04:05.654321Z'].join(',')+line)}]);
    const original=await db.captureDriveSnapshot();
    await db.updateBean(bean.id,{...bean,name:'Immutable recovery before offline'});
    const files=['beans','brew_sessions'].map(target=>({target,name:target+'.parquet',data:original.snapshot.data[target]}));
    await db.mergeBackupData(files,original.snapshot.counts,await db.previewBackupData(files,original.snapshot.counts));
    const recoveries=await db.listImportRecoveries(),recoveryHashes=[];
    for(const recovery of recoveries)recoveryHashes.push(await db.hashBackupContents((await db.readImportRecovery(recovery.key)).data));
    const backups=[];
    for(const format of ['csv','parquet'])backups.push((await db.exportData(format,false)).map((f,i)=>({...f,target:i?'brew_sessions':'beans',data:Array.from(f.data)})));
    return {backups,recoveries,recoveryHashes,beans:await db.getBeans(),sessions:await db.getBrewSessions(),hash:await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data)};`);
  let expected = { beans: seeded.beans, sessions: seeded.sessions, hash:seeded.hash };
  await evaluate(`await caches.open('unrelated-site-cache');await caches.open('coffeeos-shell:'+location.origin+'/another-app/:old');await caches.open('coffeeos-shell:'+new URL('./',location.href).href+':obsolete');
    await navigator.serviceWorker.register('./coi-serviceworker.js');await navigator.serviceWorker.ready;`);
  await wait('navigator.serviceWorker.controller');
  await evaluate('await window.__testDB.closeDB();');
  await api('/url', { url: 'about:blank' });
  served = 'candidate';
  await api('/url', { url: base }); await ready();
  const upgraded=await state();
  const withoutPhotos=beans=>beans.map(({photo_jpeg,photo_webp,...bean})=>bean);
  assert.deepEqual(withoutPhotos(upgraded.beans),withoutPhotos(seeded.beans));
  assert.deepEqual(upgraded.sessions,seeded.sessions);
  const converted=upgraded.beans.find(bean=>bean.id===seeded.beans.find(bean=>bean.photo_jpeg).id);
  assert.equal(converted.photo_jpeg,null);assert.ok(converted.photo_webp.startsWith('data:image/webp;base64,'));
  assert.ok(Buffer.from(converted.photo_webp.split(',')[1],'base64').length<=100000);
  expected=upgraded;
  await evaluate('const reg=await navigator.serviceWorker.getRegistration();await reg.update();');
  const installed = await updateState();
  assert.equal(installed.state, 'installed');
  const documentID = await sync('return window.__startupDocument;');
  await sync(`document.querySelector('#tab-bean-manager').click();document.querySelector('.add-bean-toggle').click();document.querySelector('#bean-name').value='Keep my draft';`);
  assert.equal(await sync('return window.__startupDocument;'), documentID);
  assert.equal(await sync(`return document.querySelector('#bean-name').value;`), 'Keep my draft');
  assert.deepEqual(await state(), expected);
  console.log('PASS previous-build records and an open draft survive complete offline installation without forced reload');
  await coldLaunch();
  await wait(`window.coffeeosOffline?.state==='ready'`);
  assert.deepEqual(await state(), expected);
  assert.equal(await evaluate('return window.__testDB.getStorageMode();'), mode);
  // Public record dates show milliseconds; the logical fingerprint above reads
  // full microsecond timestamps and binary64 bits directly from Parquet.
  assert.ok(new TextDecoder().decode(new Uint8Array(seeded.backups[0][0].data)).includes('.654321'));
  assert.ok(new TextDecoder().decode(new Uint8Array(seeded.backups[0][1].data)).includes('.123456'));
  const recoveryState=await evaluate(`const db=window.__testDB,recoveries=await db.listImportRecoveries(),recoveryHashes=[];for(const recovery of recoveries)recoveryHashes.push(await db.hashBackupContents((await db.readImportRecovery(recovery.key)).data));return {recoveries,recoveryHashes};`);
  for(const [index,copy]of seeded.recoveries.entries()){
    const found=recoveryState.recoveries.findIndex(value=>value.key===copy.key);
    assert.deepEqual(recoveryState.recoveries[found],copy);assert.equal(recoveryState.recoveryHashes[found],seeded.recoveryHashes[index]);
  }
  assert.ok(recoveryState.recoveries.length>seeded.recoveries.length,'pre-conversion recovery added');
  for (const backup of seeded.backups) {
    await evaluate(`await window.__testDB.importData(${JSON.stringify(backup)}.map(file=>({...file,data:new Uint8Array(file.data)})));`);
    const imported=await state();
    assert.deepEqual(imported.beans,expected.beans.map(bean=>({...bean,photo_jpeg:seeded.beans.find(old=>old.id===bean.id).photo_jpeg??null})));
    assert.deepEqual(imported.sessions,expected.sessions);expected=imported;
  }
  const cacheManifest = await evaluate(`const names=await caches.keys(),name=names.find(name=>name.endsWith('${manifests.candidate.id}'));const cache=await caches.open(name);return (await cache.keys()).map(r=>new URL(r.url).pathname);`);
  assert.equal(cacheManifest.length, manifests.candidate.files.length + 1);
  for (const file of manifests.candidate.files) assert.ok(cacheManifest.includes(prefix + file.path), file.path);
  console.log('PASS complete scoped production cache, same backend, old CSV/Parquet and exact populated upgrade records');

  offline = true;
  await coldLaunch(base + '?offline=1');
  assert.deepEqual(await state(), expected);
  await sync(`document.querySelector('#tab-bean-manager').click();`);
  await wait(`document.querySelector('.bean-list')?.getAttribute('aria-busy')==='false'`);
  await sync(`document.querySelector('.add-bean-toggle').click();document.querySelector('#bean-name').value='Offline WebP';`);
  await evaluate(`const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;canvas.getContext('2d').fillRect(0,0,64,48);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'offline.png',{type:'image/png'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  await wait(`document.querySelector('.photo-status').textContent.includes('WebP ready')`);
  await sync(`document.querySelector('.bean-form').requestSubmit();`);
  await wait(`document.querySelector('.bean-form .form-message').textContent==='Added Offline WebP.'`);
  const offlinePhoto=(await state()).beans.find(bean=>bean.name==='Offline WebP');
  assert.ok(offlinePhoto.photo_webp.startsWith('data:image/webp;base64,'));assert.equal(offlinePhoto.photo_jpeg,null);
  assert.ok(Buffer.from(offlinePhoto.photo_webp.split(',')[1],'base64').length<=100000);
  console.log('PASS cold offline selection/encoding/save uses bundled WebP JavaScript/Wasm with all origin traffic disconnected');
  await sync(`document.querySelector('#tab-brew-controller').click();document.querySelector('.new-session').click();`);
  await wait(`document.querySelector('.session-form')?.getAttribute('aria-busy')==='false'`);
  await sync(`const form=document.querySelector('.session-form');for(const [key,value]of Object.entries({bean_id:${JSON.stringify(seeded.beans.find(b => b.name === 'Before offline ☕').id)},dose_g:'17.5',water_g:'250',comment:'Brewed offline ☕'})){form.elements[key].value=value;form.elements[key].dispatchEvent(new Event('input',{bubbles:true}));}form.requestSubmit();`);
  await wait(`document.querySelector('.session-form').hidden`);
  expected = await state();
  assert.equal(expected.sessions.length, seeded.sessions.length + 1);
  assert.ok(expected.sessions.some(session => session.comment === 'Brewed offline ☕'));
  await sync(`document.querySelector('#tab-io').click();document.querySelector('.save-backup').click();`);
  await wait(`!document.querySelector('.export-files').hidden`);
  const archive = await evaluate(`const b=window.__testBackups;const file=await b.saveBackup();const prepared=await b.prepareBackup(file.data);return {size:file.data.length,version:prepared.manifest.format_version};`);
  assert.ok(archive.size > 0); assert.equal(archive.version, 4);
  await coldLaunch(base + 'index.html');
  assert.deepEqual(await state(), expected);
  await sync(`document.querySelector('#tab-bean-manager').click();`);
  await wait(`document.querySelector('.bean-list').getAttribute('aria-busy')==='false'`);
  assert.equal(await sync(`return document.querySelectorAll('.bean-card').length;`), expected.beans.length);
  const privacy = await evaluate(`const r=await fetch('./privacy.html');return {status:r.status,coop:r.headers.get('Cross-Origin-Opener-Policy'),text:(await r.text()).includes('Privacy')};`);
  assert.equal(privacy.status, 200); assert.equal(privacy.coop, 'same-origin');
  const helper = await evaluate(`const r=await fetch('./drive-auth.html');return {status:r.status,coop:r.headers.get('Cross-Origin-Opener-Policy'),coep:r.headers.get('Cross-Origin-Embedder-Policy')};`);
  // Fetch is not a navigation: only a helper document navigation gets the exception.
  assert.equal(helper.status, 200); assert.equal(helper.coop, 'same-origin');
  console.log('PASS offline cold URLs/query, actual brew form save, exact reload persistence, local backup/preview and privacy resources', { mode, archive });

  await sync(`sessionStorage.setItem('offline-test-storage-failure','1');`);
  await evaluate('await window.__testDB.closeDB();');
  await api('/refresh', {});
  await wait(`document.querySelector('.startup-status[role="alert"]')`);
  assert.equal(await evaluate('return window.__testDB.getStorageMode();'), null);
  assert.equal(await sync(`return document.querySelectorAll('.bean-card,.session-card').length;`), 0);
  assert.match(await sync(`return document.querySelector('.startup-status').textContent;`), /saved|storage|kept/i);
  await sync(`sessionStorage.removeItem('offline-test-storage-failure');`);
  await api('/refresh', {}); await ready();
  assert.deepEqual(await state(), expected);
  console.log('PASS failed offline startup reports a recoverable error, exposes no empty collection and preserves every original/offline record on retry');

  offline = false;
  await evaluate(`const cache=await caches.open('${shellName('candidate')}');await cache.delete(new URL('./privacy.html',location.href));`);
  assert.equal(await evaluate(`return (await fetch('./privacy.html')).status;`), 200);
  assert.equal(await evaluate(`const cache=await caches.open('${shellName('candidate')}');return Boolean(await cache.match(new URL('./privacy.html',location.href)));`), true);
  await evaluate(`const cache=await caches.open('${shellName('candidate')}');await cache.delete(new URL('./index.html',location.href));`);
  served = 'offline-next';
  assert.equal(await evaluate(`return (await fetch('./index.html')).status;`), 503);
  assert.deepEqual(await state(), expected);
  served = 'candidate';
  assert.equal(await evaluate(`return (await fetch('./index.html')).status;`), 200);
  console.log('PASS evicted shell files repair from matching bytes; a newer HTML build is rejected rather than mixed into the active shell');

  served = 'offline-next';
  failedAsset = manifests['offline-next'].files.find(file => file.path.includes('.worker-')).path;
  for (const kind of ['missing', 'corrupt', 'network']) {
    failedKind = kind;
    await evaluate('const reg=await navigator.serviceWorker.getRegistration();await reg.update();');
    const failed = await updateState();
    assert.ok(['redundant', 'none'].includes(failed.state), JSON.stringify(failed));
    assert.ok((await cacheKeys()).includes(shellName('candidate')));
    assert.ok(!(await cacheKeys()).includes(shellName('offline-next')));
    assert.deepEqual(await state(), expected);
    offline = true; await coldLaunch(); assert.deepEqual(await state(), expected); offline = false;
    console.log('PASS', kind, 'update preserves the previous complete offline shell and exact records');
  }
  failedAsset = ''; failedKind = '';
  served = 'offline-quota';
  await evaluate('const reg=await navigator.serviceWorker.getRegistration();await reg.update();');
  assert.ok(['redundant', 'none'].includes((await updateState()).state));
  assert.ok(!(await cacheKeys()).includes(shellName('offline-quota')));
  offline = true; await coldLaunch(); assert.deepEqual(await state(), expected); offline = false;
  console.log('PASS injected shell-cache quota failure preserves previous offline launch and data');

  served = 'offline-next';
  await sync(`document.querySelector('#tab-bean-manager').click();document.querySelector('.add-bean-toggle').click();document.querySelector('#bean-name').value='Draft during update';`);
  const beforeUpdate = await sync('return window.__startupDocument;');
  await evaluate('const reg=await navigator.serviceWorker.getRegistration();await reg.update();');
  assert.equal((await updateState()).state, 'installed');
  assert.equal(await sync('return window.__startupDocument;'), beforeUpdate);
  assert.equal(await sync(`return document.querySelector('#bean-name').value;`), 'Draft during update');
  await coldLaunch();
  await wait(`document.querySelector('meta[name="offline-test-build"]')?.content==='next'`);
  await wait(`window.coffeeosOffline?.state==='ready'`);
  assert.deepEqual(await state(), expected);
  const keys = await cacheKeys();
  assert.ok(keys.includes(shellName('candidate')));
  assert.ok(keys.includes(shellName('offline-next')));
  assert.ok(keys.includes('unrelated-site-cache'));
  assert.ok(keys.includes('coffeeos-shell:http://127.0.0.1:5177/another-app/:old'));
  assert.ok(!keys.includes('coffeeos-shell:' + base + ':obsolete'));
  offline = true; await coldLaunch(); assert.deepEqual(await state(), expected);
  console.log('PASS successful update waits for close/reopen, preserves draft/data and the previous shell, prunes only obsolete scoped shell caches, and launches the new build offline', { mode, blockedRequests: blocked });
  await evaluate('await window.__testDB.closeDB();');
  try { await api('/url', {url:base+'drive-auth.html#00000000-0000-4000-8000-000000000000'}); }
  catch(error) { console.log('Helper navigation diagnostics',await sync(`return {url:location.href,title:document.title,isolated:crossOriginIsolated};`));throw error; }
  await wait(`document.querySelector('h1')?.textContent==='Connect Google Drive'`);
  assert.equal(await sync('return crossOriginIsolated;'), false);
  assert.equal(await sync(`return performance.getEntriesByType('resource').some(r=>r.name.includes('accounts.google.com')||r.name.endsWith('.wasm'));`), false);
  await api('/url', {url:base}); await ready(); assert.deepEqual(await state(), expected);
  console.log('PASS cached authorization helper navigation keeps its isolation exception and loads no Google or database resources');

  // A second localhost origin is confirmed first use in this isolated session.
  // It has no old worker or host headers to establish isolation on its behalf.
  offline = false; served = 'candidate';
  const fresh = 'http://localhost:5177/CoffeeOS/';
  await evaluate('await window.__testDB.closeDB();');
  await api('/url', { url: fresh }); await ready();
  await wait(`window.coffeeosOffline?.state==='ready'`);
  assert.equal(await evaluate('return window.__testDB.getStorageMode();'), mode);
  const freshEmpty = await state();
  assert.deepEqual(freshEmpty.beans, []); assert.deepEqual(freshEmpty.sessions, []);
  await evaluate(`await window.__testDB.addBean({name:'Fresh offline install'});`);
  const freshExpected = await state();
  offline = true; await coldLaunch(fresh); assert.deepEqual(await state(), freshExpected);
  await coldLaunch(); assert.deepEqual(await state(), expected);
  console.log('PASS first headerless online visit installs before storage opens, selects the expected backend and cold-launches offline; the other origin collection is untouched');
} finally {
  offline = false;
  if (session) await api('', undefined, 'DELETE');
  await new Promise(resolve => server.close(resolve));
}
