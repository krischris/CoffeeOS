import assert from 'node:assert/strict';

async function checkPhotoCompression({evaluate, waitFor}) {
  for (const fixture of [
    {name:'detailed', width:2400, height:1800, noise:true},
    {name:'quality', width:512, height:384, noise:true},
    {name:'portrait', width:600, height:2400},
    {name:'panorama', width:2400, height:120},
    {name:'transparent', width:32, height:24, transparent:true},
    {name:'large-input', width:32, height:24, large:true},
  ]) {
    const source = await evaluate(`const fixture=${JSON.stringify(fixture)};
      let canvas=document.createElement('canvas');canvas.width=fixture.width;canvas.height=fixture.height;
      const context=canvas.getContext('2d');
      if(fixture.noise){
        const pixels=context.createImageData(canvas.width,canvas.height);let seed=123456789;
        for(let i=0;i<pixels.data.length;i+=4){
          for(let channel=0;channel<3;channel++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+channel]=seed>>>24;}
          pixels.data[i+3]=255;
        }
        context.putImageData(pixels,0,0);
      }else if(!fixture.transparent)context.fillRect(0,0,canvas.width,canvas.height);
      // JPEG quality mappings differ by browser. Find a source where quality
      // alone can meet the limit, independently of the production compressor.
      const encode=window.__testEncodeWebP??(await import('/src/webpEncoder.ts')).encodeWebP;
      if(fixture.name==='quality')while((await encode(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),50)).byteLength>100000){
        const resized=document.createElement('canvas');resized.width=Math.floor(canvas.width*0.9);resized.height=Math.floor(canvas.height*0.9);
        resized.getContext('2d').drawImage(canvas,0,0,resized.width,resized.height);canvas=resized;
      }
      const initial=await encode(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),80);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const file=new File(fixture.large?[blob,new Uint8Array(31*1024*1024)]:[blob],fixture.name+'.png',{type:'image/png'});
      const transfer=new DataTransfer();transfer.items.add(file);
      const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));
      return {bytes:file.size,width:canvas.width,height:canvas.height,originalBytes:initial.byteLength,
        busy:input.disabled&&document.querySelector('.bean-form [type=submit]').disabled};`);
    assert.equal(source.busy,true,fixture.name+' blocks save until compression finishes');
    if(fixture.large) assert.ok(source.bytes>30*1024*1024,'source size is not an upload rejection');
    await waitFor(`document.querySelector('.photo-status').textContent.includes('WebP ready') || !document.querySelector('.bean-form .form-error').hidden`);
    const result = await evaluate(`const image=document.querySelector('.photo-preview');await image.decode();
      const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;canvas.getContext('2d').drawImage(image,0,0);
      return {bytes:atob(image.src.split(',')[1]).length,width:image.naturalWidth,height:image.naturalHeight,
        prefix:image.src.slice(0,23),status:document.querySelector('.photo-status').textContent,
        error:document.querySelector('.bean-form .form-error').hidden?null:document.querySelector('.bean-form .form-error').textContent,
        pixel:[...canvas.getContext('2d').getImageData(0,0,1,1).data]};`);
    assert.equal(result.error,null,fixture.name);
    assert.equal(result.prefix,'data:image/webp;base64,');
    assert.ok(result.bytes<=100_000,fixture.name+' exact decoded WebP bytes');
    assert.equal(result.status,`WebP ready · ${(result.bytes/1000).toFixed(1)} kB`);
    assert.ok(result.width<=1600&&result.height<=1600);
    assert.ok(Math.abs(result.width/result.height-source.width/source.height)<0.02,'aspect ratio');
    if(fixture.name==='detailed')assert.ok(result.width<1600,'high-detail source requires dimension reduction');
    if(fixture.name==='quality'){
      assert.ok(source.originalBytes>100_000,'quality-only fixture starts above the limit');
      assert.equal(result.width,source.width);assert.equal(result.height,source.height);
    }
    if(fixture.transparent){assert.equal(result.width,32);assert.equal(result.height,24);assert.deepEqual(result.pixel,[255,255,255,255]);}
    console.log('PASS automatic photo compression',fixture.name,JSON.stringify({sourceBytes:source.bytes,...result}));
  }
}

