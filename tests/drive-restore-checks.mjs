import assert from 'node:assert/strict';
/** Run against both isolated backends, including the production upgrade harness. */
export async function checkDriveRestore({ evaluate, api, ready }) {
  const result = await evaluate(String.raw`
    const db=await getDB(), b=await getBackups();
    const check=(v,m)=>{if(!v)throw new Error(m);};
    const rejects=async(fn,m)=>{let failed=false;try{await fn();}catch{failed=true;}check(failed,m);};
    const state=async()=>JSON.stringify((await db.exportData('csv',false)).map(f=>new TextDecoder().decode(f.data)));
    const original=await b.saveBackup(), originalState=await state();
    const local=await db.addBean({name:'Local-only replacement fixture',roast_date:'2026-01-01'});
    await db.addBrewSession({bean_id:local.id,dose_g:17.1234567890123,water_g:0,comment:'Recovery\n精度',temp_c:null,time_str:'',grind_um:null,yield_g:null,tds_pct:null,extraction_pct:null});
    const before=await state(), snapshot=await b.prepareBackup(original.data);
    check(snapshot.preview.beans.localOnly===1&&snapshot.preview.brew_sessions.localOnly===1,'local-only preview');
    await b.confirmBackup(snapshot);check(await state()===before,'merge kept local-only records');
    const stale=await b.prepareBackup(original.data);
    const race=await db.addBean({name:'Stale preview fixture'});
    const changed=await state();const refreshed=await b.replaceBackup(stale);
    check('revision' in refreshed&&await state()===changed,'replacement requires reconfirmation');
    await db.deleteBean(race.id);
    const connection=window.__testConnection??(await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;
    const query=connection.prototype.query;
    for(const fail of ['DROP TABLE beans','INSERT INTO beans SELECT * FROM incoming_beans','INSERT INTO brew_sessions SELECT * FROM incoming_brew_sessions','COMMIT']){
      const p=await b.prepareBackup(original.data);
      connection.prototype.query=function(sql){if(sql===fail)return Promise.reject(new Error('Injected replacement failure'));return query.call(this,sql);};
      try{await rejects(()=>b.replaceBackup(p),'replacement should fail '+fail);}finally{connection.prototype.query=query;}
      check(await state()===before,'replacement rollback '+fail);
    }
    const add=IDBObjectStore.prototype.add;
    const p=await b.prepareBackup(original.data);
    IDBObjectStore.prototype.add=function(value,key){if(String(key).startsWith('import-recovery-v1:'))throw new Error('Injected recovery failure');return add.call(this,value,key);};
    try{await rejects(()=>b.replaceBackup(p),'recovery creation failure');}finally{IDBObjectStore.prototype.add=add;}
    check(await state()===before,'recovery failure kept original');
    if(db.getStorageMode()==='indexeddb'){
      const put=IDBObjectStore.prototype.put;
      const p=await b.prepareBackup(original.data);
      IDBObjectStore.prototype.put=function(value,key){if(key==='tables-v1')throw new Error('Injected snapshot failure');return put.call(this,value,key);};
      try{await rejects(()=>b.replaceBackup(p),'durable snapshot failure');}finally{IDBObjectStore.prototype.put=put;}
      check(await state()===before,'snapshot failure kept original');
    }
    const previous=new Set((await db.listImportRecoveries()).map(c=>c.key));
    await b.replaceBackup(await b.prepareBackup(original.data));
    check(await state()===originalState,'replacement exact archive contents');
    const copies=(await db.listImportRecoveries()).filter(c=>!previous.has(c.key));check(copies.length===1,'one durable recovery');
    const recovery=await b.packageBackup(await db.readImportRecovery(copies[0].key));
    await b.replaceBackup(await b.prepareBackup(recovery.data));check(await state()===before,'downloadable recovery exact previous records');
    const commit=await b.prepareBackup(original.data);
    connection.prototype.query=function(sql){if(sql==='CHECKPOINT')return Promise.reject(new Error('Injected post-commit failure'));return query.call(this,sql);};
    let committed=false;try{await b.replaceBackup(commit);}catch(error){committed=error instanceof db.CommittedWriteError;}finally{connection.prototype.query=query;}
    check(committed&&await state()===originalState,'committed warning without retry');
    // A forced CHECKPOINT failure intentionally does not promise reload durability.
    // Export the committed collection, then allow a normal successful write to flush.
    check(!!(await b.prepareBackup((await b.saveBackup()).data)), 'committed state remains exportable');
    const current=(await db.getBeans())[0];await db.updateBean(current.id,current);
    check(await state()===originalState,'healthy flush preserves committed values');
    return {originalState, recoveryKey:copies[0].key, mode:db.getStorageMode()};
  `);
  await api('/refresh', {}); await ready();
  const reloaded = await evaluate(`const db=await getDB(),b=await getBackups();const recovery=await b.packageBackup(await db.readImportRecovery(${JSON.stringify(result.recoveryKey)}));return {state:JSON.stringify((await db.exportData('csv',false)).map(f=>new TextDecoder().decode(f.data))),prepared:!!(await b.prepareBackup(recovery.data))};`);
  assert.equal(reloaded.state, result.originalState);
  assert.equal(reloaded.prepared, true);
  console.log('PASS Drive merge/replace, local-only counts, stale preview, recovery failure, deletion/insertion/commit rollback, durability warning, recovery archive and reload', result.mode);
}
