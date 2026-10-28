import assert from 'node:assert/strict';

export async function checkLegacyText({evaluate}) {
  const result=await evaluate(String.raw`
    const db=await getDB(),b=await getBackups(),check=(v,m)=>{if(!v)throw Error(m);};
    const original=await b.saveBackup();
    const hash=async()=>db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data);
    const originalHash=await hash();
    const quote=v=>v===null?'\\N':'"'+String(v).replaceAll('"','""')+'"';
    const csv=(header,row)=>new TextEncoder().encode(header+'\n'+row.map(quote).join(',')+'\n');
    for(const bean of await db.getBeans())await db.deleteBean(bean.id);
    const empty=await b.saveBackup();
    await b.replaceBackup(await b.prepareBackup(original.data));
    let cases=0;
    for(const [beanId,name,sessionId] of [
      ['text-tab','\t','session-tab'], ['text-newline','\n','session-newline'],
      ['text-unicode','\t\u2003','session-unicode'], ['\t','Legacy ID','\n'],
    ]) {
      const files=[
        {target:'beans',name:'beans.csv',data:csv('id,name,roast_date,freeze_date,created_at,photo_jpeg',[beanId,name,null,'2024-01-02','2024-01-02T03:04:05.123456Z',null])},
        {target:'brew_sessions',name:'sessions.csv',data:csv('id,bean_id,brewed_at,dose_g,water_g,time_str,temp_c,grind_um,comment,yield_g,tds_pct,extraction_pct',[sessionId,beanId,'2024-01-02T03:04:05.123457Z',18.1234567890123,0,'',null,null,' exact\n☕ ',null,null,null])},
      ];
      let rejected=false;try{await db.importData(files);}catch(e){rejected=e.message.includes('whitespace');}
      check(rejected&&await hash()===originalHash,'default CSV rejected atomically');
      await db.importData(files,{preserveLegacyText:true});
      const expected=await hash();
      check((await db.getBeans()).find(v=>v.id===beanId).name===name,'exact whitespace bytes');
      const archive=await b.saveBackup(),prepared=await b.prepareBackup(archive.data);
      check(prepared.manifest.format_version===3&&prepared.manifest.text_encoding==='legacy-whitespace-v1'&&prepared.preview.legacyText,'explicit format 3');
      check(archive.name.includes('legacy-fields-v3'),'compatibility filename');
      for(const manifest of [{...prepared.manifest,text_encoding:undefined},{...prepared.manifest,format_version:2},{...prepared.manifest,text_encoding:'unknown'}]) {
        let invalid=false;try{b.validateManifest(manifest);}catch{invalid=true;}check(invalid,'unsupported text contract rejected');
      }
      const oldParquet=(await db.exportData('parquet')).map((f,i)=>({...f,target:i?'brew_sessions':'beans'}));
      await db.closeDB();await db.initDB();check(await hash()===expected,'reopen preserves exact values');
      const snapshot=await db.captureDriveSnapshot();
      await db.verifyDriveRoundTrip(prepared.files,snapshot.snapshot.counts,snapshot.revision,new AbortController().signal,true,true);
      await b.replaceBackup(await b.prepareBackup(original.data));
      const copies=await db.listImportRecoveries();let preservedRecovery=false;
      for(const copy of copies) {
        const recovered=await db.readImportRecovery(copy.key);
        if(await db.hashBackupContents(recovered.data)!==expected)continue;
        const downloadable=await b.packageBackup(recovered);
        check((await b.prepareBackup(downloadable.data)).manifest.format_version===3,'recovery exports readable format 3');
        preservedRecovery=true;break;
      }
      check(preservedRecovery,'immutable pre-replacement recovery preserved');
      rejected=false;try{await db.importData(oldParquet);}catch{rejected=true;}
      check(rejected&&await hash()===originalHash,'default Parquet rejected atomically');
      await db.importData(oldParquet,{preserveLegacyText:true});check(await hash()===expected,'historical Parquet preserves exact records');
      await b.replaceBackup(await b.prepareBackup(empty.data));
      const revision=(await db.captureDriveSnapshot()).revision;
      await db.recoverEmptyBackup(prepared.files,snapshot.snapshot.counts,revision,new AbortController().signal,undefined,true,true);
      check(await hash()===expected,'empty Drive recovery preserves IDs/links/precision');
      await b.replaceBackup(await b.prepareBackup(original.data));
      await b.confirmBackup(await b.prepareBackup(archive.data));check(await hash()===expected,'merge round trip');
      await b.replaceBackup(await b.prepareBackup(original.data));
      cases++;
    }
    // Exercise the user-facing opt-in and compatibility disclosures as well.
    document.querySelector('#tab-io').click();
    const form=document.querySelector('.legacy-import');form.reset();
    const transfer=new DataTransfer();transfer.items.add(new File([csv('id,name,roast_date,freeze_date,created_at',['ui-legacy-text','\t',null,null,'2024-01-02T03:04:05.123456Z'])],'beans.csv'));
    form.querySelector('[name=beans]').files=transfer.files;
    const idle=async()=>{for(let i=0;i<1000;i++){if(!form.querySelector('fieldset').disabled)return;await new Promise(r=>setTimeout(r,5));}throw Error('Legacy UI remained busy');};
    form.requestSubmit();await idle();
    check(!document.querySelector('.legacy-error').hidden&&document.querySelector('.legacy-error').textContent.includes('whitespace'),'default UI explains rejection');
    form.querySelector('[name=preserve_legacy_text]').checked=true;form.requestSubmit();await idle();
    check((await db.getBeans()).some(v=>v.id==='ui-legacy-text'&&v.name==='\t'),'UI opt-in preserves exact field');
    document.querySelector('.save-backup').click();await idle();
    check(document.querySelector('.export-status').textContent.includes('format 3'),'local export compatibility disclosed');
    const uiArchive=await b.saveBackup(),upload=new DataTransfer();upload.items.add(new File([uiArchive.data],'fields.coffeeos'));
    document.querySelector('#import-backup').files=upload.files;document.querySelector('.io-import').requestSubmit();await idle();
    check(document.querySelector('.backup-preview').textContent.includes('format 3'),'restore preview compatibility disclosed');
    document.querySelector('.cancel-backup').click();
    await b.replaceBackup(await b.prepareBackup(original.data));
    check(await hash()===originalHash,'test restores original collection');
    return {cases,mode:db.getStorageMode()};
  `);
  assert.equal(result.cases,4);
  console.log('PASS legacy text defaults reject, explicit CSV/Parquet preservation, v3 contracts, exact merge/recovery/reopen and immutable recovery downloads',result);
}
