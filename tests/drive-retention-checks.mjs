import assert from 'node:assert/strict';

export async function checkDriveRetention({evaluate, api, ready}) {
  const setup = String.raw`
    const db=await getDB(), b=await getBackups(), d=await import('/src/drive.ts');
    const t=await import('/src/driveBackupTracking.ts');
    const f=window.__retention;
    const check=(value,message)=>{if(!value)throw Error(message);};
    const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
    const active=()=>f.cloud.filter(file=>!file.trashed);
    const owned=()=>active().filter(file=>file.remote.appProperties.backupSessionId===t.readDriveBackupTracking(f.account.sub)?.sessionId);
    const transport=async(url,init={})=>{
      const u=new URL(url),q=u.searchParams.get('q');
      if(q){
        if(q.includes('backups-folder-v1'))return json({files:[{id:'folder'}]});
        let files=active().map(file=>file.remote);
        if(q.includes("key='backupId'"))files=files.filter(file=>q.includes(file.appProperties.backupId));
        if(f.incomplete)return json({files,incompleteSearch:true});
        // Exercise ownership discovery across real paginated client reads.
        if(files.length>1&&!u.searchParams.has('pageToken'))return json({files:files.slice(0,1),nextPageToken:'rest'});
        return json({files:u.searchParams.has('pageToken')?files.slice(1):files});
      }
      if(init.method==='POST'){
        f.posts++;f.meta=JSON.parse(init.body);f.chunks=[];
        check(t.readDriveBackupTracking(f.account.sub).backups.some(entry=>entry.backupId===f.meta.appProperties.backupId),'intent saved before upload');
        return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=retention'}});
      }
      if(init.method==='PUT'){
        const range=init.headers['Content-Range'].match(/bytes (\d+)-(\d+)\/(\d+)/);
        f.chunks.push(new Uint8Array(await init.body.arrayBuffer()));
        if(Number(range[2])+1<Number(range[3]))return new Response(null,{status:308,headers:{Range:'bytes=0-'+range[2]}});
        const bytes=new Uint8Array(Number(range[3]));let offset=0;
        for(const chunk of f.chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        const remote={id:'retained-'+f.posts,createdTime:new Date(Date.UTC(2026,9,30,12,0,f.posts)).toISOString(),
          size:String(bytes.length),sha256Checksum:await b.sha256(bytes),appProperties:{...f.meta.appProperties}};
        f.cloud.push({remote,bytes:Array.from(bytes)});
        if(f.abortCompletion){f.abortCompletion=false;f.controller.abort();throw Error('Lost response after accepted upload');}
        return json(remote);
      }
      const file=f.cloud.find(file=>u.pathname.endsWith('/'+file.remote.id));
      if(!file)return json({},404);
      if(init.method==='PATCH'){
        check(JSON.stringify(JSON.parse(init.body))===JSON.stringify({trashed:true}),'cleanup only trashes');
        check(owned().length>=3,'two other owned backups exist before cleanup');
        f.patches.push(file.remote.id);
        if(f.failCleanup)return json({},403);
        file.trashed=true;
        if(f.loseTrashResponse){f.loseTrashResponse=false;throw Error('Lost successful trash response');}
        return json({id:file.remote.id,trashed:true});
      }
      if(u.searchParams.get('alt')==='media')return new Response(new Uint8Array(file.bytes));
      const remote=structuredClone(file.remote);
      if(f.badVerification&&file.remote.id==='retained-'+f.posts)remote.sha256Checksum='0'.repeat(64);
      if(f.changedCandidate&&file.remote.id===f.changedCandidate)remote.appProperties.backupSessionId='another-phone';
      return json({...remote,trashed:Boolean(file.trashed)});
    };
    const sync=async()=>{
      f.controller=new AbortController();
      return d.syncDrive(new d.DriveClient(f.account,f.controller.signal,transport),f.controller.signal);
    };
    const edit=async()=>{const bean=(await db.getBeans()).find(bean=>bean.id===f.beanId);await db.updateBean(bean.id,{...bean,name:bean.name+'x'});};
    const rejects=async task=>{let failed=false;try{await task();}catch{failed=true;}check(failed,'expected operation to stop');};
  `;
  const fixture = await evaluate(String.raw`
    const db=await getDB(),b=await getBackups();
    const original=await b.saveBackup();
    const bean=await db.addBean({name:'Two-backup retention fixture'});
    window.__retention={account:{token:'fixture',expiresAt:Date.now()+3600000,sub:'retention-'+crypto.randomUUID(),email:'fixture@example.invalid'},
      cloud:[],posts:0,patches:[],beanId:bean.id,original:Array.from(original.data)};
    return true;
  `);
  assert.equal(fixture,true);
  const beforeReload = await evaluate(setup + String.raw`
    await sync();
    const first=f.cloud[0];
    // Untracked archives, other phones and even copied app metadata cannot
    // confer ownership of a different Drive file ID.
    for(const [id,session]of [['untracked',undefined],['other-phone','another-phone'],['copied-file',first.remote.appProperties.backupSessionId]]){
      const foreign=structuredClone(first);foreign.remote.id=id;foreign.remote.createdTime='2020-01-01T00:00:00Z';
      foreign.remote.appProperties.backupSessionId=session;f.cloud.push(foreign);
    }
    for(let i=0;i<4;i++){
      await edit();const result=await sync();
      check(result.message.includes('Uploaded')&&!result.message.includes('pending'),'verified upload and successful cleanup');
      check(owned().filter(file=>file.remote.id.startsWith('retained-')).length===2,'keep latest two on each sync');
      check(active().some(file=>file.remote.id==='untracked')&&active().some(file=>file.remote.id==='other-phone')&&active().some(file=>file.remote.id==='copied-file'),'foreign files preserved');
    }
    check(JSON.stringify(f.patches)===JSON.stringify(['retained-1','retained-2','retained-3']),'progressive oldest-first rotation');
    const tracking=t.readDriveBackupTracking(f.account.sub);
    check(tracking.backups.length===2&&tracking.backups.every(entry=>entry.fileId&&/^[a-f0-9]{64}$/.test(entry.archiveSha256)),'file IDs and hashes retained');
    const posts=f.posts;await sync();check(f.posts===posts,'unchanged sync skips upload');
    return {fixture:f,tracking,key:t.driveBackupTrackingKey(f.account.sub),records:JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()})};
  `);
  assert.deepEqual(beforeReload.tracking.backups.map(entry=>entry.fileId),['retained-4','retained-5']);
  await api('/refresh',{}); await ready();
  await evaluate(`window.__retention=${JSON.stringify(beforeReload.fixture)};`);
  const afterReload = await evaluate(setup + String.raw`
    check(JSON.stringify({beans:await db.getBeans(),sessions:await db.getBrewSessions()})===${JSON.stringify(beforeReload.records)},'reload preserves all records');
    check(t.readDriveBackupTracking(f.account.sub).sessionId===${JSON.stringify(beforeReload.tracking.sessionId)},'stable phone session after reload');
    const auth=await import('/src/driveAuthorization.ts');
    auth.saveDriveAuthorization('fixture-client',f.account,true);auth.forgetDriveAuthorization();
    const other={...f.account,sub:f.account.sub+'-other'};
    const otherClient=new d.DriveClient(other,new AbortController().signal,transport);
    await otherClient.cleanupBackups(active().map(file=>file.remote));
    check(f.patches.length===3&&t.readDriveBackupTracking(other.sub)===null,'switching accounts never adopts old account files');
    await edit();await sync();check(t.readDriveBackupTracking(f.account.sub).backups.length===2,'reconnect uses prior ownership');
    // A cleanup rejection reports the verified upload, keeps the two newest and
    // retries on unchanged Sync without another upload.
    await edit();f.failCleanup=true;const pending=await sync();
    check(pending.message.includes('Uploaded')&&pending.message.includes('cleanup is pending'),'cleanup failure preserves upload outcome');
    check(owned().filter(file=>file.remote.id.startsWith('retained-')).length===3,'failed cleanup retains backups');
    const posts=f.posts;const repeated=await sync();
    check(repeated.message.includes('Already backed up')&&repeated.message.includes('pending')&&f.posts===posts,'unchanged retries cleanup without upload');
    await edit();await rejects(sync);check(f.posts===posts,'blocked cleanup cannot accumulate changed backups');
    f.failCleanup=false;await sync();check(t.readDriveBackupTracking(f.account.sub).backups.length===2,'next successful sync completes cleanup');
    // A lost successful trash response keeps its tracking until the next list.
    await edit();f.loseTrashResponse=true;check((await sync()).message.includes('pending'),'lost trash response remains pending');
    const afterLost=f.posts;await sync();check(f.posts===afterLost&&t.readDriveBackupTracking(f.account.sub).backups.length===2,'reconcile already removed file without another upload');
    // Metadata tampering or incomplete discovery must prevent any deletion.
    await edit();f.failCleanup=true;await sync();f.failCleanup=false;
    const old=t.readDriveBackupTracking(f.account.sub).backups[0].fileId;
    const patches=f.patches.length;f.changedCandidate=old;
    check((await sync()).message.includes('pending')&&f.patches.length===patches,'recheck identity before cleanup');
    f.changedCandidate=null;f.incomplete=true;await rejects(sync);check(f.patches.length===patches,'incomplete list cannot delete');f.incomplete=false;
    await sync();
    // Invalid or unavailable local tracking stops before uploading new bytes.
    await edit();const key=t.driveBackupTrackingKey(f.account.sub),raw=localStorage.getItem(key),savedPosts=f.posts;
    localStorage.setItem(key,'{"version":99}');await rejects(sync);
    check(localStorage.getItem(key)==='{"version":99}'&&f.posts===savedPosts,'corrupt tracking is preserved and blocks upload');localStorage.setItem(key,raw);
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('Injected quota','QuotaExceededError');return set.call(this,name,value);};
    try{await rejects(sync);}finally{Storage.prototype.setItem=set;}
    check(f.posts===savedPosts&&localStorage.getItem(key)===raw,'tracking write failure never uploads or discards identities');
    const get=Storage.prototype.getItem;
    Storage.prototype.getItem=function(name){if(name===key)throw new DOMException('Injected blocked storage','SecurityError');return get.call(this,name);};
    try{await rejects(sync);}finally{Storage.prototype.getItem=get;}
    check(f.posts===savedPosts&&localStorage.getItem(key)===raw,'blocked tracking reads never upload or replace ownership');
    // Cancellation after Google accepts the bytes leaves durable intent. Reload
    // must recover its file ID by backup ID, session marker and checksum.
    f.abortCompletion=true;await rejects(sync);
    const intent=t.readDriveBackupTracking(f.account.sub).backups.at(-1);
    check(!intent.fileId&&intent.backupId===f.cloud.at(-1).remote.appProperties.backupId,'accepted upload retains pending intent');
    return {fixture:f,posts:f.posts,sessionId:t.readDriveBackupTracking(f.account.sub).sessionId};
  `);
  await api('/refresh',{}); await ready();
  await evaluate(`window.__retention=${JSON.stringify(afterReload.fixture)};`);
  await evaluate(setup + String.raw`
    const result=await sync();
    check(result.message.includes('Already backed up')&&f.posts===${afterReload.posts},'accepted upload reconciles after reload without duplicate');
    const tracking=t.readDriveBackupTracking(f.account.sub);
    check(tracking.sessionId===${JSON.stringify(afterReload.sessionId)}&&tracking.backups.length===2&&tracking.backups.every(entry=>entry.fileId),'pending intent becomes verified file ownership');
    // Failed final verification cannot trigger cleanup of previous copies.
    await edit();f.badVerification=true;const patches=f.patches.length;
    // Also corrupt listing reconciliation so no verified outcome is available.
    const original=transport;
    const bad=async(url,init)=>{
      const response=await original(url,init);
      if(new URL(url).searchParams.get('q')?.includes("key='backupId'"))return json({files:[]});
      return response;
    };
    f.controller=new AbortController();
    await rejects(()=>d.syncDrive(new d.DriveClient(f.account,f.controller.signal,bad),f.controller.signal));
    check(f.patches.length===patches,'unverified upload never removes earlier files');
    f.badVerification=false;await sync();await edit();f.failCleanup=true;
    const auth=await import('/src/driveAuthorization.ts'),config=await import('/src/driveConfig.ts');
    auth.setDriveSwitchPending(false);auth.saveDriveAuthorization(config.googleDriveClientId,f.account,true);
    const nativeFetch=window.fetch,box=document.createElement('div');document.body.append(box);
    window.fetch=async(url,init)=>new URL(url,location.href).hostname==='openidconnect.googleapis.com'
      ?json({sub:f.account.sub,email:f.account.email,email_verified:true}):transport(url,init);
    try{
      (await import('/src/views/driveView.ts')).createDriveView(box,async()=>{});
      const idle=async()=>{for(let i=0;i<200;i++){if(box.getAttribute('aria-busy')==='false')return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Retention UI did not finish');};
      box.querySelector('.drive-sync').click();await idle();
      check(box.querySelector('.drive-error').hidden&&box.querySelector('.drive-status').textContent.includes('Uploaded')&&box.querySelector('.drive-status').textContent.includes('cleanup is pending'),'UI retains upload success and cleanup warning after history refresh');
      check(box.textContent.includes('latest two backups'),'UI discloses retention');
      const posts=f.posts;f.failCleanup=false;box.querySelector('.drive-sync').click();await idle();
      check(f.posts===posts&&box.querySelector('.drive-error').hidden&&box.querySelector('.drive-status').textContent.includes('Already backed up')&&!box.querySelector('.drive-status').textContent.includes('pending'),'UI retries cleanup without duplicate upload');
      check(t.readDriveBackupTracking(f.account.sub).backups.length===2,'UI retry retains exactly two tracked backups');
    }finally{window.fetch=nativeFetch;box.remove();auth.forgetDriveAuthorization();}
    await b.replaceBackup(await b.prepareBackup(new Uint8Array(f.original)));
  `);
  console.log('PASS per-account/device two-backup rotation, hashes and ownership, paginated discovery, reload/reconnect, cleanup failure/retry, cancellation reconciliation, storage failures and verified-upload gate');
}
