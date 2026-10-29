import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {prepareCurrentBuild} from './prepare-current-build.mjs';
import {startFixtureServer} from './fixture-server.mjs';
import {fixtureBrowser} from './fixture-browser.mjs';

// No historical build is needed for current functional regressions.
export async function withCurrentBuild(checks) {
  const root = resolve('.cache/current-regression');
  prepareCurrentBuild(root);
  const browser = await fixtureBrowser();
  const host = await startFixtureServer(root);
  try {
    const base = 'http://127.0.0.1:5175/CoffeeOS/';
    await browser.open(base);
    const {evaluate} = browser;
    const mode = await evaluate('return (await getDB()).getStorageMode();');
    assert.equal(mode, process.env.TEST_FIREFOX ? 'opfs' : 'indexeddb');
    await evaluate(`const db=await getDB();
      const other=await db.addBean({name:'Keep functional bean'});
      const bean=await db.addBean({name:'Functional bean ☕',roast_date:'2025-01-02',freeze_date:null});
      const values={dose_g:15.123456789,water_g:0,time_str:'',temp_c:null,grind_um:222.222222222,
        comment:'line one\\nline two ☕',yield_g:null,tds_pct:1.123456789,extraction_pct:null};
      for(const bean_id of [bean.id,bean.id,other.id])await db.addBrewSession({...values,bean_id});`);
    const state = () => evaluate('const db=await getDB();return {beans:await db.getBeans(),sessions:await db.getBrewSessions()};');
    await checks({...browser, state, mode, faults:host.faults});
  } finally {
    try {await browser.close();} finally {await host.close();}
  }
}
