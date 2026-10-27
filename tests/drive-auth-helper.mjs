import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const code=readFileSync('public/drive-auth.js','utf8');
function helper() {
 const messages=[], listeners={}, timers=new Map(); let config, closed=false;
 const button={disabled:true,addEventListener:(type,fn)=>listeners[type]=fn}; const status={textContent:''};
 const channel={postMessage:v=>messages.push(v),close:()=>{closed=true;}};
 const script={};
 const context={
  location:{hash:'#12345678-1234-1234-1234-123456789abc',pathname:'/CoffeeOS/drive-auth.html',hostname:'localhost'},
  history:{replaceState:()=>{}},
  document:{querySelector:s=>s==='button'?button:status,createElement:()=>script,head:{append:()=>{}}},
  BroadcastChannel:function(){return channel;},
  setTimeout:fn=>{timers.set(1,fn);return 1;},clearTimeout:id=>timers.delete(id),
  window:{addEventListener:(type,fn)=>listeners[type]=fn,close:()=>{},crossOriginIsolated:false},
  google:{accounts:{oauth2:{initTokenClient:value=>{config=value;return {requestAccessToken:()=>{}};}}}},
  Date, Number, Error,
 };
 vm.runInNewContext(code,context);
 return {messages,listeners,timers,button,status,script,channel,get config(){return config;},get closed(){return closed;}};
}
const id='public.apps.googleusercontent.com';
for(const outcome of ['success','denied','blocked','cancelled','late','timeout']) {
 const h=helper(); assert.equal(h.messages[0].type,'ready');
 h.channel.onmessage({data:{type:'configure',clientId:id}}); h.script.onload();
 assert.equal(h.button.disabled,false); assert.equal(h.config.include_granted_scopes,false);
 assert.equal(h.config.scope,'https://www.googleapis.com/auth/drive.file openid email');
 h.listeners.click();assert.equal(h.button.disabled,true);
 const authorized={access_token:'test-only-token',scope:h.config.scope,expires_in:3600};
 if(outcome==='success') {
   const before=Date.now();h.config.callback(authorized);const after=Date.now();
   assert.equal(h.messages.at(-1).type,'authorized');
   assert.ok(h.messages.at(-1).expiresAt>=before+3570000 && h.messages.at(-1).expiresAt<=after+3570000,'Google lifetime minus existing 30-second margin');
 }
 if(outcome==='denied') {h.config.callback({error:'access_denied'});assert.equal(h.messages.at(-1).type,'error');}
 if(outcome==='blocked') {h.config.error_callback({type:'popup_failed_to_open'});assert.equal(h.messages.at(-1).type,'error');}
 if(outcome==='cancelled'||outcome==='late') {h.channel.onmessage({data:{type:'cancel'}});h.config.callback(authorized);assert.equal(h.messages.length,1);}
 if(outcome==='timeout') {h.timers.get(1)();h.config.callback(authorized);assert.equal(h.messages.at(-1).type,'error');}
 assert.ok(h.closed); h.listeners.pagehide();
 assert.ok(h.messages.filter(m=>m.type==='authorized').length<=1);
}
console.log('PASS helper token success, denied/blocked auth, cancellation, late callback suppression and timeout (simulated GIS; no live Google claim)');
