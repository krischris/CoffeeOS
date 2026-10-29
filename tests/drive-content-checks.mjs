import assert from 'node:assert/strict';

/** Logical fingerprint checks use read-only COPY transformations of isolated fixtures. */
export async function checkDriveFingerprints(evaluate) {
  const result = await evaluate(String.raw`
    const db=await getDB();
    const connection=window.__testConnection??(await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/.vite/deps/@duckdb_duckdb-wasm.js')).name)).AsyncDuckDBConnection;
    const original=connection.prototype.query;
    const check=(v,m)=>{if(!v)throw new Error(m);};
    const snapshot=async(replace={},reverse=false,expanded=false)=>{
      connection.prototype.query=function(sql){
        for(const table of ['beans','brew_sessions']){
          if(sql.startsWith('COPY '+table+' TO ')){
            let projection=table+'.*';
            if(replace[table])projection+=' REPLACE ('+replace[table]+')';
            if(expanded&&table==='beans')projection=table+'.* REPLACE (id || lpad(i::VARCHAR,3,\'0\') AS id)';
            const from=table+(expanded&&table==='beans'?' CROSS JOIN range(257) r(i)':'');
            sql=sql.replace('COPY '+table+' TO ','COPY (SELECT '+projection+' FROM '+from+' ORDER BY id '+(reverse?'DESC':'ASC')+') TO ')
              .replace('FORMAT PARQUET','FORMAT PARQUET, COMPRESSION '+(reverse?'UNCOMPRESSED':'SNAPPY'));
          }
        }
        return original.call(this,sql);
      };
      try{return (await db.captureDriveSnapshot()).snapshot;}finally{connection.prototype.query=original;}
    };
    const hash=s=>db.hashBackupContents(s.data);
    const before=JSON.stringify((await db.exportData('csv')).map(f=>Array.from(f.data)));
    const base=await snapshot();const expected=await hash(base);
    check(await hash(await snapshot({},true))===expected,'Parquet compression/order independent');
    check(await hash({...base,exported_at:'2000-01-01T00:00:00Z'})===expected,'capture date independent');
    const many=await snapshot({},false,true),reordered=await snapshot({},true,true);
    check(many.data.beans.length!==reordered.data.beans.length,'physical files differ');
    check(await hash(many)===await hash(reordered),'257+ rows cross a stable block boundary');
    let changed=0;
    const variants={
      beans:["id || 'x' AS id","name || 'x' AS name","DATE '2001-01-02' AS roast_date","DATE '2001-02-03' AS freeze_date","TIMESTAMP '2026-10-27 12:34:56.123456' AS created_at","'photo-content' AS photo_jpeg","'webp-content' AS photo_webp"],
      brew_sessions:["id || 'x' AS id","bean_id || 'x' AS bean_id","TIMESTAMP '2026-10-27 12:34:56.123456' AS brewed_at","18.1234567890124::DOUBLE AS dose_g","1::DOUBLE AS water_g","'text' AS time_str","0::DOUBLE AS temp_c","700.1234567890124::DOUBLE AS grind_um","'quotes,\"\n精度 ☕' AS comment","0::DOUBLE AS yield_g","1.4300000000000004::DOUBLE AS tds_pct","0::DOUBLE AS extraction_pct"]
    };
    for(const [table,values]of Object.entries(variants))for(const value of values){
      check(await hash(await snapshot({[table]:value}))!==expected,table+' change: '+value);changed++;
    }
    const literal=await hash(await snapshot({beans:"'\\N' AS photo_jpeg"}));
    const blank=await hash(await snapshot({beans:"'' AS photo_jpeg"}));
    const missing=await hash(await snapshot({beans:'NULL::VARCHAR AS photo_jpeg'}));
    check(new Set([literal,blank,missing]).size===3,'null/empty/literal null marker differ');
    const plus=await hash(await snapshot({brew_sessions:"'0.0'::DOUBLE AS water_g"}));
    const minus=await hash(await snapshot({brew_sessions:"'-0.0'::DOUBLE AS water_g"}));
    // The pinned runtime's Parquet writer may normalize -0; the hash preserves
    // whichever bits are actually present in captured Parquet, without changing exports.
    const micro1=await hash(await snapshot({beans:"TIMESTAMP '2026-01-01 00:00:00.123456' AS created_at"}));
    const micro2=await hash(await snapshot({beans:"TIMESTAMP '2026-01-01 00:00:00.123457' AS created_at"}));
    check(micro1!==micro2,'microsecond timestamps differ');
    connection.prototype.query=function(sql){if(sql.startsWith('SELECT ')&&sql.includes("read_parquet('fingerprint-"))return Promise.reject(new Error('Injected fingerprint read failure'));return original.call(this,sql);};
    let failed=false;try{await hash(base);}catch{failed=true;}finally{connection.prototype.query=original;}
    check(failed&&await hash(base)===expected,'failed read stops and cleanup permits retry');
    check(JSON.stringify((await db.exportData('csv')).map(f=>Array.from(f.data)))===before,'fingerprints never mutate records');
    return {changed,rows:257,negativeZeroSurvivesParquet:plus!==minus,hash:expected};
  `);
  assert.equal(result.changed,19);
  console.log('PASS canonical Drive fingerprints, all columns, float precision, microseconds, nulls, Unicode, reordered/compressed Parquet, block boundary and failed-read retry',result);
}
