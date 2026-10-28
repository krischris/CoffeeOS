/** Actual Drive view lifecycle at recoverEmptyBackup's local apply boundary. */
export async function checkDriveRecoveryView({evaluate}) {
 const result=await evaluate(String.raw`
  const db=await getDB(),b=await getBackups();
  const createView=window.__testCreateDriveView ?? (await import('/src/views/driveView.ts')).createDriveView;
  const Duck=window.__testConnection ?? (await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;
  const check=(v,m)=>{if(!v)throw Error(m);};
  const wait=async fn=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Drive view wait timed out '+currentCase+' '+host.querySelector('.drive-status')?.textContent+' / '+host.querySelector('.drive-error')?.textContent+' / count='+(await db.getBeans()).length+' / posts='+posts);};
  const initial=await b.saveBackup();
  for(const bean of await db.getBeans())await db.deleteBean(bean.id);
  const empty=await b.saveBackup();
  const bean=await db.addBean({name:'Automatic recovery fixture'});
  await db.addBrewSession({bean_id:bean.id,dose_g:18.1234567890123,water_g:0,time_str:'',temp_c:null,grind_um:null,comment:'Recovered exact ☕',yield_g:null,tds_pct:null,extraction_pct:null});
  const cloud=await b.saveBackup(),manifest=(await b.unpackBackup(cloud.data)).manifest;
  const mode=db.getStorageMode();
  const expected=await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data);
  const remote={id:'recovery-fixture',createdTime:'2026-10-28T12:00:00Z',size:String(cloud.data.length),sha256Checksum:await b.sha256(cloud.data),appProperties:{coffeeosKind:'snapshot-v1',backupId:manifest.backup_id,archiveSha256:await b.sha256(cloud.data)}};
  const nativeFetch=window.fetch,nativeOpen=window.open,query=Duck.prototype.query;
  const host=document.createElement('div');host.id='review-drive-view';document.body.append(host);
  let currentCase='',phase='',release,reached=false,refreshes=0,refreshedCounts,posts=0;
  const pause=()=>{reached=true;return new Promise(resolve=>release=resolve);};
  window.fetch=async(url,init={})=>{
    const u=new URL(url,location.href),json=v=>new Response(JSON.stringify(v));
    if(u.hostname==='openidconnect.googleapis.com')return json({sub:'recovery',email:'recovery@example.invalid',email_verified:true});
    if(u.hostname!=='www.googleapis.com')return nativeFetch(url,init);
    if(init.method&&init.method!=='GET'){posts++;throw Error('No recovery upload allowed');}
    if(u.searchParams.get('q'))return json({files:u.searchParams.get('q').includes('backups-folder-v1')?[{id:'folder'}]:[remote]});
    if(u.searchParams.get('alt')==='media'){if(phase==='download')await pause();return new Response(cloud.data);}
    return json(remote);
  };
  window.open=url=>{
    const channel=new BroadcastChannel('coffeeos-drive-'+new URL(url).hash.slice(1));
    channel.onmessage=e=>{if(e.data.type==='configure')channel.postMessage({type:'authorized',token:'fake-recovery',scope:'https://www.googleapis.com/auth/drive.file openid email',expiresAt:Date.now()+3600000});if(e.data.type==='cancel')channel.close();};
    setTimeout(()=>channel.postMessage({type:'ready'}),0);return null;
  };
  const applying=()=>host.querySelector('.drive-status')?.textContent.includes('Applying recovered');
  const results=[];
  try {
    createView(host,async()=>{refreshes++;refreshedCounts={beans:(await db.getBeans()).length,sessions:(await db.getBrewSessions()).length};});
    // Disconnect resets only the test authorization decision, never collection storage.
    host.querySelector('.drive-disconnect').click();
    for(const action of ['cancel','disconnect'])for(const target of ['download','staging','capture','commit','after-commit','flush-failure','idb-failure','idb-postabort']) {
      if(target.startsWith('idb-')&&db.getStorageMode()!=='indexeddb')continue;
      await b.replaceBackup(await b.prepareBackup(empty.data));
      currentCase=action+'/'+target;phase=target;reached=false;release=null;refreshes=0;refreshedCounts=null;
      const put=IDBObjectStore.prototype.put;let snapshotTx,stages=0;
      IDBObjectStore.prototype.put=function(value,key){if(key==='tables-v1'&&applying())snapshotTx=this.transaction;if(key==='tables-v1'&&applying()&&target==='idb-failure')throw Error('Injected recovery snapshot failure');return put.call(this,value,key);};
      const beforeApply=['download','staging'].includes(target)||(target==='capture'&&mode==='opfs');
      Duck.prototype.query=function(sql){
        if(mode==='opfs'&&phase==='capture'&&sql.startsWith('COPY beans TO')) {phase='released';return pause().then(()=>query.call(this,sql));}
        if(sql.startsWith('CREATE TEMP TABLE incoming_beans')) {stages++;if(target==='staging'&&stages===2)return pause().then(()=>query.call(this,sql));}
        if(target==='idb-postabort'&&applying()&&sql==='COMMIT')return query.call(this,sql).then(v=>{snapshotTx.abort();return v;});
        if(applying()&&((phase==='capture'&&sql.startsWith('COPY beans TO'))||(phase==='commit'&&sql==='COMMIT')||(phase==='after-commit'&&sql==='CHECKPOINT'))) {
          phase='released';return pause().then(()=>query.call(this,sql));
        }
        if(applying()&&target==='flush-failure'&&sql==='CHECKPOINT')return Promise.reject(Error('Injected recovery flush failure'));
        return query.call(this,sql);
      };
      check((await db.getBeans()).length===0,currentCase+' starts empty');
      if(host.querySelector('.drive-connect').disabled)host.querySelector('.drive-sync').click();else host.querySelector('.drive-connect').click();
      if(['flush-failure','idb-failure','idb-postabort'].includes(target)) {
        await wait(()=>host.getAttribute('aria-busy')==='false');
      } else {
        await wait(()=>reached);
        const button=host.querySelector('.drive-'+action);
        if(beforeApply){check(!button.disabled,action+' before apply enabled');button.click();}
        else {check(button.disabled,action+' disabled during '+target);button.click();}
        release();
        await wait(()=>host.getAttribute('aria-busy')==='false');
        // Cancelled download may finish validation after its view operation was discarded.
        if(beforeApply){await new Promise(r=>setTimeout(r,30));await db.getBeans();}
      }
      Duck.prototype.query=query;IDBObjectStore.prototype.put=put;
      const counts={beans:(await db.getBeans()).length,sessions:(await db.getBrewSessions()).length};
      if(beforeApply||target==='idb-failure') {
        check(counts.beans===0&&counts.sessions===0,action+'/'+target+' preserves empty');
        check(refreshes===0,action+'/'+target+' no false refresh');
        if(beforeApply)check(!host.querySelector('.drive-status').textContent.includes('Recovered'),'accurate cancelled status');
      } else {
        check(await db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data)===expected,action+'/'+target+' exact recovered records');
        check(refreshes===1&&refreshedCounts.beans===1&&refreshedCounts.sessions===1,action+'/'+target+' refreshed counts exactly once');
        if(['flush-failure','idb-postabort'].includes(target))check(!host.querySelector('.drive-error').hidden&&host.querySelector('.drive-error').textContent.includes('already in your collection'),'committed warning visible');
        else check(host.querySelector('.drive-status').textContent.includes('Recovered'),'committed result never concealed as cancelled');
      }
      check(posts===0,'no spurious retry/upload');
      results.push(action+'/'+target);
    }
    await b.replaceBackup(await b.prepareBackup(initial.data));
  } finally {Duck.prototype.query=query;window.fetch=nativeFetch;window.open=nativeOpen;host.querySelector('.drive-disconnect')?.click();host.remove();}
  return {mode:db.getStorageMode(),cases:results};
 `);
 console.log('PASS actual Drive recovery Cancel/Disconnect at download, snapshot capture, COMMIT, after COMMIT and durability failures',result);
}
