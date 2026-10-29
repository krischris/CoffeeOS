import assert from 'node:assert/strict';
export async function checkBackups({sync,evaluate,waitFor,reload}) {
 const runtime = await evaluate(String.raw`
 const db=await getDB(), backups=await getBackups(), zip=await getZIP();
 const check=(v,m)=>{if(!v)throw new Error(m);};
 const same=(a,b,m)=>check(JSON.stringify(a)===JSON.stringify(b),m);
 const state=async()=>({beans:await db.getBeans(),sessions:await db.getBrewSessions()});
 const rejected=async(fn,label)=>{let failed=false;try{await fn();}catch{failed=true;}check(failed,label);};
 const initial=await state();
 const historical=zip.unzipSync(new Uint8Array(await (await fetch('/docs/fixtures/example-v1.coffeeos')).arrayBuffer()));
 const oldManifest=JSON.parse(new TextDecoder().decode(historical['manifest.json']));
 oldManifest.legacy_photo_encoding='legacy-opaque-v1';
 historical['manifest.json']=new TextEncoder().encode(JSON.stringify(oldManifest));
 const oldPrepared=await backups.prepareBackup(zip.zipSync(historical,{level:0}));
 check(oldPrepared.manifest.format_version===1&&!backups.preservesLegacyPhotos(oldPrepared.manifest),'historical unknown metadata stays informational');
 const empty=await backups.saveBackup();
 let prepared=await backups.prepareBackup(empty.data);
 check(prepared.preview.beans.new===0,'empty preview');
 await backups.confirmBackup(prepared);same(await state(),initial,'empty unchanged');
 const beanCSV='id,name,roast_date,freeze_date,created_at,photo_jpeg\n"portable","咖啡 ☕","2026-10-01",\\N,"2026-10-25T10:20:30.123456Z",\\N\n"no-sessions","Bean alone",\\N,"2026-09-01","2026-09-01T00:00:00.000001Z",\\N\n';
 const sessionCSV='id,bean_id,brewed_at,dose_g,water_g,time_str,temp_c,grind_um,comment,yield_g,tds_pct,extraction_pct\n"precise","portable","2026-10-25T10:21:30.654321Z",18.123456789012345,0,"",\\N,700.1234567890123,"Line 1\n行 2 ☕",250,1.4300000000000002,19.999999999999996\n"sparse","portable","2026-10-25T10:21:30.000001Z",\\N,\\N,\\N,\\N,\\N,"",\\N,\\N,\\N\n';
 await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(beanCSV)},{target:'brew_sessions',name:'sessions.csv',data:new TextEncoder().encode(sessionCSV)}]);
 const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);
 const source=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 const photo=await (await import('/src/photos.ts')).compressBeanPhoto(new File([source],'photo.png',{type:'image/png'}));
 await db.addBean({name:'Photo',photo_webp:photo});
 const expected=await state();
 const exported=await backups.saveBackup();window.__archive=exported;
 const unzipped=zip.unzipSync(exported.data);
 same(Object.keys(unzipped).sort(),['beans.parquet','brew_sessions.parquet','manifest.json'],'entries');
 check(backups.inspectArchive(exported.data).every(e=>e.method===0),'STORE export');
 const manifest=JSON.parse(new TextDecoder().decode(unzipped['manifest.json']));
 check(manifest.tables[0].row_count===3 && manifest.tables[1].row_count===2,'counts');
 prepared=await backups.prepareBackup(exported.data);
 check(prepared.preview.beans.unchanged===3 && prepared.preview.brew_sessions.unchanged===2,'unchanged counts');
 await backups.confirmBackup(prepared);await backups.confirmBackup(prepared);same(await state(),expected,'repeat no duplication');
 const repack=zip.zipSync(unzipped,{level:6});
 await backups.prepareBackup(repack);
 const pack=(entries=unzipped)=>zip.zipSync(entries,{level:0});
 const changedManifest=(fn)=>{const m=structuredClone(manifest);fn(m);return pack({...unzipped,'manifest.json':new TextEncoder().encode(JSON.stringify(m))});};
 const invalid=[
 ['truncated',exported.data.subarray(0,exported.data.length-4)],['junk',new Uint8Array([1,2,3])],
 ['version',changedManifest(m=>m.format_version=2)],['schema version',changedManifest(m=>m.data_schema_version=3)],
 ['hash',changedManifest(m=>m.tables[0].sha256='0'.repeat(64))],['count',changedManifest(m=>m.tables[0].row_count=999)],
 ['unit',changedManifest(m=>m.tables[1].columns[3].unit='kg')],['columns',changedManifest(m=>m.tables[0].columns.reverse())],
 ['negative',changedManifest(m=>m.tables[0].byte_length=-1)],['unsafe',changedManifest(m=>m.tables[0].row_count=Number.MAX_SAFE_INTEGER+1)],
 ['bad utf8',pack({...unzipped,'manifest.json':new Uint8Array([255])})],['bad json',pack({...unzipped,'manifest.json':new TextEncoder().encode('{')})],
 ['missing',pack({'manifest.json':unzipped['manifest.json'],'beans.parquet':unzipped['beans.parquet']})],
 ['extra',pack({...unzipped,'extra.txt':new Uint8Array()})],
 ['path',pack({'../manifest.json':unzipped['manifest.json'],'beans.parquet':unzipped['beans.parquet'],'brew_sessions.parquet':unzipped['brew_sessions.parquet']})],
 ['oversize manifest',pack({...unzipped,'manifest.json':new Uint8Array(65537)})],
 ];
 const edit=(fn)=>{const b=new Uint8Array(exported.data);const v=new DataView(b.buffer);const p=[];for(let i=0;i<b.length-4;i++)if(v.getUint32(i,true)===0x02014b50)p.push(i);fn(b,v,p);return b;};
 invalid.push(['encrypted',edit((b,v,p)=>v.setUint16(p[0]+8,1,true))],
 ['compression',edit((b,v,p)=>v.setUint16(p[0]+10,99,true))],
 ['duplicate',edit((b,v,p)=>{v.setUint32(p[1]+42,v.getUint32(p[0]+42,true),true);})],
 ['local conflict',edit((b,v)=>v.setUint32(18,100,true))],
 ['CRC',edit((b)=>b[100]^=1)],
 ['size directory',edit((b,v,p)=>v.setUint32(p[1]+24,40*1024*1024,true))]);
 for(const [label,bytes]of invalid){await rejected(()=>backups.prepareBackup(bytes),label);same(await state(),expected,label+' changed data');}
 // A lying DEFLATE size must fail while receiving actual bytes, not only after extraction.
 const bomb=zip.zipSync({...unzipped,'manifest.json':new Uint8Array(100000).fill(32)},{level:9});
 const bv=new DataView(bomb.buffer);let central=-1;for(let p=0;p<bomb.length-4;p++)if(bv.getUint32(p,true)===0x02014b50){central=p;break;}
 bv.setUint32(22,100,true);bv.setUint32(central+24,100,true);
 await rejected(()=>backups.prepareBackup(bomb),'expanded byte bound');
 // Parquet/data validations use valid, hash-matching archives so checks reach staging.
 const files=await db.exportData('parquet');
 // Deliberately construct invalid external archives independently of the now-validating exporter.
 const encode=async(data,counts)=>{
   await rejected(()=>backups.packageBackup({data,counts,exported_at:manifest.exported_at}),'export must reject unreadable logical tables');
   const changed=structuredClone(manifest);
   for(const t of changed.tables){t.row_count=counts[t.name];t.byte_length=data[t.name].length;t.sha256=await backups.sha256(data[t.name]);}
   return {data:pack({'manifest.json':new TextEncoder().encode(JSON.stringify(changed)),'beans.parquet':data.beans,'brew_sessions.parquet':data.brew_sessions})};
 };
 const broken=await encode({beans:new Uint8Array([1,2]),brew_sessions:files[1].data},{beans:3,brew_sessions:2});
 await rejected(()=>backups.prepareBackup(broken.data),'corrupt parquet');
 const orphan=await encode({beans:(await backups.unpackBackup(empty.data)).files[0].data,brew_sessions:files[1].data},{beans:0,brew_sessions:2});
 await rejected(()=>backups.prepareBackup(orphan.data),'archive internal orphan despite live beans');
 const swapped=await encode({beans:files[1].data,brew_sessions:files[0].data},{beans:2,brew_sessions:3});
 await rejected(()=>backups.prepareBackup(swapped.data),'actual schema mismatch');
 same(await state(),expected,'invalid parquet changed data');
 // Retained selected bytes survive worker transfer and validation failures.
 check(exported.data.length>0 && files[0].data.length>0,'detached upload');
 // Save old archive; change a matching bean and a session with extra precision via legacy fixture.
 await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(beanCSV.replace('咖啡 ☕','Changed bean'))},
 {target:'brew_sessions',name:'sessions.csv',data:new TextEncoder().encode(sessionCSV.replace('Line 1','Changed comment'))}]);
 const changed=await state();
 prepared=await backups.prepareBackup(exported.data);check(prepared.preview.beans.updated===1 && prepared.preview.brew_sessions.updated===1,'updated counts');
 await db.addBean({name:'Intervening bean'});
 const stale=await backups.confirmBackup(prepared);check('revision'in stale,'stale preview applied');
 prepared.preview=stale;
 const beforeMerge=await state();
 const recoveriesBefore=await db.listImportRecoveries();
 const add=IDBObjectStore.prototype.add;
 IDBObjectStore.prototype.add=function(){throw new Error('Injected recovery quota');};
 try{await rejected(()=>backups.confirmBackup(prepared),'recovery failure');}finally{IDBObjectStore.prototype.add=add;}
 same(await state(),beforeMerge,'recovery failure changed live data');
 same(await db.listImportRecoveries(),recoveriesBefore,'failed copy overwrote recovery');
 // A failure on the second live table must roll back updates on the first.
 const duck=window.__testConnection ?? (await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;
 const query=duck.prototype.query;
 duck.prototype.query=function(sql){if(sql.startsWith('UPDATE brew_sessions SET'))return Promise.reject(new Error('Injected second-table failure'));return query.call(this,sql);};
 try{await rejected(()=>backups.confirmBackup(prepared),'atomic failure');}finally{duck.prototype.query=query;}
 same(await state(),beforeMerge,'transaction rollback');
 // SQL COMMIT rejection must not publish the candidate IndexedDB snapshot.
 if(db.getStorageMode()==='indexeddb'){
   const originalQuery=duck.prototype.query;
   duck.prototype.query=function(sql){if(sql==='COMMIT')return Promise.reject(new Error('Injected COMMIT failure'));return originalQuery.call(this,sql);};
   try{await rejected(()=>backups.confirmBackup(prepared),'COMMIT failure');}finally{duck.prototype.query=originalQuery;}
   same(await state(),beforeMerge,'COMMIT rollback');
   await db.closeDB();await db.initDB();same(await state(),beforeMerge,'COMMIT failure reload preserved original snapshot');
 }
 await backups.confirmBackup(prepared);
 const merged=await state();check(merged.beans.length===4,'missing local bean deleted');
 same(merged.sessions,expected.sessions,'exact sessions');
 check(merged.beans.find(b=>b.id==='portable').name==='咖啡 ☕','merge bean');
 const recoveries=await db.listImportRecoveries();check(recoveries.length>=recoveriesBefore.length+2,'immutable recovery copies');
 const recovery=await backups.packageBackup(await db.readImportRecovery(recoveries[0].key));
 const recoveryPreview=await backups.prepareBackup(recovery.data);check(recoveryPreview.preview.beans.updated===1,'recovery downloadable');
 const repeat=await backups.prepareBackup(exported.data);await backups.confirmBackup(repeat);same(await state(),merged,'idempotent');
 // A snapshot transaction abort after SQL commit must preserve the previous durable
 // snapshot and surface the committed-warning class, with live data still refreshed.
 if(db.getStorageMode()==='indexeddb'){
   await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(beanCSV.replace('咖啡 ☕','Changed before IDB abort'))}]);
   const pending=await backups.prepareBackup(exported.data);
   const originalPut=IDBObjectStore.prototype.put, originalQuery=duck.prototype.query;
   let snapshotTx;
   IDBObjectStore.prototype.put=function(value,key){if(key==='tables-v1')snapshotTx=this.transaction;return originalPut.call(this,value,key);};
   duck.prototype.query=function(sql){const result=originalQuery.call(this,sql);return sql==='COMMIT'?result.then(value=>{snapshotTx.abort();return value;}):result;};
   let warning;
   try{await backups.confirmBackup(pending);}catch(error){warning=error;}finally{IDBObjectStore.prototype.put=originalPut;duck.prototype.query=originalQuery;}
   check(warning instanceof db.CommittedWriteError,'post-commit IDB abort must warn');
   same(await state(),merged,'committed live collection');
   await db.closeDB();await db.initDB();
   check((await state()).beans.find(b=>b.id==='portable').name==='Changed before IDB abort','aborted IDB transaction kept previous durable snapshot');
   await backups.confirmBackup(await backups.prepareBackup(exported.data));
   same(await state(),merged,'explicit retry after reopening old durable snapshot');
 }
 // Restore the archive into a genuinely empty isolated snapshot database, preserving the real dataset.
 const realIDB=indexedDB;
 const idbDescriptor=Object.getOwnPropertyDescriptor(window,'indexedDB');
 const directoryDescriptor=Object.getOwnPropertyDescriptor(navigator.storage,'getDirectory');
 const isolationDescriptor=Object.getOwnPropertyDescriptor(window,'crossOriginIsolated');
 let roundtripArchive;
 const isolatedName='coffeeos-archive-test-'+crypto.randomUUID();
 await db.closeDB();
 try{
   Object.defineProperty(window,'indexedDB',{configurable:true,value:{open:()=>realIDB.open(isolatedName,1)}});
   Object.defineProperty(window,'crossOriginIsolated',{configurable:true,value:false});
   Object.defineProperty(navigator.storage,'getDirectory',{configurable:true,value:async()=>({getFileHandle:async()=>{throw new DOMException('missing','NotFoundError');}})});
   await db.initDB();
   let fresh=await backups.prepareBackup(empty.data);await backups.confirmBackup(fresh);
   same(await state(),{beans:[],sessions:[]},'empty archive into fresh database');
   fresh=await backups.prepareBackup(exported.data);
   check(fresh.preview.beans.new===3 && fresh.preview.brew_sessions.new===2,'new-ID preview');
   await backups.confirmBackup(fresh);same(await state(),expected,'fresh archive restore exact values');
   roundtripArchive=await backups.saveBackup();
   const roundtrip=await backups.unpackBackup(roundtripArchive.data);
   same(roundtrip.manifest.tables.map(t=>t.row_count),manifest.tables.map(t=>t.row_count),'roundtrip table counts');
 }finally{
   await db.closeDB();
   if(idbDescriptor)Object.defineProperty(window,'indexedDB',idbDescriptor);else delete window.indexedDB;
   if(directoryDescriptor)Object.defineProperty(navigator.storage,'getDirectory',directoryDescriptor);else delete navigator.storage.getDirectory;
   if(isolationDescriptor)Object.defineProperty(window,'crossOriginIsolated',isolationDescriptor);else delete window.crossOriginIsolated;
   realIDB.deleteDatabase(isolatedName);await db.initDB();
 }
 same(await state(),merged,'real dataset preserved after isolated restore');
 window.__expected=merged;
 return {example:Array.from(exported.data),roundtrip:Array.from(roundtripArchive.data),checks:invalid.length+5};
 `);
 console.log('PASS archive contract, empty/populated/photo/precision fixtures, STORE/DEFLATE, '+runtime.checks+' invalid archives, preview refresh, immutable recovery, failed recovery and atomic rollback');
 await reload();
 const recoveryCount=await evaluate(`return(await(await getDB()).listImportRecoveries()).length;`);assert.ok(recoveryCount>=2);
 await sync(`document.querySelector('#tab-io').click();`);
 assert.equal(await sync(`return document.querySelector('.io-recovery');`),null);
 await sync(`document.querySelector('.save-backup').click();document.querySelector('.save-backup').click();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal(await sync(`return document.querySelector('.export-error').hidden;`),true,await sync(`return document.querySelector('.export-error').textContent;`));
 assert.equal(await sync(`return document.querySelectorAll('.io-export .download-file').length;`),1);
 assert.match(await sync(`return document.querySelector('.export-status').textContent;`),/Backup ready/);
 await evaluate(`const a=document.querySelector('.download-file');const bytes=await(await fetch(a.href)).arrayBuffer();window.__selected=bytes;
 const t=new DataTransfer();t.items.add(new File([bytes],'backup.zip',{type:''}));const input=document.querySelector('#import-backup');input.files=t.files;input.dispatchEvent(new Event('change'));`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal(await sync(`return document.querySelector('.backup-preview').hidden;`),false,await sync(`return document.querySelector('.import-error').textContent;`));
 await sync(`document.querySelector('.cancel-backup').click();`);
 assert.match(await sync(`return document.querySelector('.import-status').textContent;`),/cancelled/);
 await evaluate(`const t=new DataTransfer();t.items.add(new File([window.__selected],'backup.coffeeos'));const input=document.querySelector('#import-backup');input.files=t.files;input.dispatchEvent(new Event('change'));`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 await sync(`document.querySelector('.io-import').requestSubmit();document.querySelector('.io-import').requestSubmit();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.match(await sync(`return document.querySelector('.import-status').textContent;`),/Imported/);
 // iOS Share must come from its own click; exercise availability, cancel and failure.
 await sync(`Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,writable:true,value:async({files})=>{window.__shared=files.map(f=>f.name);}});document.querySelector('.save-backup').click();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal(await sync(`return document.querySelector('.share-files').hidden;`),false);
 await sync(`document.querySelector('.share-files').click();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal((await sync(`return window.__shared;`)).length,1);
 await sync(`navigator.share=async()=>{throw new DOMException('Cancelled','AbortError');};document.querySelector('.share-files').click();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal(await sync(`return document.querySelector('.export-error').hidden;`),true);
 await sync(`navigator.share=async()=>{throw new Error('Share failed');};document.querySelector('.share-files').click();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.match(await sync(`return document.querySelector('.export-error').textContent;`),/Download backup/);
 await sync(`delete navigator.share;delete navigator.canShare;`);
 // Failed export keeps its earlier prepared download available.
 const previousHref=await sync(`return document.querySelector('.io-export .download-file').href;`);
 await evaluate(`const c=window.__testConnection ?? (await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;window.__savedQuery=c.prototype.query;c.prototype.query=function(sql){if(sql.startsWith('COPY beans TO'))return Promise.reject(new Error('Injected export failure'));return window.__savedQuery.call(this,sql);};window.__restoreQuery=()=>{c.prototype.query=window.__savedQuery;};`);
 await sync(`document.querySelector('.save-backup').click();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 await sync(`window.__restoreQuery();`);
 assert.equal(await sync(`return document.querySelector('.io-export .download-file').href;`),previousHref);
 assert.match(await sync(`return document.querySelector('.export-status').textContent;`),/earlier prepared/);
 await evaluate(`const t=new DataTransfer();t.items.add(new File([new Uint8Array([1,2,3])],'broken.coffeeos'));const input=document.querySelector('#import-backup');input.files=t.files;input.dispatchEvent(new Event('change'));`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal(await sync(`return document.querySelector('#import-backup').files.length;`),1);
 assert.match(await sync(`return document.querySelector('.import-error').textContent;`),/still available for retry/);
 await evaluate(`const t=new DataTransfer();t.items.add(new File([window.__selected],'valid.coffeeos'));const input=document.querySelector('#import-backup');input.files=t.files;input.dispatchEvent(new Event('change'));`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 await evaluate(`await(await getDB()).addBean({name:'UI intervening write'});`);
 await sync(`document.querySelector('.io-import').requestSubmit();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.match(await sync(`return document.querySelector('.import-status').textContent;`),/changed.*confirm again/);
 await sync(`document.querySelector('.io-import').requestSubmit();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.match(await sync(`return document.querySelector('.import-status').textContent;`),/Imported/);
 // A post-commit durability error must refresh data, clear selection and discourage retry.
 await evaluate(String.raw`await(await getDB()).importData([{target:'beans',name:'change.csv',data:new TextEncoder().encode('id,name,roast_date,freeze_date,created_at\nportable,UI changed,\\N,\\N,2026-10-25T10:20:30.123456Z\n')}]);
 const t=new DataTransfer();t.items.add(new File([window.__selected],'valid.coffeeos'));const input=document.querySelector('#import-backup');input.files=t.files;input.dispatchEvent(new Event('change'));`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 await evaluate(`const d=await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name);const original=d.AsyncDuckDB.prototype.flushFiles;window.__restoreFlush=()=>{d.AsyncDuckDB.prototype.flushFiles=original;};d.AsyncDuckDB.prototype.flushFiles=async()=>{throw new Error('Injected committed flush failure');};`);
 await sync(`document.querySelector('.io-import').requestSubmit();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 await sync(`window.__restoreFlush();`);
 assert.match(await sync(`return document.querySelector('.import-error').textContent;`),/already in your collection.*Do not submit/);
 assert.equal(await sync(`return document.querySelector('#import-backup').files.length;`),0);
 assert.equal(await evaluate(`return(await(await getDB()).getBeans()).find(b=>b.id==='portable').name;`),'咖啡 ☕');
 await reload();
 assert.equal(await evaluate(`return(await(await getDB()).getBeans()).find(b=>b.id==='portable').name;`),'咖啡 ☕');
 console.log('PASS one-file Share/cancel/failure, retained earlier download, retryable invalid selection, refreshed UI preview, committed-write warning and reload');
 const measurements = await evaluate(`
 const db=await getDB(),b=await getBackups();
 const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1000;const ctx=canvas.getContext('2d');const pixels=ctx.createImageData(1000,1000);
 let seed=42;for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=seed>>>24;pixels.data[i+1]=seed>>>16;pixels.data[i+2]=seed>>>8;pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);
 const photo=canvas.toDataURL('image/jpeg',0.8);
 const start=performance.now();for(let i=0;i<12;i++)await db.addBean({name:'Photo memory '+i,photo_jpeg:photo});
 const before=performance.now();const archive=await b.saveBackup();const exported=performance.now();const prepared=await b.prepareBackup(archive.data);const validated=performance.now();
 return {photo_bytes:photo.length,photos:12,archive_bytes:archive.data.length,seed_ms:before-start,export_ms:exported-before,validate_ms:validated-exported,unchanged:prepared.preview.beans.unchanged};
 `);
 console.log('PASS UI .zip/generic MIME, cancel/confirm, duplicate submits, recovery after reload; photo fixture:',measurements);
 return {example:runtime.example,roundtrip:runtime.roundtrip,measurements};
}

export async function checkBackupMemory(evaluate) {
 return evaluate(String.raw`
 const db=await getDB(),b=await getBackups();
 const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1000;const ctx=canvas.getContext('2d');const pixels=ctx.createImageData(1000,1000);
 let seed=42;
 const rows=['id,name,roast_date,freeze_date,created_at,photo_jpeg'];
 for(let n=0;n<10;n++){
   for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed>>>24;pixels.data[i+1]=seed>>>16;pixels.data[i+2]=seed>>>8;pixels.data[i+3]=255;}
   ctx.putImageData(pixels,0,0);const photo=canvas.toDataURL('image/jpeg',0.8);
   rows.push('"memory-'+n+'","Photo '+n+'",\\N,\\N,"2026-10-27T00:00:00Z","'+photo+'"');
 }
 const seedStart=performance.now();
 await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(rows.slice(0,7).join('\n')+'\n')}]);
 const seeded=performance.now();const archive=await b.saveBackup();const exported=performance.now();
 let prepared=await b.prepareBackup(archive.data);const validated=performance.now();await b.confirmBackup(prepared);prepared=null;
 // Also decode DEFLATE at realistic photo sizes and import from a new empty engine.
 const zip=await getZIP();const deflate=zip.zipSync(zip.unzipSync(archive.data),{level:6});
 await b.prepareBackup(deflate);
 await db.importData([{target:'beans',name:'more.csv',data:new TextEncoder().encode([rows[0],...rows.slice(7)].join('\n')+'\n')}]);
 const larger=await b.saveBackup();await b.prepareBackup(larger.data);
 if((await db.getBeans()).length!==10)throw new Error('Export changed data');
 return {unique_photos:6,larger_fixture_photos:10,larger_archive_bytes:larger.data.length,csv_bytes:rows.reduce((sum,s)=>sum+s.length,0),archive_bytes:archive.data.length,deflate_bytes:deflate.length,seed_ms:seeded-seedStart,export_ms:exported-seeded,validate_ms:validated-exported};
 `);
}
