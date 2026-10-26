// Build both revisions with the same test-only DB access hook. No hook ships in dist/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, symlinkSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve('.cache/bean-upgrade');
rmSync(root, {recursive:true, force:true});
mkdirSync(root, {recursive:true});
const previous = process.env.TEST_PREVIOUS_REF ?? '2ccf66cbf840e9455d54f8b31d57b4df944e3bf6';
const archive = execFileSync('git', ['archive', previous, 'src', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'public'], {maxBuffer:100 * 1024 * 1024});
execFileSync('tar', ['-x', '-C', root], {input:archive});
// Sharing the installed toolchain is valid only while both lockfiles resolve
// the same packages. Dependency upgrades need separately installed old fixtures.
const oldLock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8'));
const newLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
if (JSON.stringify(oldLock.packages) !== JSON.stringify(newLock.packages)) {
  throw new Error('Upgrade fixture dependencies differ: install the previous lockfile in an isolated fixture before testing this dependency upgrade.');
}
if (!existsSync(`${root}/node_modules`)) symlinkSync(resolve('node_modules'), `${root}/node_modules`, 'dir');
writeFileSync(`${root}/test-db.ts`, "import * as db from './src/db'; import { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'; Object.assign(window, {__testDB: db, __testConnection: AsyncDuckDBConnection}); const originalQuery = AsyncDuckDBConnection.prototype.query; AsyncDuckDBConnection.prototype.query = async function(sql) { const result = await originalQuery.call(this, sql); if ((window as any).__failPhotoMigration && sql === 'ALTER TABLE beans ADD COLUMN photo_jpeg VARCHAR') throw new Error('Injected photo migration failure after ALTER'); return result; };");
const index = `${root}/index.html`;
writeFileSync(index, readFileSync(index, 'utf8').replace('</head>', '<script type="module" src="/test-db.ts"></script></head>'));
function build(outDir) {
  execFileSync('uv', ['run', 'node', 'node_modules/vite/bin/vite.js', 'build', root, '--outDir', outDir], {stdio:'pipe'});
}
build('previous');
for (const entry of ['src', 'public', 'vite.config.ts', 'index.html']) cpSync(entry, `${root}/${entry}`, {recursive:true});
writeFileSync(index, readFileSync(index, 'utf8').replace('</head>', '<script type="module" src="/test-db.ts"></script></head>'));
build('candidate');
console.log('Built upgrade fixtures from', previous, 'and current source');
