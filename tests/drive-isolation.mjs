import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
let legacyWorker=true, session;
const oldWorker=execFileSync('git',['show','HEAD:public/coi-serviceworker.js']);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/CoffeeOS/')){res.writeHead(404).end();return;}
  const relative=pathname.slice('/CoffeeOS/'.length)||'index.html';
  const data=relative==='coi-serviceworker.js'&&legacyWorker?oldWorker:await readFile(resolve('dist',relative));
  // Simulate GitHub Pages: the worker supplies all isolation headers.
  res.writeHead(200,{'Content-Type':mime[extname(relative)]??'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(404).end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5176,'127.0.0.1',resolve);});
const endpoint=process.env.SAFARI_WEBDRIVER_URL??'http://127.0.0.1:4444';
async function request(path,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(endpoint+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const {value}=await response.json();if(!response.ok||value?.error)throw new Error(JSON.stringify(value));return value;
}
const api=(path,body,method)=>request('/session/'+session+path,body,method);
const sync=script=>api('/execute/sync',{script,args:[]});
const evaluate=script=>api('/execute/async',{script:`const done=arguments[arguments.length-1];(async()=>{${script}})().then(value=>done({value}),error=>done({error:String(error)}));`,args:[]}).then(r=>{if(r.error)throw new Error(r.error);return r.value;});
async function wait(expression){for(let i=0;i<200;i++){try{if(await sync('return Boolean('+expression+')'))return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+expression);}
try{
 session=(await request('/session',{capabilities:{alwaysMatch:{browserName:'safari'}}})).sessionId;
 await api('/timeouts',{script:45000,pageLoad:45000});
 const base='http://127.0.0.1:5176/CoffeeOS/';
 await api('/url',{url:base});await wait(`crossOriginIsolated && document.querySelector('#app')?.getAttribute('aria-busy')==='false'`);
 const main=await api('/window');const channel=randomUUID();
 await sync(`window.__authReady=false;window.__probe=new BroadcastChannel('coffeeos-drive-${channel}');window.__probe.onmessage=event=>{window.__authReady=event.data.type==='ready';};`);
 legacyWorker=false;
 const helper=(await api('/window/new',{type:'tab'})).handle;
 await api('/window',{handle:helper});await api('/url',{url:base+'drive-auth.html#'+channel});
 await wait(`!crossOriginIsolated && location.hash==='' && document.querySelector('button')?.disabled===true`);
 const helperState=await sync(`return {isolated:crossOriginIsolated,google:performance.getEntriesByType('resource').some(r=>r.name.includes('accounts.google.com')),db:performance.getEntriesByType('resource').some(r=>r.name.includes('.wasm')),url:location.pathname};`);
 assert.equal(helperState.google,false);assert.equal(helperState.db,false);
 await api('/window',{handle:main});await wait('window.__authReady');assert.equal(await sync('return crossOriginIsolated'),true);
 console.log('PASS production /CoffeeOS/ assets, previous isolation-worker update, one-time helper BroadcastChannel across isolated windows, helper-only header exception; no Google requested',helperState);
 // Native Vite preview must also apply only the helper exception.
 for(const [path,coop,coep]of [['','same-origin','require-corp'],['drive-auth.html','same-origin-allow-popups','unsafe-none']]){
  const response=await fetch('http://127.0.0.1:4174/CoffeeOS/'+path);assert.equal(response.headers.get('Cross-Origin-Opener-Policy'),coop);assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'),coep);
 }
 console.log('PASS production preview main/helper COOP/COEP headers');
}finally{if(session)await api('',undefined,'DELETE');await new Promise(resolve=>server.close(resolve));}
