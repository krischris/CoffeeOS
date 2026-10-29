import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { firefoxAdapter } from './firefox-upgrade-adapter.mjs';
import { checkBackups, checkBackupMemory } from './backup-checks.mjs';
const endpoint = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4444';
const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173/';
const firefox = process.env.TEST_FIREFOX ? await firefoxAdapter() : null;
let session;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  if (firefox) return firefox(path, body, method);
  const response = await fetch(endpoint + path, {method, headers:{'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
  const {value} = await response.json();
  if (!response.ok || value?.error) throw new Error(JSON.stringify(value));
  return value;
}
const api = (path, body, method) => request(`/session/${session}${path}`,body,method);
const sync = script => api('/execute/sync', {script,args:[]});
const evaluate = script => api('/execute/async', {script:`const done=arguments[arguments.length-1];(async()=>{
 const getDB=()=>import(performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/src/db.ts')?.name ?? '/src/db.ts');
 const getBackups=()=>import(performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/src/backups.ts')?.name ?? '/src/backups.ts');
 const getZIP=()=>import('/node_modules/fflate/esm/browser.js');
 ${script}
 })().then(value=>done({value}),error=>done({error:String(error),stack:error.stack}));`,args:[]}).then(r=>{if(r.error)throw new Error(JSON.stringify(r));return r.value;});
async function waitFor(expression) {
 for(let i=0;i<150;i++){if(await sync(`return Boolean(${expression});`))return;await new Promise(r=>setTimeout(r,100));}
 throw new Error('Timed out: '+expression);
}
try {
 session=(await request('/session',{capabilities:{alwaysMatch:{browserName:'safari'}}})).sessionId;
 await api('/timeouts',{script:120000,pageLoad:45000});
 if(!firefox)await api('/window/rect',{width:393,height:852});
 await api('/url',{url:base});
 await waitFor(`document.querySelector('#app')?.getAttribute('aria-busy') === 'false'`);
 if(existsSync('.cache/backups/python-deflate.zip')) {
   const bytes=Array.from(readFileSync('.cache/backups/python-deflate.zip'));
   await evaluate(`await (await getBackups()).prepareBackup(new Uint8Array(${JSON.stringify(bytes)}));`);
   console.log('PASS Python zipfile DEFLATE repack imported');
 }
 if(existsSync('.cache/backups/invalid')) {
   for(const name of readdirSync('.cache/backups/invalid')) {
     const bytes=Array.from(readFileSync('.cache/backups/invalid/'+name));
     const outcome=await evaluate(`const db=await getDB(),b=await getBackups();const before=JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()});let error;try{await b.prepareBackup(new Uint8Array(${JSON.stringify(bytes)}));}catch(failure){error=String(failure);}return {error,unchanged:before===JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()})};`);
     assert.ok(outcome.error,name);assert.equal(outcome.unchanged,true,name);
   }
   console.log('PASS 10 independent PyArrow invalid-value/schema archives rejected before mutation');
 }
 console.log('Browser storage:',await evaluate('return (await getDB()).getStorageMode();'));
 const result = process.env.TEST_MEMORY_ONLY ? {measurements:await checkBackupMemory(evaluate)} : await checkBackups({sync,evaluate,waitFor,reload:async()=>{await api('/refresh',{});await waitFor(`document.querySelector('#app')?.getAttribute('aria-busy') === 'false'`);}});
 if(result.example){mkdirSync('docs/fixtures',{recursive:true});writeFileSync('docs/fixtures/example-v4.coffeeos',new Uint8Array(result.example));}
 console.log('Measurements:',result.measurements);
 mkdirSync('.cache/backups',{recursive:true});
 if(result.roundtrip)writeFileSync('.cache/backups/roundtrip.coffeeos',new Uint8Array(result.roundtrip));
 writeFileSync(process.env.TEST_MEMORY_ONLY ? '.cache/backups/stress.json' : '.cache/backups/measured.json',JSON.stringify(result.measurements,null,2)+'\n');
 if(result.example)assert.ok(result.example.length>0);
} finally {if(session)await api('',undefined,'DELETE');}
