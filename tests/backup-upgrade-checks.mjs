import assert from 'node:assert/strict';
/** Exercise current production backup controls with a populated collection. */
export async function checkBackupUpgrade({sync,evaluate,waitFor,api,ready,state}) {
 const before=await state();
 const originalHash=await evaluate(`const db=await getDB();return db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data);`);
 await evaluate(`window.__upgradeBackup=await (await getBackups()).saveBackup();`);
 await sync(`document.querySelector('#tab-io').click();document.querySelector('.save-backup').click();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal(await sync(`return document.querySelectorAll('.io-export .download-file').length;`),1);
 assert.equal(await sync(`return document.querySelector('#export-layout');`),null);
 await evaluate(String.raw`const db=await getDB();const bean=(await db.getBeans())[0];const quote=v=>v==null?'\\N':'"'+String(v).replaceAll('"','""')+'"';
   const csv=['id,name,roast_date,freeze_date,created_at',[bean.id,'Changed before archive merge',bean.roast_date,bean.freeze_date,bean.created_at].map(quote).join(',')].join('\n');
   await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(csv)}]);
   const t=new DataTransfer();t.items.add(new File([window.__upgradeBackup.data],'upgrade.coffeeos',{type:'application/octet-stream'}));const input=document.querySelector('#import-backup');input.files=t.files;input.dispatchEvent(new Event('change'));`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal(await sync(`return document.querySelector('.backup-preview').hidden;`),false,await sync(`return document.querySelector('.import-error').textContent;`));
 assert.notDeepEqual(await state(),before,'selection must not apply merge');
 await sync(`document.querySelector('.io-import').requestSubmit();document.querySelector('.io-import').requestSubmit();`);
 await waitFor(`document.querySelector('#io > div').getAttribute('aria-busy') === 'false'`);
 assert.equal(await sync(`return document.querySelector('.import-error').hidden;`),true,await sync(`return document.querySelector('.import-error').textContent;`));
 assert.deepEqual(await state(),before);
 await api('/refresh',{});await ready();assert.deepEqual(await state(),before);
 assert.equal(await evaluate(`const db=await getDB();return db.hashBackupContents((await db.captureDriveSnapshot()).snapshot.data);`),originalHash,'logical hash survives production merge/reload');
 const recovery=await evaluate(`const db=await getDB(),b=await getBackups();const copies=await db.listImportRecoveries();const file=await b.packageBackup(await db.readImportRecovery(copies[0].key));const prepared=await b.prepareBackup(file.data);return {copies:copies.length,updated:prepared.preview.beans.updated};`);
 assert.ok(recovery.copies>=1);assert.equal(recovery.updated,1);
 console.log('PASS current production /CoffeeOS/ archive download, preview-only selection, explicit atomic merge, recovery download and reload');
}
