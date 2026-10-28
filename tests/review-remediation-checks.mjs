import assert from 'node:assert/strict';
import {checkLegacyText} from './legacy-text-checks.mjs';

/** Review findings, using disposable data inside the caller's isolated browser. */
export async function checkReviewRemediation({sync, evaluate, waitFor, api, ready}) {
  await checkLegacyText({evaluate});
  // One fault case per WebDriver command keeps the complete matrix bounded even
  // with populated photo-heavy fixtures; assertions and failure modes are unchanged.
  await evaluate(String.raw`
    window.__reviewMatrix = (async function*() {
    const db=await getDB(), b=await getBackups();
    const Duck=window.__testConnection ?? (await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;
    const check=(v,m)=>{if(!v)throw Error(m);};
    const state=async()=>JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()});
    const hash=async()=>db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data);
    const before=await b.saveBackup();
    const bean=await db.addBean({name:'Review matrix',roast_date:'2026-01-02'});
    const input={bean_id:bean.id,dose_g:18.1234567890123,water_g:0,time_str:'',temp_c:null,grind_um:null,comment:' preserve\n☕ ',yield_g:null,tds_pct:null,extraction_pct:null};
    const session=await db.addBrewSession(input);
    const extra=await db.addBean({name:'Parquet candidate'});
    const parquet=(await db.exportData('parquet')).map(f=>({target:f.name.startsWith('beans')?'beans':'brew_sessions',...f}));
    await db.deleteBean(extra.id);
    const baseline=await b.saveBackup();
    const restore=async()=>b.replaceBackup(await b.prepareBackup(baseline.data));
    const csv=new TextEncoder().encode('id,name,roast_date,freeze_date,created_at\n'+bean.id+',CSV candidate,2026-02-01,\\N,2024-01-02T03:04:05.123456Z\n');
    const operations={
      addBean:()=>db.addBean({name:'Candidate bean'}),
      updateBean:()=>db.updateBean(bean.id,{...bean,name:'Candidate name'}),
      deleteBean:()=>db.deleteBean(bean.id),
      addSession:()=>db.addBrewSession({...input,comment:'Candidate session'}),
      updateSession:()=>db.updateBrewSession(session.id,{...session,comment:'Candidate comment'}),
      deleteSession:()=>db.deleteBrewSession(session.id),
      csv:()=>db.importData([{target:'beans',name:'beans.csv',data:csv}]),
      parquet:()=>db.importData(parquet),
    };
    const mode=db.getStorageMode(), results=[];
    for(const [name,operation] of Object.entries(operations)) {
      for(const failure of (mode==='indexeddb'?['commit','put','abort','post-abort']:['commit','flush'])) {
        const expected=await state(), expectedHash=await hash(), revision=(await db.captureDriveSnapshot()).revision;
        const query=Duck.prototype.query,put=IDBObjectStore.prototype.put;
        let tx, commits=0, rollbacks=0;
        IDBObjectStore.prototype.put=function(value,key){
          if(key==='tables-v1') {
            if(failure==='put')throw Error('Injected IDB put rejection');
            tx=this.transaction;
            const request=put.call(this,value,key);
            if(failure==='abort')tx.abort();
            return request;
          }
          return put.call(this,value,key);
        };
        Duck.prototype.query=function(sql){
          if(sql==='ROLLBACK')rollbacks++;
          if(sql==='CHECKPOINT'&&failure==='flush')return Promise.reject(Error('Injected flush failure'));
          if(sql==='COMMIT') {
            commits++;
            if(failure==='commit')return Promise.reject(Error('Injected SQL COMMIT rejection'));
            const result=query.call(this,sql);
            return failure==='post-abort'?result.then(v=>{tx.abort();return v;}):result;
          }
          return query.call(this,sql);
        };
        let error;
        try{await operation();}catch(e){error=e;}finally{Duck.prototype.query=query;IDBObjectStore.prototype.put=put;}
        check(error,name+'/'+failure+' rejected');
        const committed=failure==='post-abort'||failure==='flush';
        check((error instanceof db.CommittedWriteError)===committed,name+'/'+failure+' outcome class');
        check((await db.captureDriveSnapshot()).revision===revision+(committed?1:0),name+'/'+failure+' revision once');
        if(!committed) {check(await state()===expected,name+'/'+failure+' live unchanged');check(await hash()===expectedHash,name+'/'+failure+' exact live precision');}
        else {check(rollbacks===0,name+'/'+failure+' no invalid rollback');check(await state()!==expected,name+'/'+failure+' live applied');}
        await db.closeDB();await db.initDB();
        if(failure!=='flush'){check(await state()===expected,name+'/'+failure+' durable unchanged');check(await hash()===expectedHash,name+'/'+failure+' exact durable precision');await operation();}
        await restore();
        results.push(name+'/'+failure);
        yield name+'/'+failure;
      }
    }
    // Record-local concurrency: even sub-millisecond imports must invalidate drafts.
    const draft=(await db.getBeans()).find(v=>v.id===bean.id);
    await db.importData([{target:'beans',name:'beans.csv',data:csv}]);
    const imported=await state();let conflict;
    try{await db.updateBean(bean.id,{...draft,name:'Stale overwrite'},draft);}catch(e){conflict=e;}
    check(conflict instanceof db.EditConflictError && await state()===imported,'stale bean rejected');
    const microDraft=(await db.getBeans()).find(v=>v.id===bean.id);
    await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(new TextDecoder().decode(csv).replace('.123456Z','.123457Z'))}]);
    check((await db.getBeans()).find(v=>v.id===bean.id).created_at===microDraft.created_at,'fixture differs below displayed millisecond');
    conflict=null;try{await db.updateBean(bean.id,{...microDraft},microDraft);}catch(e){conflict=e;}
    check(conflict instanceof db.EditConflictError,'microsecond-only bean import rejects stale draft');
    const photoCanvas=document.createElement('canvas');photoCanvas.width=photoCanvas.height=4;
    for(const photo of [photoCanvas.toDataURL('image/jpeg'),null]) {
      const photoDraft=(await db.getBeans()).find(v=>v.id===bean.id);
      const quote=v=>v==null?'\\N':'"'+String(v).replaceAll('"','""')+'"';
      const replacement=['id,name,roast_date,freeze_date,created_at,photo_jpeg',[bean.id,photoDraft.name,null,'2026-03-01','2024-01-02T03:04:05.123457Z',photo].map(quote).join(',')].join('\n');
      await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(replacement)}]);
      const preserved=await hash();conflict=null;
      try{await db.updateBean(bean.id,{...photoDraft},photoDraft);}catch(e){conflict=e;}
      check(conflict instanceof db.EditConflictError&&await hash()===preserved,'imported photo/null/date values cannot be overwritten by stale draft');
    }
    const fresh=(await db.getBeans()).find(v=>v.id===bean.id);
    const unrelated=await db.addBean({name:'Unrelated record'});
    await db.updateBean(bean.id,{...fresh},fresh);
    await db.deleteBean(unrelated.id);
    const currentSession=(await db.getBrewSessions()).find(v=>v.id===session.id);
    await db.updateBrewSession(session.id,{...currentSession,brewed_at:'2024-01-02T03:04:05.123456Z'});
    const microSession=(await db.getBrewSessions()).find(v=>v.id===session.id);
    const sessionsCSV=(await db.exportData('csv'))[1];
    await db.importData([{target:'brew_sessions',name:'sessions.csv',data:new TextEncoder().encode(new TextDecoder().decode(sessionsCSV.data).replace('05.123456','05.123457'))}]);
    conflict=null;try{await db.updateBrewSession(session.id,{...microSession},microSession);}catch(e){conflict=e;}
    check(conflict instanceof db.EditConflictError,'microsecond-only session import rejects stale draft');
    const sdraft=(await db.getBrewSessions()).find(v=>v.id===session.id);
    await db.updateBrewSession(session.id,{...sdraft,comment:'Imported while editing'});
    conflict=null;try{await db.updateBrewSession(session.id,{...sdraft},sdraft);}catch(e){conflict=e;}
    check(conflict instanceof db.EditConflictError,'stale session rejected');
    await db.deleteBean(bean.id);
    conflict=null;try{await db.updateBean(bean.id,{...fresh},fresh);}catch(e){conflict=e;}
    check(conflict instanceof db.EditConflictError,'deleted draft rejected');
    await b.replaceBackup(await b.prepareBackup(before.data));
    return {mode,results};
    })();return true;
  `);
  let matrix;
  try {
    for (;;) {
      const step=await evaluate('return await window.__reviewMatrix.next();');
      if(step.done){matrix=step.value;break;}
    }
  } finally { await sync('delete window.__reviewMatrix;'); }
  console.log('PASS review commit matrix and record-local edit conflicts',matrix.mode,matrix.results.length);

  const photos = await evaluate(String.raw`
    const db=await getDB(), b=await getBackups(), check=(v,m)=>{if(!v)throw Error(m);};
    const before=await b.saveBackup();
    for(const photo of ['data:image/jpeg;base64,/9j/','data:image/jpeg;base64,/9j/===','data:image/jpeg;base64,/9j/a']) {
      let rejected=false;try{await db.addBean({name:'Bad new photo',photo_jpeg:photo});}catch{rejected=true;}check(rejected,'reject malformed new photo');
    }
    const csv=new TextEncoder().encode('id,name,roast_date,freeze_date,created_at,photo_jpeg\nlegacy-review,Legacy photo,\\N,\\N,2024-01-02T03:04:05.123456Z,"data:image/jpeg;base64,/9j/"\n');
    const file={target:'beans',name:'beans.csv',data:csv};
    let rejected=false;try{await db.importData([file]);}catch{rejected=true;}check(rejected,'default import rejects truncated photo');
    await db.importData([file],{preserveLegacyPhotos:true});
    const bean=(await db.getBeans()).find(v=>v.id==='legacy-review');
    await db.updateBean(bean.id,{...bean,name:'Legacy retained'},bean);
    const legacyCSV=(await db.exportData('csv'))[0].data;
    const legacyParquet=(await db.exportData('parquet'))[0].data;
    const archive=await b.saveBackup(),prepared=await b.prepareBackup(archive.data);
    check(prepared.manifest.format_version===2 && prepared.manifest.photo_encoding==='legacy-opaque-v1','explicit versioned compatibility archive');
    check(prepared.preview.legacyPhotos===true,'compatibility preview');
    await db.closeDB();await db.initDB();
    check((await db.getBeans()).find(v=>v.id===bean.id).photo_jpeg===bean.photo_jpeg,'startup preserves original bytes');
    await db.deleteBean(bean.id);await b.confirmBackup(await b.prepareBackup(archive.data));
    check((await db.getBeans()).find(v=>v.id===bean.id).photo_jpeg===bean.photo_jpeg,'archive roundtrip original bytes');
    for(const [name,data] of [['beans.csv',legacyCSV],['beans.parquet',legacyParquet]]) {
      await db.importData([{target:'beans',name,data}],{preserveLegacyPhotos:true});
      check((await db.getBeans()).find(v=>v.id===bean.id).photo_jpeg===bean.photo_jpeg,'historical '+name+' bytes');
    }
    await b.replaceBackup(await b.prepareBackup(before.data));
    check((await b.prepareBackup((await b.saveBackup()).data)).manifest.format_version===1,'healthy collection keeps v1');
    // Profile several photo-heavy immutable recoveries against the old value cursor.
    const canvas=document.createElement('canvas');canvas.width=canvas.height=768;
    const ctx=canvas.getContext('2d'),image=ctx.createImageData(768,768);let noise=123456789;
    for(let i=0;i<image.data.length;i++){noise^=noise<<13;noise^=noise>>>17;noise^=noise<<5;image.data[i]=i%4===3?255:noise&255;}
    ctx.putImageData(image,0,0);
    const large=await db.addBean({name:'Photo-heavy recovery',photo_jpeg:canvas.toDataURL('image/jpeg',0.85)});
    const largeArchive=await b.saveBackup();
    for(let i=0;i<4;i++) {
      const current=(await db.getBeans()).find(v=>v.id===large.id);
      await db.updateBean(large.id,{...current,name:'Photo-heavy recovery '+i});
      await b.confirmBackup(await b.prepareBackup(largeArchive.data));
    }
    await b.replaceBackup(await b.prepareBackup(before.data));
    const store=await new Promise((resolve,reject)=>{const r=indexedDB.open('coffeos-snapshots',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const scanStart=performance.now();let payloadBytes=0,copies=0;
    await new Promise((resolve,reject)=>{const tx=store.transaction('snapshots','readonly'),r=tx.objectStore('snapshots').openCursor(IDBKeyRange.bound('import-recovery-v1:','import-recovery-v1:\uffff'));r.onsuccess=()=>{const c=r.result;if(c){copies++;payloadBytes+=c.value.data.beans.length+c.value.data.brew_sessions.length;c.continue();}};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    const valueScanMs=performance.now()-scanStart;store.close();
    // New recovery entries list metadata, never their large immutable payloads.
    let payloadReads=0;const get=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){if(String(key).startsWith('import-recovery-v1:'))payloadReads++;return get.call(this,key);};
    const indexedStart=performance.now();
    try{await db.listImportRecoveries();}finally{IDBObjectStore.prototype.get=get;}
    const indexedMs=performance.now()-indexedStart;
    check(payloadBytes>1000000,'multiple photo-heavy copies measured');
    check(payloadReads===0,'indexed recovery listing reads no Parquet payloads');
    return {copies,payloadBytes,valueScanMs,indexedMs,payloadReads};
  `);
  console.log('PASS malformed-photo rejection, v2 byte-preserving compatibility, old CSV/Parquet, reopen and lightweight recovery listing',photos);

  // Exercise actual collection UI warning and preserved editor draft.
  const bean=await evaluate(`return (await getDB()).addBean({name:'Visible review warning'});`);
  await sync(`document.querySelector('#tab-bean-manager').click();`);
  await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy')==='false'`);
  const selector=`.bean-card[data-bean-id="${bean.id}"]`;
  await sync(`document.querySelector('${selector} .bean-actions').click();document.querySelector('${selector} .bean-edit').click();document.querySelector('#bean-name').value='My kept draft';`);
  await evaluate(`const db=await getDB();const current=(await db.getBeans()).find(b=>b.id==='${bean.id}');await db.updateBean(current.id,{...current,name:'New imported record',roast_date:'2026-01-01'});`);
  await sync(`document.querySelector('.bean-form').requestSubmit();`);
  await waitFor(`!document.querySelector('.bean-form fieldset').disabled`);
  assert.match(await sync(`return document.querySelector('.bean-form .form-error').textContent;`),/changed or was deleted/);
  assert.equal(await sync(`return document.querySelector('#bean-name').value;`),'My kept draft');
  assert.equal(await evaluate(`return (await (await getDB()).getBeans()).find(b=>b.id==='${bean.id}').name;`),'New imported record');
  await sync(`document.querySelector('.cancel-bean').click();document.querySelector('#tab-bean-manager').click();`);
  await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy')==='false'`);
  await evaluate(`const Duck=window.__testConnection ?? (await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;const query=Duck.prototype.query;window.__restoreWarning=()=>Duck.prototype.query=query;Duck.prototype.query=function(sql){if(sql==='CHECKPOINT')return Promise.reject(Error('Injected durability warning'));return query.call(this,sql);};`);
  await sync(`document.querySelector('${selector} .bean-actions').click();document.querySelector('${selector} .bean-delete').click();`);
  await waitFor(`!document.querySelector('.collection-warning').hidden`);
  await evaluate(`window.__restoreWarning();`);
  const warning=await sync(`const e=document.querySelector('.collection-warning');return {visible:e.getClientRects().length>0,role:e.getAttribute('role'),formClosed:document.querySelector('.bean-form').hidden,text:e.textContent};`);
  assert.equal(warning.visible,true);assert.equal(warning.role,'alert');assert.equal(warning.formClosed,true);assert.match(warning.text,/Deletion was applied/);
  // A healthy write confirms durability after the deliberately failed flush.
  await evaluate(`const db=await getDB();const b=await db.addBean({name:'Flush recovery'});await db.deleteBean(b.id);`);
  console.log('PASS actual stale draft stays open, imported record retained, committed delete alert visibly rendered outside closed editor');
}

