import assert from 'node:assert/strict';
import { firefoxAdapter } from './firefox-upgrade-adapter.mjs';

const endpoint = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4444';
const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173/';
const firefox = process.env.TEST_FIREFOX ? await firefoxAdapter() : null;
let session;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  if (firefox) return firefox(path, body, method);
  const response = await fetch(endpoint + path, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw new Error(JSON.stringify(value));
  return value;
}
const api = (path, body, method) => request(`/session/${session}${path}`, body, method);
const sync = script => api('/execute/sync', { script, args: [] });
const evaluate = script => api('/execute/async', { script: `const done=arguments[arguments.length-1];(async()=>{
  const cache=await import('/src/driveAuthorization.ts');
  const {googleDriveClientId:clientId}=await import('/src/driveConfig.ts');
  const db=await import(performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/src/db.ts')?.name ?? '/src/db.ts');
  const check=(v,m)=>{if(!v)throw new Error(m);};
  ${script}
})().then(value=>done({value}),error=>done({error:String(error),stack:error.stack}));`, args: [] })
  .then(r => { if(r.error) throw new Error(JSON.stringify(r)); return r.value; });
async function wait(expression) {
  for(let i=0;i<150;i++) { if(await sync(`return Boolean(${expression})`)) return; await new Promise(r=>setTimeout(r,100)); }
  throw new Error('Timed out: '+expression);
}
async function ready() {
  await wait(`document.querySelector('#app')?.getAttribute('aria-busy')==='false'`);
  await sync(`document.querySelector('#tab-io').click();`);
}
async function reload() { await api('/refresh', {}); await ready(); }
const idle = `document.querySelector('.io-drive').parentElement.getAttribute('aria-busy')==='false'`;
async function mock() {
  await sync(`
    window.__authOpens=0;window.__authChecks=0;window.__driveReads=0;
    window.__authSub='test';window.__authMode='ok';window.__rejectDrive=0;
    const nativeFetch=window.fetch;
    window.fetch=async(url,init={})=>{
      const u=new URL(url,location.href),json=v=>new Response(JSON.stringify(v));
      if(u.hostname==='openidconnect.googleapis.com'){
        window.__authChecks++;
        if(window.__authMode==='offline')throw new TypeError('Injected offline verification');
        if(window.__authMode==='hold')await new Promise(resolve=>window.__releaseAuth=resolve);
        if(window.__authMode==='revoked')return new Response(null,{status:401});
        return json({sub:window.__authSub,email:window.__authSub+'@example.invalid',email_verified:true});
      }
      if(u.hostname==='www.googleapis.com'){
        window.__driveReads++;
        if(window.__rejectDrive-->0)return new Response(null,{status:401});
        if(init.method&&init.method!=='GET')throw new Error('Unexpected transfer');
        return json({files:[]});
      }
      return nativeFetch.call(window,url,init);
    };
    window.open=url=>{
      window.__authOpens++;
      const channel=new BroadcastChannel('coffeeos-drive-'+new URL(url).hash.slice(1));
      channel.onmessage=event=>{
        if(event.data.type==='configure')channel.postMessage({type:'authorized',token:'synthetic-'+window.__authSub,
          scope:'https://www.googleapis.com/auth/drive.file openid email',expiresAt:Date.now()+3600000});
        if(event.data.type==='cancel')channel.close();
      };
      setTimeout(()=>channel.postMessage({type:'ready'}),0);return null;
    };
  `);
}
async function seedCache(enabled = true) {
  await evaluate(`cache.saveDriveAuthorization(clientId,{token:'synthetic-test',expiresAt:Date.now()+3600000,sub:'test',email:'test@example.invalid'},${enabled});`);
}
async function refresh() {
  await sync(`document.querySelector('.drive-refresh').click();`);
  await wait(idle);
}
try {
  session = (await request('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })).sessionId;
  await api('/timeouts', { script:120000, pageLoad:45000 });
  await api('/url', { url:base }); await ready();
  await evaluate(`
    const key=cache.driveAuthorizationKey;
    localStorage.setItem('coffeeos-authorization-test-unrelated','keep');
    for(const raw of ['{broken',JSON.stringify({version:2}),JSON.stringify({version:1,clientId:'other',enabled:true,account:{}}),
      JSON.stringify({version:1,clientId,enabled:true,account:{token:'test',sub:'test',email:'test@example.invalid',expiresAt:Date.now()-1}})]){
      localStorage.setItem(key,raw);check(cache.readDriveAuthorization(clientId)===null,'reject unusable cache');
      check(localStorage.getItem(key)===null,'remove only unusable credentials');
    }
    const account={token:'synthetic-test',expiresAt:Date.now()+3600000,sub:'test',email:'test@example.invalid'};
    check(cache.saveDriveAuthorization(clientId,account,false),'save cache');
    check(!cache.readDriveAuthorization(clientId).enabled,'pending confirmation retained');
    cache.forgetDriveAuthorization('different-token');check(cache.readDriveAuthorization(clientId)!==null,'late invalidation retains newer token');
    cache.forgetDriveAuthorization();check(localStorage.getItem('coffeeos-authorization-test-unrelated')==='keep','unrelated storage preserved');
    const set=Storage.prototype.setItem,get=Storage.prototype.getItem;
    Storage.prototype.setItem=function(){throw new DOMException('Injected full storage','QuotaExceededError');};
    try{check(!cache.saveDriveAuthorization(clientId,account,true),'quota returns memory-only');}finally{Storage.prototype.setItem=set;}
    Storage.prototype.getItem=function(){throw new DOMException('Injected denied storage','SecurityError');};
    try{check(cache.readDriveAuthorization(clientId)===null,'blocked read is optional');}finally{Storage.prototype.getItem=get;}
    cache.saveDriveAuthorization(clientId,{...account,expiresAt:Date.now()+50},true);
    await new Promise(resolve=>setTimeout(resolve,100));check(localStorage.getItem(key)===null,'expiry timer purges credentials');
  `);
  await mock();
  await sync(`document.querySelector('.drive-connect').click();`);
  await wait(`document.querySelector('.drive-status').textContent.includes('No Drive backup yet') && ${idle}`);
  assert.equal(await sync('return window.__authOpens;'),1);
  const originalExpiry = await evaluate(`return cache.readDriveAuthorization(clientId).account.expiresAt;`);
  const records = await evaluate(`
    const bean=await db.addBean({name:'Authorization upgrade ☕',roast_date:'2026-10-01'});
    await db.addBrewSession({bean_id:bean.id,dose_g:18.1234567890123,water_g:0,time_str:'',temp_c:null,grind_um:700.1234567890123,comment:'Token reuse\\n精度 ☕',yield_g:null,tds_pct:1.4300000000000002,extraction_pct:null});
    return {beans:await db.getBeans(),sessions:await db.getBrewSessions()};
  `);
  await reload();
  assert.equal(await sync(`return document.querySelector('.drive-account').textContent`),'Connected: test@example.invalid');
  assert.equal(await sync(`return performance.getEntriesByType('resource').some(r=>/googleapis.com|accounts.google.com/.test(new URL(r.name).hostname))`),false,'no automatic Google access');
  await mock(); await refresh(); await refresh();
  assert.deepEqual(await sync('return [window.__authOpens,window.__authChecks,window.__driveReads];'),[0,1,2]);
  assert.equal(await evaluate(`return cache.readDriveAuthorization(clientId).account.expiresAt;`),originalExpiry,'reuse never extends lifetime');
  assert.deepEqual(await evaluate(`return {beans:await db.getBeans(),sessions:await db.getBrewSessions()};`),records);
  console.log('PASS valid token survives reload, no automatic Google access/sync, first-use identity verification, no repeated popup or lifetime extension; exact records retained');

  await reload(); await mock();
  await sync(`window.__authMode='offline';document.querySelector('.drive-refresh').click();`); await wait(idle);
  assert.equal(await sync('return window.__driveReads;'),0);
  assert.equal(await evaluate(`return Boolean(cache.readDriveAuthorization(clientId));`),true);
  await sync(`window.__authMode='ok';`); await refresh();
  assert.deepEqual(await sync('return [window.__authOpens,window.__authChecks,window.__driveReads];'),[0,2,1]);
  await sync(`window.__rejectDrive=1;document.querySelector('.drive-refresh').click();`);
  await wait(`document.querySelector('.drive-connect').textContent.includes('Reconnect')`);
  assert.equal(await evaluate(`return localStorage.getItem(cache.driveAuthorizationKey);`),null,'401 immediately invalidates saved token');
  await sync(`window.__authSub='wrong';document.querySelector('.drive-connect').click();`);
  await wait(`document.querySelector('.drive-error').textContent.includes('same account')`);
  assert.equal(await evaluate(`return localStorage.getItem(cache.driveAuthorizationKey);`),null,'wrong-account renewal never cached');
  await sync(`window.__authSub='test';document.querySelector('.drive-connect').click();`); await wait(idle);
  assert.equal(await evaluate(`return cache.readDriveAuthorization(clientId).account.sub;`),'test');
  console.log('PASS transient verification failure retains cache and retries; Drive 401 purges token, rejects wrong-account reconnect and resumes with original account');

  await reload(); await mock();
  await sync(`window.__authSub='mismatch';document.querySelector('.drive-refresh').click();`); await wait(idle);
  assert.equal(await sync(`return document.querySelector('.drive-account').textContent`),'Not connected');
  assert.equal(await sync('return window.__driveReads;'),0);
  assert.equal(await evaluate(`return localStorage.getItem(cache.driveAuthorizationKey);`),null);
  await seedCache(); await reload(); await mock();
  await sync(`window.__authMode='revoked';document.querySelector('.drive-refresh').click();`); await wait(idle);
  assert.equal(await evaluate(`return localStorage.getItem(cache.driveAuthorizationKey);`),null);
  assert.equal(await sync('return window.__driveReads;'),0);
  await seedCache();
  await evaluate(`const saved=JSON.parse(localStorage.getItem(cache.driveAuthorizationKey));saved.account.expiresAt=Date.now()-1;localStorage.setItem(cache.driveAuthorizationKey,JSON.stringify(saved));`);
  await reload();
  assert.equal(await sync(`return document.querySelector('.drive-account').textContent`),'Not connected');
  assert.equal(await evaluate(`return localStorage.getItem(cache.driveAuthorizationKey);`),null);
  console.log('PASS restored identity mismatch, revoked token and expired token discard credentials before any Drive request');

  await seedCache(); await reload(); await mock();
  await sync(`document.querySelector('.drive-switch').click();window.__authSub='other';document.querySelector('.drive-connect').click();`);
  await wait(`document.querySelector('.drive-sync').textContent.includes('Enable') && ${idle}`);
  assert.equal(await sync('return window.__driveReads;'),0);
  assert.equal(await evaluate(`return cache.readDriveAuthorization(clientId).enabled;`),false);
  await reload();
  assert.equal(await sync(`return document.querySelector('.drive-sync').textContent`),'Enable backup to this account');
  assert.equal(await sync(`return document.querySelector('.drive-refresh').disabled`),true);
  await sync(`document.querySelector('.drive-disconnect').click();`); await reload();
  assert.equal(await sync(`return document.querySelector('.drive-account').textContent`),'Not connected');
  assert.equal(await evaluate(`return localStorage.getItem(cache.driveAuthorizationKey);`),null);

  await seedCache(); await reload(); await mock();
  await sync(`window.__authMode='hold';document.querySelector('.drive-refresh').click();`);
  await wait('window.__releaseAuth');
  await sync(`document.querySelector('.drive-disconnect').click();window.__releaseAuth();`); await wait(idle);
  assert.equal(await sync('return window.__driveReads;'),0);
  assert.equal(await evaluate(`return localStorage.getItem(cache.driveAuthorizationKey);`),null,'cancelled late verification cannot resurrect cache');
  await seedCache(); await reload();
  await sync(`window.dispatchEvent(new PageTransitionEvent('pagehide'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));`);
  assert.equal(await sync(`return document.querySelector('.drive-account').textContent`),'Connected: test@example.invalid','back-forward cache restoration reuses authorization');
  await mock();
  await evaluate(`window.__originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Injected full storage','QuotaExceededError');};`);
  await refresh(); await refresh();
  assert.equal(await sync(`return document.querySelector('.drive-retention').textContent.includes('Browser storage is unavailable')`),true);
  assert.deepEqual(await sync('return [window.__authOpens,window.__authChecks,window.__driveReads];'),[0,1,2],'failed cache write leaves memory connection usable');
  await sync(`Storage.prototype.setItem=window.__originalStorageSet;`);
  await evaluate(`window.dispatchEvent(new StorageEvent('storage',{key:cache.driveAuthorizationKey,storageArea:localStorage,newValue:null}));`);
  assert.equal(await sync(`return document.querySelector('.drive-account').textContent`),'Not connected','cross-window disconnect clears in-memory connection');
  assert.deepEqual(await evaluate(`return {beans:await db.getBeans(),sessions:await db.getBrewSessions()};`),records);
  console.log('PASS switch confirmation survives reload, disconnect clears credentials, late verification/cross-window changes cannot resume transfers; credential storage failures preserve records');
} finally { if(session) await api('',undefined,'DELETE'); }