export async function photoChecks({sync, evaluate, waitFor, openBeans, api, ready, state}) {
  await openBeans();
  await sync(`if(document.querySelector('.bean-form').hidden)document.querySelector('.add-bean-toggle').click();`);
  await evaluate(`const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1800;
    canvas.getContext('2d').fillRect(0,0,2400,1800);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'beans.png',{type:'image/png'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  await waitFor(`document.querySelector('.photo-status').textContent.includes('WebP ready')`);
  const photo = await evaluate(`const image=document.querySelector('.photo-preview');await image.decode();return {src:image.src,width:image.naturalWidth,height:image.naturalHeight};`);
  assert.equal(photo.width,1600);assert.equal(photo.height,1200);
  assert.ok(photo.src.startsWith('data:image/webp;base64,'));
  assert.ok(Buffer.from(photo.src.split(',')[1],'base64').length<=100_000);
  await sync(`document.querySelector('#bean-name').value='Photo bean';document.querySelector('.bean-form').requestSubmit();`);
  await waitFor(`document.querySelector('.bean-form .form-message').textContent==='Added Photo bean.'`);
  assert.equal(await sync(`return document.querySelector('.photo-preview').hidden;`),true);
  const before=await state();
  const bean=before.beans.find(bean=>bean.name==='Photo bean');
  assert.equal(bean.photo_webp,photo.src);assert.equal(bean.photo_jpeg,null);
  const archive = await evaluate(`const db=await getDB(),b=window.__testBackups??await import('/src/backups.ts');
    const saved=await b.saveBackup(),prepared=await b.prepareBackup(saved.data);
    const bytes=Uint8Array.from(atob(${JSON.stringify(photo.src)}.split(',')[1]),char=>char.charCodeAt(0));
    const url=data=>'data:image/webp;base64,'+btoa(String.fromCharCode(...data));
    const wrongLength=new Uint8Array(bytes);wrongLength[4]^=1;
    const bad=['data:image/webp;base64,AAAA',url(wrongLength),url(bytes.slice(0,-1))];
    for(const value of bad){
      let rejected=false;try{await db.addBean({name:'Bad WebP',photo_webp:value});}catch{rejected=true;}
      if(!rejected)throw Error('Malformed WebP must be rejected');
      const csv='id,name,roast_date,freeze_date,created_at,photo_jpeg,photo_webp\\ninvalid-webp,Bad,\\\\N,\\\\N,2024-01-02T03:04:05.123456Z,\\\\N,"'+value+'"\\n';
      rejected=false;try{await db.importData([{target:'beans',name:'beans.csv',data:new TextEncoder().encode(csv)}],{preserveLegacyPhotos:true});}catch{rejected=true;}
      if(!rejected)throw Error('Legacy JPEG preservation must not bypass WebP validation');
    }
    let misplaced=false;try{await db.addBean({name:'Misplaced WebP',photo_jpeg:${JSON.stringify(photo.src)}});}catch{misplaced=true;}
    if(!misplaced)throw Error('JPEG field must keep its meaning');
    return {format:prepared.manifest.format_version,schema:prepared.manifest.data_schema_version,
      encoding:prepared.manifest.photo_encoding,column:prepared.manifest.tables.find(t=>t.name==='beans').columns.at(-1)};`);
  assert.equal(archive.format,4);assert.equal(archive.schema,2);assert.equal(archive.encoding,'jpeg-webp-v1');
  assert.deepEqual(archive.column,{name:'photo_webp',logical_type:'webp_data_url',nullable:true});
  assert.deepEqual(await state(),before,'malformed photo failures do not mutate records');
  await sync(`document.querySelector('[data-bean-id="${bean.id}"] summary').click();`);
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
  await sync(`if(document.querySelector('.bean-form').hidden)document.querySelector('.add-bean-toggle').click();`);
  await evaluate(`const transfer=new DataTransfer();transfer.items.add(new File(['invalid'],'bad.jpg',{type:'image/jpeg'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  await waitFor(`!document.querySelector('.bean-form .form-error').hidden`);
  assert.deepEqual(await state(),before);
  await evaluate(`const transfer=new DataTransfer();transfer.items.add(new File([await (await fetch(${JSON.stringify(photo.src)})).blob()],'photo.jpg',{type:'image/jpeg'}));
    const input=document.querySelector('#bean-photo');input.files=transfer.files;input.dispatchEvent(new Event('change'));`);
  await waitFor(`document.querySelector('.photo-status').textContent.includes('WebP ready')`);
  await checkPhotoCompression({evaluate,waitFor});
  await sync(`document.querySelector('.remove-photo').click();`);
  assert.equal(await sync(`return document.querySelector('.photo-preview').hidden && !document.querySelector('#bean-photo').value;`),true);
  console.log('PASS photo resize/WebP, form save/reset, expanded view, CSV/Parquet round trips, reload, invalid image');
}
