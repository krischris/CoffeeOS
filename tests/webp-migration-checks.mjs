import assert from 'node:assert/strict';

/** Only run in isolated automation collections: reset the new migration marker. */
export async function checkWebPMigration({evaluate}) {
  const mode = await evaluate('return (await getDB()).getStorageMode();');
  for (const fault of mode === 'opfs' ? ['recovery', 'encode'] : ['recovery', 'encode', 'snapshot']) {
    const result = await evaluate(String.raw`
      const fault=${JSON.stringify(fault)},db=await getDB();
      const check=(value,message)=>{if(!value)throw Error(message);};
      const store=await new Promise((resolve,reject)=>{const r=indexedDB.open('coffeos-snapshots',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const read=key=>new Promise((resolve,reject)=>{const tx=store.transaction('snapshots');const r=tx.objectStore('snapshots').get(key);tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);});
      const unmark=()=>new Promise((resolve,reject)=>{const tx=store.transaction('snapshots','readwrite');tx.objectStore('snapshots').delete('photo-webp-migration-v1');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
      const jpeg=canvas.toDataURL('image/jpeg');
      const first=await db.addBean({name:'Migration '+fault,photo_jpeg:jpeg,roast_date:'2024-01-02'});
      const second=await db.addBean({name:'Second migration '+fault,photo_jpeg:jpeg});
      const damaged=await db.importData([{target:'beans',name:'damaged.csv',data:new TextEncoder().encode('id,name,roast_date,freeze_date,created_at,photo_jpeg\nwebp-damaged-'+fault+',Damaged,\\N,\\N,2024-01-02T03:04:05.123456Z,"data:image/jpeg;base64,/9j/"\n')}],{preserveLegacyPhotos:true});
      await db.addBrewSession({bean_id:first.id,dose_g:18.1234567890123,water_g:0,time_str:'',temp_c:null,grind_um:700.123456789,
        comment:'  exact\n☕  ',yield_g:null,tds_pct:1.4300000000000002,extraction_pct:null});
      const before={beans:await db.getBeans(),sessions:await db.getBrewSessions()};
      const originalHash=await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data);
      const normalized=async()=>JSON.stringify((await db.exportData('csv')).map(file=>new TextDecoder().decode(file.data).replace(/"data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/=]+"/g,'\\N')));
      const fields=await normalized(),mode=db.getStorageMode();
      await db.closeDB();await unmark();
      const saved=await read('tables-v1');
      const savedHash=saved?JSON.stringify(await Promise.all(['beans','brew_sessions'].map(async table=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',saved[table]))]))):null;
      const add=IDBObjectStore.prototype.add,put=IDBObjectStore.prototype.put,context=HTMLCanvasElement.prototype.getContext;
      let contexts=0;
      IDBObjectStore.prototype.add=function(value,key){if(fault==='recovery'&&String(key).startsWith('import-recovery-v1:'))throw Error('Injected photo recovery failure');return add.call(this,value,key);};
      IDBObjectStore.prototype.put=function(value,key){if(fault==='snapshot'&&key==='tables-v1')throw Error('Injected photo snapshot failure');return put.call(this,value,key);};
      HTMLCanvasElement.prototype.getContext=function(...args){if(fault==='encode'&&++contexts===2)return null;return context.apply(this,args);};
      let failure;
      try {await db.initDB();}catch(error){failure=String(error);}
      finally {IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.put=put;HTMLCanvasElement.prototype.getContext=context;}
      check(failure&&db.getStorageMode()===null,'failed migration never exposes an empty replacement');
      const afterFailure=await read('tables-v1');
      if(savedHash)check(JSON.stringify(await Promise.all(['beans','brew_sessions'].map(async table=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',afterFailure[table]))])))===savedHash,'failed migration preserves exact durable snapshot bytes');
      check(await read('photo-webp-migration-v1')===undefined,'failure does not mark migration complete');
      const originalURL=URL.createObjectURL,inputs=[];
      URL.createObjectURL=function(blob){if(blob.name==='saved-photo.jpg')inputs.push(blob);return originalURL.call(this,blob);};
      try {await db.initDB();}finally {URL.createObjectURL=originalURL;}
      const converted=await db.getBeans();
      check(inputs.length===2,'retry sees both original JPEGs after rollback');
      for(const input of inputs)check(btoa(String.fromCharCode(...new Uint8Array(await input.arrayBuffer())))===jpeg.split(',')[1],'retry preserves original source JPEG bytes');
      for(const id of [first.id,second.id]){
        const bean=converted.find(bean=>bean.id===id);
        check(bean.photo_jpeg===null&&bean.photo_webp?.startsWith('data:image/webp;base64,'),'JPEG replaced by WebP');
        check(atob(bean.photo_webp.split(',')[1]).length<=100000,'migrated output byte cap');
      }
      check(converted.find(bean=>bean.id==='webp-damaged-'+fault).photo_jpeg==='data:image/jpeg;base64,/9j/','damaged historical bytes retained');
      check(db.getPhotoMigrationNotice()?.includes('damaged'),'damaged-photo notice');
      check(await normalized()===fields,'all non-photo CSV values, microseconds and precision are unchanged');
      const copies=await db.listImportRecoveries();let found=false;
      for(const copy of copies)if(await db.hashBackupContents((await db.readImportRecovery(copy.key)).data)===originalHash)found=true;
      check(found,'downloadable pre-migration recovery retains every original value');
      const after=JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()}),count=copies.length;
      await db.closeDB();URL.createObjectURL=()=>{throw Error('Completed migration must not encode again');};
      try{await db.initDB();}finally{URL.createObjectURL=originalURL;}
      check(JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()})===after,'reload keeps exact WebP and records');
      check((await db.listImportRecoveries()).length===count,'reload does not create another migration recovery');
      await db.deleteBean(first.id);await db.deleteBean(second.id);await db.deleteBean('webp-damaged-'+fault);
      store.close();return {fault,mode,jpegs:inputs.length,recoveries:count};
    `);
    assert.equal(result.jpegs,2);
    console.log('PASS WebP migration rollback/retry, recovery, precision and once-only reload',result);
  }
}
