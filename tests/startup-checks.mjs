import assert from 'node:assert/strict';

export const durableState = evaluate => evaluate(`const db=await getDB(); await db.closeDB();
      const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
      const store=await new Promise((resolve,reject)=>{const r=indexedDB.open('coffeos-snapshots',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const read=key=>new Promise((resolve,reject)=>{const r=store.transaction('snapshots').objectStore('snapshots').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const backend=await read('backend-v1');const snapshot=await read('tables-v1');store.close();
      const result={backend};if(snapshot) for(const table of ['beans','brew_sessions']) result[table]=await digest(snapshot[table]);
      if(backend==='opfs'){const root=await navigator.storage.getDirectory();for(const name of ['coffeos.db','coffeos.db.wal'])result[name]=await digest(await (await (await root.getFileHandle(name)).getFile()).arrayBuffer());}
      return result;`);

export async function checkStartupFailures({sync, evaluate, api, ready, waitFor, state, mode, faults}) {
    const expected = await state();
    // Storage loss on the candidate must reject opening the saved data.
    const blocked = await evaluate(`const db = await getDB(); await db.closeDB();
      const original = ${mode === 'opfs' ? 'navigator.storage.getDirectory' : 'IDBObjectStore.prototype.get'};
      try {
        ${mode === 'opfs' ? "Object.defineProperty(navigator.storage, 'getDirectory', {configurable:true, value:undefined});" : "IDBObjectStore.prototype.get = function () {throw new Error('Injected snapshot read failure');};"}
        try {await db.initDB(); return false;} catch {return true;}
      } finally {
        ${mode === 'opfs' ? "Object.defineProperty(navigator.storage, 'getDirectory', {configurable:true, value:original});" : 'IDBObjectStore.prototype.get = original;'}
      }`);
    assert.equal(blocked, true); await api('/refresh', {}); await ready(); assert.deepEqual(await state(), expected);
    // Every injected startup failure must leave the engine unavailable and the
    // exact populated collection recoverable on retry.
    const failures = [
      ["unsupported stored schema", "const saved = window.__testConnection.prototype.query; window.__testConnection.prototype.query = function(sql){if(sql.startsWith('DESCRIBE SELECT')) return Promise.resolve({toArray:()=>[{column_name:'future',column_type:'VARCHAR'}]});return saved.call(this,sql);};", "window.__testConnection.prototype.query = saved;"],
      ["IndexedDB open", "const saved = indexedDB.open; indexedDB.open = () => {throw new Error('denied');};", "indexedDB.open = saved;"],
      ["unknown backend", "const saved = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function(key) {return saved.call(this, key === 'backend-v1' ? 'future-backend-test' : key);};", "IDBObjectStore.prototype.get = saved;"],
    ];
    await evaluate(`const store = await new Promise((resolve,reject) => {const r=indexedDB.open('coffeos-snapshots',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject)=>{const tx=store.transaction('snapshots','readwrite');tx.objectStore('snapshots').put('future-backend','future-backend-test');tx.objectStore('snapshots').put({beans:new Uint8Array([1,2,3]),brew_sessions:new Uint8Array([4,5])},'corrupt-test');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});store.close();`);
    if (mode === 'opfs') failures.push(
      ["lost isolation", "Object.defineProperty(window,'crossOriginIsolated',{configurable:true,value:false});", "delete window.crossOriginIsolated;"],
      ["OPFS permission", "const saved = navigator.storage.getDirectory; navigator.storage.getDirectory = async () => {throw new DOMException('denied','NotAllowedError');};", "navigator.storage.getDirectory = saved;"],
      ["missing remembered file", "const saved = FileSystemDirectoryHandle.prototype.getFileHandle; FileSystemDirectoryHandle.prototype.getFileHandle = async function(){throw new DOMException('missing','NotFoundError');};", "FileSystemDirectoryHandle.prototype.getFileHandle = saved;"],
    );
    if (mode === 'indexeddb') failures.push(
      ["missing snapshot", "const saved = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function(key){return saved.call(this,key === 'tables-v1' ? 'absent-test' : key);};", "IDBObjectStore.prototype.get = saved;"],
      ["unsupported snapshot", "const saved = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function(key){return saved.call(this,key === 'tables-v1' ? 'future-backend-test' : key);};", "IDBObjectStore.prototype.get = saved;"],
      ["corrupt Parquet", "const saved = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function(key){return saved.call(this,key === 'tables-v1' ? 'corrupt-test' : key);};", "IDBObjectStore.prototype.get = saved;"],
      ["interrupted restore", "const saved = window.__testConnection.prototype.query; window.__testConnection.prototype.query = function(sql){if(sql.startsWith('INSERT INTO brew_sessions BY NAME SELECT')) return Promise.reject(new Error('restore interrupted')); return saved.call(this,sql);};", "window.__testConnection.prototype.query = saved;"],
    );
    const durable = () => durableState(evaluate);
    for (const failure of ['error', 'message', 'silent']) {
      const before = await durable();
      faults.failWorker = failure;
      await api('/refresh', {});
      await waitFor(`document.querySelector('.startup-status[role="alert"]')`);
      const result = await sync(`return {mode:window.__testDB.getStorageMode(),busy:document.querySelector('#app').getAttribute('aria-busy'),
        message:document.querySelector('.startup-message').textContent,report:document.querySelector('#startup-report').value};`);
      assert.equal(result.mode, null); assert.equal(result.busy, 'false');
      assert.match(result.message, failure === 'silent' ? /stopped responding/ : /worker could not load/);
      assert.match(result.report, /Phase: Loading the database worker and Wasm/);
      assert.deepEqual(await durable(), before, failure + ' worker failure preserved durable bytes');
      faults.failWorker = '';
      const previousDocument = await sync(`return window.__startupDocument;`);
      await sync(`document.querySelector('.startup-reload').click();`);
      await waitFor(`window.__startupDocument && window.__startupDocument !== ${JSON.stringify(previousDocument)}`);
      await ready();
      assert.deepEqual(await state(), expected, failure + ' worker retry preserved exact records');
      console.log('PASS worker', failure, 'exits startup, preserves durable bytes and reload recovers exact records');
    }
    for (const [name, inject, restore] of failures) {
      const before = await durable();
      const outcome = await evaluate(`const db=await getDB();await db.closeDB();${inject}
        try {try {await db.initDB();return {rejected:false};} catch(error){return {rejected:true,mode:db.getStorageMode(),message:String(error)};}}
        finally {${restore}}`);
      assert.equal(outcome.rejected,true,name); assert.equal(outcome.mode,null,name);
      assert.deepEqual(await durable(),before,name + ' durable bytes');
      await api('/refresh',{}); await ready(); assert.deepEqual(await state(),expected,name);
      console.log('PASS preserved populated data after',name);
    }
    const slowLoading = await evaluate(`const box=document.createElement('section');document.body.append(box);
      const originalNow=performance.now;const start=originalNow.call(performance);
      const view=window.__testStartupView(box,()=> 'Reading the saved backend and snapshot');
      try {
        Object.defineProperty(performance,'now',{configurable:true,value:()=>start+11000});
        await new Promise(resolve=>setTimeout(resolve,600));
        return {visible:!box.querySelector('.startup-help').hidden,busy:box.getAttribute('aria-busy'),
          phase:box.querySelector('.startup-phase').textContent,report:box.querySelector('#startup-report').value};
      } finally {view.ready();delete performance.now;box.remove();}`);
    assert.equal(slowLoading.visible,true); assert.equal(slowLoading.busy,'true');
    assert.match(slowLoading.report,/Phase: Reading the saved backend and snapshot/);
    assert.match(slowLoading.report,/Isolated: true/);
    console.log('PASS slow startup exposes read-only phase/details while database opening remains pending');
}
