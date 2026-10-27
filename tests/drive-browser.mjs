import { checkDriveRestore } from './drive-restore-checks.mjs';
import { checkDriveFingerprints } from './drive-content-checks.mjs';
import assert from 'node:assert/strict';
import { firefoxAdapter } from './firefox-upgrade-adapter.mjs';
const endpoint = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4444';
const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173/';
const firefox = process.env.TEST_FIREFOX ? await firefoxAdapter() : null;
let session;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  if (firefox) return firefox(path, body, method);
  const response = await fetch(endpoint + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw new Error(JSON.stringify(value)); return value;
}
const api = (path, body, method) => request(`/session/${session}${path}`, body, method);
const sync = script => api('/execute/sync', { script, args: [] });
const evaluate = script => api('/execute/async', { script: `const done=arguments[arguments.length-1];(async()=>{
 const getDB=()=>import(performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/src/db.ts')?.name ?? '/src/db.ts');
 const getBackups=()=>import('/src/backups.ts'); ${script}
 })().then(value=>done({value}),error=>done({error:String(error),stack:error.stack}));`, args: [] }).then(r => { if (r.error) throw new Error(JSON.stringify(r)); return r.value; });
async function wait(expression) {
  for(let i=0;i<150;i++){if(await sync(`return Boolean(${expression})`))return; await new Promise(r=>setTimeout(r,100));} throw new Error('Timed out: '+expression);
}
try {
  session = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })).sessionId;
  await api('/timeouts', { script:120000, pageLoad:45000 });
  if(!firefox) await api('/window/rect',{width:393,height:852});
  await api('/url', { url:base }); await wait(`document.querySelector('#app')?.getAttribute('aria-busy')==='false'`);
  const headers=await fetch(base+'drive-auth.html');
  assert.equal(headers.headers.get('Cross-Origin-Opener-Policy'),'same-origin-allow-popups');
  assert.equal(headers.headers.get('Cross-Origin-Embedder-Policy'),'unsafe-none');
  const checks=await evaluate(`return await (await import('/tests/driveChecks.ts')).runDriveSelfTests();`);
  assert.equal(checks.filter(c=>c.status==='FAIL').length,0,JSON.stringify(checks)); console.log('PASS',checks.length,'simulated adapter safety checks');
  const result=await evaluate(String.raw`
    const db=await getDB(), b=await getBackups(), d=await import('/src/drive.ts');
    const check=(v,m)=>{if(!v)throw new Error(m);};
    const rejects=async(fn,m)=>{let failed=false;try{await fn();}catch{failed=true;}check(failed,m);};
    const state=async()=>JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()});
    const c=new AbortController();
    const initial=await db.captureDriveSnapshot();
    window.__driveCloud=[];window.__drivePosts=0;window.__driveOpens=0;window.__driveHold=false;window.__driveDownloads=0;
    const account={token:'test-only-token',expiresAt:Date.now()+3600000,sub:'test',email:'test@example.invalid'};
    window.__driveTransport=async(url,init={})=>{
      const u=new URL(url);
      const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
      if(u.hostname==='openidconnect.googleapis.com')return json({sub:'test',email:'test@example.invalid',email_verified:true});
      if(init.method==='POST'&&u.pathname.includes('/upload/')){
        window.__drivePosts++;
        window.__uploadMeta=JSON.parse(init.body);window.__uploadBytes=[];
        return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'}});
      }
      if(init.method==='PUT'){
        const bytes=new Uint8Array(await init.body.arrayBuffer());window.__uploadBytes.push(bytes);
        const range=init.headers['Content-Range'].match(/bytes (\d+)-(\d+)\/(\d+)/);
        if(Number(range[2])+1<Number(range[3]))return new Response(null,{status:308,headers:{Range:'bytes=0-'+range[2]}});
        const full=new Uint8Array(Number(range[3]));let offset=0;for(const chunk of window.__uploadBytes){full.set(chunk,offset);offset+=chunk.length;}
        const remote={id:'file-'+window.__drivePosts,createdTime:new Date(Date.now()+window.__drivePosts).toISOString(),size:String(full.length),sha256Checksum:await b.sha256(full),appProperties:window.__uploadMeta.appProperties};
        window.__driveCloud.push({remote,bytes:full});return json(remote);
      }
      if(u.searchParams.get('q')){
        if(u.searchParams.get('q').includes('backups-folder-v1'))return json({files:[{id:'folder'}]});
        let files=window.__driveCloud.map(f=>f.remote);const q=u.searchParams.get('q');
        if(q.includes("key='backupId'"))files=files.filter(f=>q.includes(f.appProperties.backupId));
        return json({files});
      }
      const found=window.__driveCloud.find(f=>u.pathname.endsWith('/'+f.remote.id));
      if(!found)throw new Error('Unknown fake route: '+url);
      if(u.searchParams.get('alt')==='media'){
        window.__driveDownloads++;
        if(window.__driveHold){await new Promise(resolve=>window.__driveRelease=resolve);}
        return new Response(found.bytes);
      }
      return json(found.remote);
    };
    const client=new d.DriveClient(account,c.signal,window.__driveTransport);
    const nativeQuery=(await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;
    const originalRead=nativeQuery.prototype.prepare;let failedReadRequests=0;
    nativeQuery.prototype.prepare=function(sql){if(sql.includes('count(*)::INTEGER FROM beans'))return Promise.reject(new Error('Injected failed storage read'));return originalRead.call(this,sql);};
    try{await rejects(()=>d.syncDrive(new d.DriveClient(account,c.signal,async()=>{failedReadRequests++;throw new Error('No request permitted');}),c.signal),'storage read failure');}finally{nativeQuery.prototype.prepare=originalRead;}
    check(failedReadRequests===0,'failed read never transferred');
    const noBackup=await d.syncDrive(client,c.signal);check(noBackup.message.includes('No Drive backup yet'),'empty cloud');check(window.__drivePosts===0,'no empty upload');
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);
    const bean=await db.addBean({name:'Drive fixture ☕',roast_date:'2026-10-01',freeze_date:null,photo_jpeg:canvas.toDataURL('image/jpeg')});
    await db.addBrewSession({bean_id:bean.id,dose_g:18.1234567890123,water_g:0,time_str:'',temp_c:null,grind_um:700.1234567890123,comment:'Drive\n精度 ☕',yield_g:null,tds_pct:1.4300000000000002,extraction_pct:null});
    const expected=await state();const saved=await db.captureDriveSnapshot();
    const first=await d.syncDrive(client,c.signal);check(!first.imported&&window.__drivePosts===1,'populated upload');check(await state()===expected,'upload no mutation');
    const hash=await db.hashBackupContents(saved.snapshot.data);
    check(window.__driveCloud[0].remote.appProperties.contentSha256V1===hash,'uploaded logical hash');
    const repeat=await d.syncDrive(client,c.signal);
    check(repeat.message.includes('Already backed up')&&window.__drivePosts===1&&window.__driveDownloads===0,'unchanged metadata-only skip');
    delete window.__driveCloud[0].remote.appProperties.contentSha256V1;
    const legacy=await d.syncDrive(client,c.signal);
    check(legacy.message.includes('Already backed up')&&window.__drivePosts===1&&window.__driveDownloads===1,'legacy validated comparison skips upload');
    const legacyBytes=window.__driveCloud[0].bytes;
    window.__driveCloud[0].bytes=new Uint8Array(legacyBytes);window.__driveCloud[0].bytes[0]^=255;
    await rejects(()=>d.syncDrive(client,c.signal),'corrupt legacy comparison');
    check(window.__drivePosts===1&&await state()===expected,'corrupt comparison never uploads or mutates');
    window.__driveCloud[0].bytes=legacyBytes;
    window.__driveCloud[0].remote.appProperties.contentSha256V1=hash;
    const archiveHash=window.__driveCloud[0].remote.appProperties.archiveSha256;
    window.__driveCloud[0].remote.appProperties.archiveSha256='0'.repeat(64);
    await rejects(()=>d.syncDrive(client,c.signal),'inconsistent remote checksums');
    window.__driveCloud[0].remote.appProperties.archiveSha256=archiveHash;
    const cancelled=new AbortController();cancelled.abort();
    await rejects(()=>d.syncDrive(new d.DriveClient(account,cancelled.signal,window.__driveTransport),cancelled.signal),'cancelled comparison');
    check(window.__drivePosts===1&&await state()===expected,'failed or cancelled comparison never uploads or mutates');
    await rejects(()=>d.syncDrive(new d.DriveClient(account,c.signal,async()=>new Response(JSON.stringify({files:[],incompleteSearch:true}))),c.signal),'incomplete history');
    check(window.__drivePosts===1&&await state()===expected,'failed comparison preserves collection');
    const recoveryCopies=JSON.stringify(await db.listImportRecoveries());
    const diagnostic=await (await import('/tests/driveChecks.ts')).testDriveRoundTrip(client,c.signal);check(diagnostic.startsWith('PASS')&&window.__drivePosts===2,'live-style round trip');check(await state()===expected,'round trip no mutation');
    check((await db.captureDriveSnapshot()).revision===saved.revision,'round trip kept revision');check(JSON.stringify(await db.listImportRecoveries())===recoveryCopies,'round trip kept recovery copies');
    const prepared=await b.prepareBackup((await b.packageBackup(saved.snapshot)).data);
    await rejects(()=>db.recoverEmptyBackup(prepared.files,saved.snapshot.counts,initial.revision,c.signal),'populated guard');
    await db.deleteBean(bean.id);const nowEmpty=await db.captureDriveSnapshot();
    await rejects(()=>db.recoverEmptyBackup(prepared.files,saved.snapshot.counts,initial.revision,c.signal),'empty but stale revision guard');
    const orphan=await db.addBean({name:'race'});await db.deleteBean(orphan.id);
    await rejects(()=>db.recoverEmptyBackup(prepared.files,saved.snapshot.counts,nowEmpty.revision,c.signal),'add-delete race guard');
    const duck=(await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;
    const query=duck.prototype.query;
    const empty=await db.captureDriveSnapshot();
    for(const failing of ['UPDATE brew_sessions SET','COMMIT']){
      duck.prototype.query=function(sql){if(sql.startsWith(failing))return Promise.reject(new Error('Injected recovery failure'));return query.call(this,sql);};
      try{await rejects(()=>db.recoverEmptyBackup(prepared.files,saved.snapshot.counts,empty.revision,c.signal),'failed recovery');}finally{duck.prototype.query=query;}
      check((await db.getBeans()).length===0&&(await db.getBrewSessions()).length===0,'rollback preserved empty');
    }
    if(db.getStorageMode()==='indexeddb'){
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,key){if(key==='tables-v1')throw new Error('Injected snapshot failure');return put.call(this,value,key);};
      try{await rejects(()=>db.recoverEmptyBackup(prepared.files,saved.snapshot.counts,empty.revision,c.signal),'snapshot failure');}finally{IDBObjectStore.prototype.put=put;}
      check((await db.getBeans()).length===0,'snapshot failure rolled back');
    }
    window.__driveHold=true;
    const racing=d.syncDrive(client,c.signal);while(!window.__driveRelease)await new Promise(r=>setTimeout(r,1));
    const local=await db.addBean({name:'Race must survive'});window.__driveRelease();
    await rejects(()=>racing,'download race');check((await db.getBeans())[0].id===local.id,'racing local write kept');
    await db.deleteBean(local.id);window.__driveHold=false;
    const recovered=await d.syncDrive(client,c.signal);check(recovered.imported,'empty recovery');check(await state()===expected,'exact restored fields');check(window.__drivePosts===2,'recovery did not upload');
    window.__driveExpected=expected;
    return {storage:db.getStorageMode(),bytes:window.__driveCloud[0].bytes.length,diagnostic,hash,remote:window.__driveCloud[0].remote};
  `);
  console.log('PASS empty/populated sync, exact photo/precision round trip, guarded empty recovery, add-delete race, insert/commit/snapshot rollback',result);
  await api('/refresh',{}); await wait(`document.querySelector('#app')?.getAttribute('aria-busy')==='false'`);
  assert.equal(await evaluate(`const db=await getDB();return (await db.getBeans()).length===1&&(await db.getBrewSessions()).length===1;`),true);
  const afterReload=await evaluate(`const db=await getDB(),d=await import('/src/drive.ts');const remote=${JSON.stringify(result.remote)};
    const controller=new AbortController();let requests=0;
    const client=new d.DriveClient({token:'fake',expiresAt:Date.now()+3600000,sub:'test',email:'test@example.invalid'},controller.signal,async(url,init)=>{
      if(init.method||!new URL(url).searchParams.get('q'))throw new Error('Reload should need only history metadata');requests++;
      return new Response(JSON.stringify({files:[remote]}));
    });const response=await d.syncDrive(client,controller.signal);return {message:response.message,requests,hash:await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data)};`);
  assert.equal(afterReload.hash,result.hash);assert.match(afterReload.message,/Already backed up/);assert.equal(afterReload.requests,1);
  console.log('PASS recovered records survive reload');
  await checkDriveFingerprints(evaluate);
  await checkDriveRestore({evaluate,api,ready:()=>wait(`document.querySelector('#app')?.getAttribute('aria-busy')==='false'`)});
  // Recreate mock cloud after reload via a simple in-page fake account; UI test never uses Google.
  await evaluate(String.raw`
    window.__originalFetch=window.fetch;window.__originalOpen=window.open;window.__uiPosts=0;window.__uiOpens=0;
    const b=await getBackups();window.__uiCloud=[];
    window.fetch=async(url,init={})=>{
      const u=new URL(url,location.href);const json=v=>new Response(JSON.stringify(v));
      if(u.hostname==='openidconnect.googleapis.com')return json({sub:window.__uiAccount??'test',email:'test@example.invalid',email_verified:true});
      if(u.hostname!=='www.googleapis.com')return window.__originalFetch(url,init);
      if(u.searchParams.get('q'))return json({files:u.searchParams.get('q').includes('backups-folder-v1')?[{id:'folder'}]:window.__uiCloud.map(f=>f.remote)});
      if(init.method==='POST'){
        window.__uiPosts++;window.__uiMeta=JSON.parse(init.body);window.__uiChunks=[];
        return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=ui'}});
      }
      if(init.method==='PUT'){
        const bytes=new Uint8Array(await init.body.arrayBuffer());window.__uiChunks.push(bytes);
        const range=init.headers['Content-Range'].match(/bytes (\d+)-(\d+)\/(\d+)/);
        if(Number(range[2])+1<Number(range[3]))return new Response(null,{status:308,headers:{Range:'bytes=0-'+range[2]}});
        const full=new Uint8Array(Number(range[3]));let offset=0;for(const chunk of window.__uiChunks){full.set(chunk,offset);offset+=chunk.length;}
        const remote={id:'ui-file-'+window.__uiPosts,createdTime:new Date(Date.now()+window.__uiPosts).toISOString(),size:String(full.length),sha256Checksum:await b.sha256(full),appProperties:window.__uiMeta.appProperties};
        window.__uiCloud.push({remote,bytes:full});return json(remote);
      }
      const found=window.__uiCloud.find(f=>u.pathname.endsWith('/'+f.remote.id));
      if(u.searchParams.get('alt')==='media')return new Response(found.bytes);
      return json(found.remote);
    };
    window.open=url=>{
      window.__uiOpens++;const channel=new BroadcastChannel('coffeeos-drive-'+new URL(url).hash.slice(1));
      channel.onmessage=event=>{if(event.data.type==='configure')channel.postMessage(window.__uiDeny?{type:'error'}:{type:'authorized',token:'test-only-token',scope:'https://www.googleapis.com/auth/drive.file openid email',expiresAt:Date.now()+3600000});if(event.data.type==='cancel')channel.close();};
      setTimeout(()=>channel.postMessage({type:'ready'}),0);return null;
    };
    document.querySelector('#tab-io').click();if(document.querySelector('#drive-client-id')||document.querySelector('.drive-debug'))throw new Error('Temporary controls still present');
    document.querySelector('.drive-connect').click();document.querySelector('.drive-connect').click();
  `);
  await wait(`document.querySelector('.drive-status').textContent.includes('Uploaded')`);
  assert.deepEqual(await sync('return [window.__uiOpens,window.__uiPosts];'),[1,1]);
  await sync(`document.querySelector('#tab-bean-manager').click();document.querySelector('#tab-io').click();document.querySelector('.drive-sync').click();document.querySelector('.drive-sync').click();`);
  await wait(`document.querySelector('.drive-status').textContent.includes('Already backed up') && document.querySelector('.io-drive').parentElement.getAttribute('aria-busy')==='false'`);
  assert.equal(await sync('return window.__uiPosts;'),1);
  await evaluate(`const db=await getDB();const bean=(await db.getBeans())[0];await db.updateBean(bean.id,{...bean,name:bean.name+' changed'});`);
  await sync(`document.querySelector('.drive-sync').click();`);
  await wait(`window.__uiPosts===2 && document.querySelector('.io-drive').parentElement.getAttribute('aria-busy')==='false'`);
  assert.equal(await sync(`return document.querySelector('#drive-snapshot').value`),'ui-file-1');
  await sync(`document.querySelector('.drive-review').click();`);
  await wait(`!document.querySelector('.drive-preview').hidden && document.querySelector('.io-drive').parentElement.getAttribute('aria-busy')==='false'`);
  await evaluate(`await (await getDB()).addBean({name:'UI stale replacement fixture'});`);
  await sync(`document.querySelector('.drive-replace').click();`);
  await wait(`document.querySelector('.drive-status').textContent.includes('changed')`);
  assert.equal(await evaluate(`return (await (await getDB()).getBeans()).length;`),2);
  await sync(`document.querySelector('.drive-replace').click();document.querySelector('.drive-replace').click();`);
  await wait(`document.querySelector('.drive-status').textContent.includes('Replaced with') && document.querySelector('.io-drive').parentElement.getAttribute('aria-busy')==='false'`);
  assert.equal(await evaluate(`return (await (await getDB()).getBeans()).length;`),1);
  assert.equal(await sync(`return document.querySelector('.io-recovery').hidden;`),false);
  assert.equal(await sync(`return window.__uiPosts;`),2,'restore never uploads');
  await sync(`document.querySelector('.drive-switch').click();window.__uiAccount='other';document.querySelector('.drive-connect').click();`);
  await wait(`document.querySelector('.drive-sync').textContent.includes('Enable') && !document.querySelector('.drive-sync').disabled`);
  assert.equal(await sync(`return window.__uiPosts;`),2,'switch requires confirmation before upload');
  await sync(`document.querySelector('.drive-sync').click();`);
  await wait(`window.__uiPosts===3 && document.querySelector('.io-drive').parentElement.getAttribute('aria-busy')==='false'`);
  assert.equal(await sync(`return window.__uiPosts;`),3,'restored older contents upload when latest differs');
  const gap=await sync(`const drive=document.querySelector('.io-drive').getBoundingClientRect(),local=document.querySelector('.io-export').getBoundingClientRect();return local.top-drive.bottom;`);
  assert.ok(gap>=24,'Drive and local cards have at least 24px separation: '+gap);
  console.log('PASS history preserves previous snapshot selection, pinned preview, stale replacement reconfirmation, recovery visibility, no restore upload and account-switch confirmation');
  await sync(`document.querySelector('.drive-disconnect').click();window.__uiDeny=true;document.querySelector('.drive-connect').click();`);
  await wait(`!document.querySelector('.drive-error').hidden`);
  assert.equal(await sync(`return document.querySelector('.drive-account').textContent`),'Not connected');
  assert.equal(await sync(`return document.documentElement.scrollWidth<=innerWidth`),true);
  console.log('PASS UI connect/sync double-click serialization, navigation, denied auth, normal controls without setup/debug fields, 393px layout');
} finally { if(session) await api('',undefined,'DELETE'); }