export async function checkHistoryScale({sync,evaluate,waitFor}) {
  const fixture=await evaluate(String.raw`
    const db=await getDB(), b=await getBackups();window.__scaleBefore=await b.saveBackup();
    const bean=await db.addBean({name:'1,000 session history'});
    const headers=['id','bean_id','brewed_at','dose_g','water_g','time_str','temp_c','grind_um','comment','yield_g','tds_pct','extraction_pct'];
    const rows=Array.from({length:1000},(_,i)=>['scale-'+String(i).padStart(4,'0'),bean.id,'2026-10-28T12:00:00.'+String(i).padStart(6,'0')+'Z','18.1234567890123','250','02:30','94','700','History '+i,'210','1.4','19.6'].join(','));
    await db.importData([{target:'brew_sessions',name:'sessions.csv',data:new TextEncoder().encode([headers.join(','),...rows].join('\n'))}]);
    return {id:bean.id,expected:(await db.getBrewSessions(bean.id)).map(s=>s.id)};
  `);
  await sync(`window.__historyStart=performance.now();document.querySelector('#tab-bean-manager').click();`);
  await waitFor(`document.querySelector('.bean-list').getAttribute('aria-busy')==='false'`);
  const metrics=await sync(`return {rows:document.querySelectorAll('.bean-session').length,nodes:document.querySelector('.bean-list').querySelectorAll('*').length,elapsedMs:performance.now()-window.__historyStart};`);
  assert.equal(metrics.rows,0,'collapsed histories never construct 1,000 metrics subtrees');
  const selector=`.bean-card[data-bean-id="${fixture.id}"]`;
  assert.equal(await sync(`return document.querySelector('${selector} .session-count').textContent;`),'1000 brew sessions');
  await sync(`document.querySelector('${selector} summary').click();`);
  const seen=[];
  for(let page=0;page<20;page++) {
    await waitFor(`document.querySelector('${selector} .history-status').textContent==='${page*50+1}–${page*50+50} of 1000 sessions'`);
    const ids=await sync(`return [...document.querySelectorAll('${selector} .bean-session')].map(s=>s.dataset.sessionId);`);
    assert.equal(ids.length,50);seen.push(...ids);
    if(page<19)await sync(`document.querySelector('${selector} .bean-history button:last-child').click();`);
  }
  assert.deepEqual(seen,fixture.expected,'all history reachable in exact timestamp/id order');
  await sync(`document.querySelector('${selector} .bean-history button:first-child').click();`);
  await waitFor(`document.querySelector('${selector} .history-status').textContent==='901–950 of 1000 sessions'`);
  await sync(`document.querySelector('${selector} summary').click();`);
  await evaluate(`const b=await getBackups();await b.replaceBackup(await b.prepareBackup(window.__scaleBefore.data));delete window.__scaleBefore;`);
  console.log('PASS 1,000-session histories: zero collapsed rows, bounded pages, all records/order/back navigation',metrics);
}

