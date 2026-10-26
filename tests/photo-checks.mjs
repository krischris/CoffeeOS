import assert from 'node:assert/strict';

export async function photoChecks({sync, evaluate, waitFor, openBeans, api, ready, state}) {
  await openBeans();
  await evaluate(`const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1800;
    canvas.getContext('2d').fillRect(0,0,2400,1800);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'beans.png',{type:'image/png'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  await waitFor(`document.querySelector('.photo-status').textContent.includes('JPEG ready')`);
  const photo = await evaluate(`const image=document.querySelector('.photo-preview');await image.decode();return {src:image.src,width:image.naturalWidth,height:image.naturalHeight};`);
  assert.equal(photo.width,1600);assert.equal(photo.height,1200);
  assert.ok(photo.src.startsWith('data:image/jpeg;base64,'));
  await sync(`document.querySelector('#bean-name').value='Photo bean';document.querySelector('.bean-form').requestSubmit();`);
  await waitFor(`document.querySelector('.bean-form .form-message').textContent==='Added Photo bean.'`);
  assert.equal(await sync(`return document.querySelector('.photo-preview').hidden;`),true);
  const before=await state();
  const bean=before.beans.find(bean=>bean.name==='Photo bean');
  assert.equal(bean.photo_jpeg,photo.src);
  await sync(`document.querySelector('[data-bean-id="${bean.id}"] details').open=true;`);
  assert.equal(await sync(`return document.querySelector('[data-bean-id="${bean.id}"] .bean-photo').src;`),photo.src);
  for (const format of ['csv','parquet']) for (const combined of [false,true]) {
    await evaluate(`const db=await getDB();const files=await db.exportData('${format}',${combined});
      await db.importData(files.map(file=>({...file,target:${combined}?'combined':file.name.split('.')[0]})));`);
    assert.deepEqual(await state(),before);
  }
  const legacyCSV = ['id,name,roast_date,freeze_date,created_at',
    [bean.id,bean.name,'\\N','\\N',bean.created_at].join(',')].join('\n');
  await evaluate(`await (await getDB()).importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(${JSON.stringify(legacyCSV)})}]);`);
  assert.deepEqual(await state(),before);
  await api('/refresh',{});await ready();assert.deepEqual(await state(),before);
  await openBeans();
  await evaluate(`const transfer=new DataTransfer();transfer.items.add(new File(['invalid'],'bad.jpg',{type:'image/jpeg'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  await waitFor(`!document.querySelector('.bean-form .form-error').hidden`);
  assert.deepEqual(await state(),before);
  await evaluate(`const transfer=new DataTransfer();transfer.items.add(new File([await (await fetch(${JSON.stringify(photo.src)})).blob()],'photo.jpg',{type:'image/jpeg'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  await waitFor(`document.querySelector('.photo-status').textContent.includes('JPEG ready')`);
  await sync(`document.querySelector('.remove-photo').click();`);
  assert.equal(await sync(`return document.querySelector('.photo-preview').hidden && !document.querySelector('#bean-photo').value;`),true);
  console.log('PASS photo resize/JPEG, form save/reset, expanded view, CSV/Parquet round trips, reload, invalid image');
}
