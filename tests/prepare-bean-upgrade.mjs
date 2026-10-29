import {prepareCurrentBuild} from './prepare-current-build.mjs';
// Build both revisions with the same test-only DB access hook. No hook ships in dist/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve('.cache/bean-upgrade');
rmSync(root, {recursive:true, force:true});
mkdirSync(root, {recursive:true});
const previous = process.env.TEST_PREVIOUS_REF ?? '2ccf66cbf840e9455d54f8b31d57b4df944e3bf6';
const archive = execFileSync('git', ['archive', previous, 'src', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'public'], {maxBuffer:100 * 1024 * 1024});
execFileSync('tar', ['-x', '-C', root], {input:archive});
// Never build an old revision with a changed lockfile's packages.
const oldLock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8'));
const newLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const sameDependencies = JSON.stringify(oldLock.packages) === JSON.stringify(newLock.packages);
if (sameDependencies) symlinkSync(resolve('node_modules'), `${root}/node_modules`, 'dir');
else execFileSync('uv', ['run', 'npm', 'ci', '--prefix', root, '--cache', resolve('.cache/npm'), '--ignore-scripts'], {stdio:'pipe'});
writeFileSync(`${root}/test-db.ts`, "import * as db from './src/db'; import { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'; Object.assign(window, {__testDB: db, __testConnection: AsyncDuckDBConnection}); const originalQuery = AsyncDuckDBConnection.prototype.query; AsyncDuckDBConnection.prototype.query = async function(sql) { const result = await originalQuery.call(this, sql); if ((window as any).__failPhotoMigration && sql === 'ALTER TABLE beans ADD COLUMN photo_jpeg VARCHAR') throw new Error('Injected photo migration failure after ALTER'); return result; };");
const index = `${root}/index.html`;
writeFileSync(index, readFileSync(index, 'utf8').replace('</head>', '<script type="module" src="/test-db.ts"></script></head>'));
function build(source, outDir) {
  execFileSync('uv', ['run', 'node', `${source}/node_modules/vite/bin/vite.js`, 'build', source, '--outDir', outDir], {stdio:'pipe'});
}
build(root, 'previous');
prepareCurrentBuild(root);
console.log('Built upgrade fixtures from', previous, 'and current source; separate dependency installations:', !sameDependencies);