export async function checkRuntimeWorkerFailure({evaluate}) {
  const result=await evaluate(String.raw`
    const db=await getDB(), check=(v,m)=>{if(!v)throw Error(m);};
    const state=async()=>JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()});
    const expected=await state();
    await db.closeDB();
    const NativeWorker=Worker;const workers=[];
    window.Worker=class extends NativeWorker {constructor(...args){super(...args);workers.push(this);}};
    try{await db.initDB();}finally{window.Worker=NativeWorker;}
    const Duck=window.__testConnection ?? (await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;
    const prepare=Duck.prototype.prepare;
    let reached;const waiting=new Promise(resolve=>reached=resolve);
    Duck.prototype.prepare=function(sql){if(sql.includes('FROM beans ORDER BY')){const request=prepare.call(this,sql);reached();return request;}return prepare.call(this,sql);};
    const pending=db.getBeans().then(()=>null,e=>e);
    await waiting;
    workers.at(-1).dispatchEvent(new ErrorEvent('error',{message:'Injected post-startup worker failure'}));
    const error=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve(null),1000))]);
    Duck.prototype.prepare=prepare;
    check(error instanceof db.DatabaseRuntimeError,'pending caller rejects promptly after runtime failure');
    let rejected;try{await db.addBean({name:'Must never start after worker failure'});}catch(e){rejected=e;}
    check(rejected instanceof db.DatabaseRuntimeError,'failed engine is quarantined');
    check(document.querySelector('.storage-warning[role=alert]')?.textContent.includes('may or may not have committed'),'unknown-outcome warning visible');
    await db.closeDB();await db.initDB();check(await state()===expected,'original storage survives runtime failure and explicit reopen');
    // Repeat with a real editor save waiting on a prepared-statement SDK request.
    await db.closeDB();workers.length=0;
    window.Worker=class extends NativeWorker {constructor(...args){super(...args);workers.push(this);}};
    try{await db.initDB();}finally{window.Worker=NativeWorker;}
    document.querySelector('#tab-bean-manager').click();
    while(document.querySelector('.bean-list').getAttribute('aria-busy')!=='false')await new Promise(r=>setTimeout(r,5));
    if(document.querySelector('.bean-form').hidden)document.querySelector('.add-bean-toggle').click();
    document.querySelector('#bean-name').value='Keep runtime failure draft';
    let savingReached;const savingPending=new Promise(resolve=>savingReached=resolve);
    Duck.prototype.prepare=function(sql){const request=prepare.call(this,sql);if(sql.startsWith('INSERT INTO beans'))savingReached();return request;};
    document.querySelector('.bean-form').requestSubmit();await savingPending;
    workers.at(-1).dispatchEvent(new ErrorEvent('error',{message:'Injected worker failure during save'}));
    for(let i=0;i<200&&document.querySelector('.bean-form fieldset').disabled;i++)await new Promise(r=>setTimeout(r,5));
    Duck.prototype.prepare=prepare;
    check(!document.querySelector('.bean-form fieldset').disabled,'saving UI settles after worker failure');
    check(document.querySelector('#bean-name').value==='Keep runtime failure draft','unknown-outcome draft retained');
    const warning=document.querySelector('.bean-form .form-error').textContent;
    check(warning.includes('may or may not have committed')&&!warning.includes('try again'),'saving UI reports unknown outcome without retry advice');
    await db.closeDB();await db.initDB();check(await state()===expected,'interrupted preparation preserved exact durable records');
    // Fault an actual pending COMMIT: IDB keepalive must release its transaction,
    // and neither backend may issue a speculative rollback of an unknown outcome.
    await db.closeDB();workers.length=0;
    window.Worker=class extends NativeWorker {constructor(...args){super(...args);workers.push(this);}};
    try{await db.initDB();}finally{window.Worker=NativeWorker;}
    const query=Duck.prototype.query;let commitReached,rollbacks=0;
    const commitPending=new Promise(resolve=>commitReached=resolve);
    Duck.prototype.query=function(sql){if(sql==='ROLLBACK')rollbacks++;const request=query.call(this,sql);if(sql==='COMMIT')commitReached();return request;};
    const committing=db.addBean({name:'Unknown COMMIT fixture'}).then(()=>null,e=>e);
    await commitPending;workers.at(-1).dispatchEvent(new ErrorEvent('error',{message:'Injected failure during COMMIT'}));
    const commitError=await Promise.race([committing,new Promise(resolve=>setTimeout(()=>resolve(null),1000))]);
    Duck.prototype.query=query;
    check(commitError instanceof db.DatabaseRuntimeError,'pending COMMIT reports unknown outcome promptly');
    await db.closeDB();await Promise.race([db.initDB(),new Promise((_,reject)=>setTimeout(()=>reject(Error('IDB keepalive blocked explicit reopen')),5000))]);
    const after={beans:await db.getBeans(),sessions:await db.getBrewSessions()},mode=db.getStorageMode();
    if(mode==='indexeddb')check(JSON.stringify(after)===expected,'runtime failure never publishes candidate IDB snapshot');
    else {
      const original=JSON.parse(expected),maybe=after.beans.filter(b=>b.name==='Unknown COMMIT fixture');
      check(JSON.stringify({beans:after.beans.filter(b=>b.name!=='Unknown COMMIT fixture'),sessions:after.sessions})===expected,'OPFS keeps every original record across unknown COMMIT');
      check(maybe.length<=1,'unknown OPFS commit never duplicated');
      for(const bean of maybe)await db.deleteBean(bean.id);
    }
    check(rollbacks===0,'unknown COMMIT never triggers speculative rollback');
    check(await state()===expected,'exact original collection available after recovery');
    return {mode:db.getStorageMode(),pendingRejected:true,quarantined:true,savingUISettled:true,commitReopen:true};
  `);
  console.log('PASS post-instantiation worker failure rejects pending UI work, quarantines engine, warns about unknown outcome and preserves exact data',result);
}
