// Production assets with test-only access hooks, isolated from dist/.
import {execFileSync} from 'node:child_process';
import {mkdirSync, symlinkSync, readFileSync, writeFileSync, cpSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
export function prepareCurrentBuild(root) {
  mkdirSync(root, {recursive:true});
  for (const entry of ['candidate-source', 'candidate']) rmSync(`${root}/${entry}`, {recursive:true, force:true});
  const build = (source, outDir) => execFileSync('uv', ['run', 'node', `${source}/node_modules/vite/bin/vite.js`, 'build', source, '--outDir', outDir], {stdio:'pipe'});
  const candidate = `${root}/candidate-source`;
  mkdirSync(candidate);
  for (const entry of ['src', 'public', 'vite.config.ts', 'index.html', 'package.json', 'package-lock.json']) cpSync(entry, `${candidate}/${entry}`, {recursive:true});
  symlinkSync(resolve('node_modules'), `${candidate}/node_modules`, 'dir');
  writeFileSync(`${candidate}/test-db.ts`, "import * as db from './src/db'; import { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'; Object.assign(window, {__testDB: db, __testConnection: AsyncDuckDBConnection}); const originalQuery = AsyncDuckDBConnection.prototype.query; AsyncDuckDBConnection.prototype.query = async function(sql) { const result = await originalQuery.call(this, sql); if ((window as any).__failPhotoMigration && sql === 'ALTER TABLE beans ADD COLUMN photo_jpeg VARCHAR') throw new Error('Injected photo migration failure after ALTER'); return result; };");
  writeFileSync(`${candidate}/test-db.ts`, readFileSync(`${candidate}/test-db.ts`, 'utf8') + "\nimport * as backups from './src/backups'; import * as zip from 'fflate'; import { createStartupView } from './src/startupView'; import { createDriveView } from './src/views/driveView'; Object.assign(window,{__testCreateDriveView:createDriveView,__testBackups:backups,__testZIP:zip,__testStartupView:createStartupView});");
  writeFileSync(`${candidate}/test-db.ts`, readFileSync(`${candidate}/test-db.ts`, 'utf8') + "\nimport { encodeWebP } from './src/webpEncoder'; Object.assign(window,{__testEncodeWebP:encodeWebP});");
  const candidateIndex = `${candidate}/index.html`;
  writeFileSync(candidateIndex, readFileSync(candidateIndex, 'utf8').replace('<head>', '<head><script>window.__startupDocument=crypto.randomUUID();window.__startupErrors=[];const originalError=console.error;console.error=(...args)=>{window.__startupErrors.push(args.map(String));originalError(...args);};</script>').replace('</head>', '<script type="module" src="/test-db.ts"></script></head>'));
  build(candidate, '../candidate');
}
