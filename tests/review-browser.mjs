import {checkDriveRecoveryView} from './drive-recovery-view-checks.mjs';
import {checkReviewRemediation,checkHistoryScale,checkRuntimeWorkerFailure} from './review-remediation-checks.mjs';
import {firefoxAdapter} from './firefox-upgrade-adapter.mjs';
const endpoint=process.env.SAFARI_WEBDRIVER_URL??'http://127.0.0.1:4444';
const firefox=process.env.TEST_FIREFOX?await firefoxAdapter():null;
let session;
async function request(path,body,method=body===undefined?'GET':'POST') {
  if(firefox)return firefox(path,body,method);
  const response=await fetch(endpoint+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const {value}=await response.json();if(!response.ok||value?.error)throw Error(JSON.stringify(value));return value;
}
const api=(path,body,method)=>request('/session/'+session+path,body,method);
const sync=script=>api('/execute/sync',{script,args:[]});
const evaluate=script=>api('/execute/async',{script:`const done=arguments[arguments.length-1];(async()=>{
 const getDB=()=>import(performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/src/db.ts')?.name??'/src/db.ts');
 const getBackups=()=>import('/src/backups.ts');${script}
 })().then(value=>done({value}),error=>done({error:String(error),stack:error.stack}));`,args:[]}).then(r=>{if(r.error)throw Error(JSON.stringify(r));return r.value;});
async function waitFor(expr){for(let i=0;i<200;i++){if(await sync(`return Boolean(${expr});`))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expr);}
const ready=()=>waitFor(`document.querySelector('#app')?.getAttribute('aria-busy')==='false'`);
try {
 session=(await request('/session',{capabilities:{alwaysMatch:{browserName:'safari'}}})).sessionId;
 await api('/timeouts',{script:120000,pageLoad:45000});await api('/url',{url:process.env.TEST_BASE_URL??'http://127.0.0.1:5173/'});await ready();
 if(!process.env.TEST_REVIEW_ONLY) await checkReviewRemediation({sync,evaluate,waitFor,api,ready});
 if(!process.env.TEST_REVIEW_ONLY) await checkHistoryScale({sync,evaluate,waitFor});
 if(process.env.TEST_REVIEW_ONLY!=='runtime') await checkDriveRecoveryView({evaluate});
 if(!process.env.TEST_REVIEW_ONLY||process.env.TEST_REVIEW_ONLY==='runtime') await checkRuntimeWorkerFailure({evaluate});
}finally{if(session)await api('',undefined,'DELETE');}
