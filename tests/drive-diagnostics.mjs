import assert from 'node:assert/strict';
import { firefoxAdapter } from './firefox-upgrade-adapter.mjs';
const firefox = process.env.TEST_FIREFOX ? await firefoxAdapter() : null;
const endpoint = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4444';
const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173/';
let session;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  if (firefox) return firefox(path, body, method);
  const response = await fetch(endpoint + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const { value } = await response.json(); if (!response.ok || value?.error) throw new Error(JSON.stringify(value)); return value;
}
const api = (path, body, method) => request(`/session/${session}${path}`, body, method);
const sync = script => api('/execute/sync', { script, args: [] });
const evaluate = script => api('/execute/async', { script: `const done=arguments[arguments.length-1];(async()=>{${script}})().then(value=>done({value}),()=>done({error:'Diagnostic assertion failed'}));`, args: [] }).then(r => { if (r.error) throw Error(r.error); return r.value; });
async function ready() { for(let i=0;i<150;i++){if(await sync(`return document.querySelector('#app')?.getAttribute('aria-busy')==='false'`))return;await new Promise(r=>setTimeout(r,100));}throw Error('Startup timed out'); }
try {
  session=(await request('/session',{capabilities:{alwaysMatch:{browserName:'safari'}}})).sessionId;
  await api('/timeouts',{script:120000,pageLoad:45000});
  await api('/url',{url:base});await ready();
  assert.equal(await sync('return typeof window.coffeeosDriveDebug;'),'undefined');
  await api('/url',{url:base+'?drive-debug=1'});await ready();
  const result=await evaluate(String.raw`
    const module=path=>import(performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname===path)?.name??path);
    const db=await module('/src/db.ts'), diagnostics=await module('/src/driveDiagnostics.ts');
    const check=(value)=>{if(!value)throw Error('Assertion failed');};
    const bean=await db.addBean({name:'PRIVATE bean sentinel'});
    await db.addBrewSession({bean_id:bean.id,dose_g:18,water_g:0,time_str:'',temp_c:null,grind_um:null,comment:'PRIVATE comment sentinel',yield_g:null,tds_pct:null,extraction_pct:null});
    const before=JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions(),revision:(await db.captureDriveSnapshot()).revision,copies:await db.listImportRecoveries()});
    const report=JSON.parse(await window.coffeeosDriveDebug.runLocalChecks());
    check(report.entries.some(e=>e.step==='Check exact local round trip'&&e.outcome==='passed'));
    const after=JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions(),revision:(await db.captureDriveSnapshot()).revision,copies:await db.listImportRecoveries()});check(before===after);
    const error=new TypeError('PRIVATE token-and-email sentinel cannot read private record');
    diagnostics.driveFailure('Drive operation',error);
    const native=crypto.subtle.digest;
    crypto.subtle.digest=()=>Promise.reject(new TypeError('PRIVATE hashing sentinel'));
    try { await window.coffeeosDriveDebug.runLocalChecks(); } finally { crypto.subtle.digest=native; }
    const final=window.coffeeosDriveDebug.report();check(!final.includes('PRIVATE'));check(!final.includes(bean.id));
    check(JSON.parse(final).entries.some(e=>e.step==='Package local snapshot'&&e.outcome==='failed'));
    const unchanged=JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions(),revision:(await db.captureDriveSnapshot()).revision,copies:await db.listImportRecoveries()});check(before===unchanged);
    window.__diagnosticExpected=JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()});
    return {backend:db.getStorageMode(),entries:JSON.parse(final).entries.length};
  `);
  const expected=await sync('return window.__diagnosticExpected;');
  await api('/refresh',{});await ready();
  assert.equal(await evaluate(`const db=await import(performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/src/db.ts').name);return JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()});`),expected);
  console.log('PASS opt-in diagnostics, exact read-only local round trip, sanitized failures, packaging failure stage, unchanged revisions/recoveries and reload',result);
} finally { if(session)await api('',undefined,'DELETE'); }
