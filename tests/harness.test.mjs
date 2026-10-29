import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { inventory, findingsReport, runCommand } from '../scripts/test-harness-core.mjs';
import { registeredSuites, supportFiles } from './suites.mjs';

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'coffeeos-harness-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('all existing regression sources are reachable from registered suites', () => {
  const discovered = inventory(resolve('tests'), registeredSuites, supportFiles);
  assert.ok(discovered.includes(resolve('tests/harness.test.mjs')));
});

test('new nested Node tests are discovered and unregistered scripts cannot disappear', t => {
  const root = temporary(t);
  mkdirSync(join(root, 'nested'));
  const entry = join(root, 'nested/new.test.mjs');
  writeFileSync(entry, "import {check} from '../checks.mjs';");
  writeFileSync(join(root, 'checks.mjs'), 'export const check = () => {};');
  assert.deepEqual(inventory(root, []), [entry]);
  writeFileSync(join(root, 'forgotten-browser.mjs'), 'throw Error("regression");');
  assert.throws(() => inventory(root, []), /Unregistered test files.*\n.*forgotten-browser/s);
  assert.deepEqual(inventory(root, [{ file: join(root, 'forgotten-browser.mjs') }]), [entry]);
});

test('a missing registered entry is a coverage failure', t => {
  assert.throws(() => inventory(temporary(t), [{ file: '/missing/coffeeos-test.mjs' }]), /Missing registered test/);
});

test('full suite includes both persistence backends and historical/recent upgrades', () => {
  for (const browser of ['safari', 'firefox']) {
    for (const id of ['db', 'production', 'photos', 'backups', 'drive', 'authorization', 'diagnostics', 'isolation', 'offline', 'upgrade-legacy', 'upgrade-jpeg', 'upgrade-recent']) {
      assert.ok(registeredSuites.some(suite => suite.id === `${id}-${browser}`), `${id}-${browser}`);
    }
  }
});

test('findings handoff distinguishes failures/blockers, retains evidence and prior findings', () => {
  const summary = { startedAt: '2026-10-29T12:00:00Z', scope: 'full automated suite', revision: 'abc', dirty: true, directory: '.cache/run', results: [
    { id: 'passes', status: 'passed' },
    { id: 'writes', status: 'failed', browser: 'safari', reason: 'Expected 3, received 0', reproduce: 'uv run npm test -- --only writes', log: '.cache/run/writes.log' },
    { id: 'opfs', status: 'blocked', browser: 'firefox', reason: 'Firefox missing', reproduce: 'uv run npm test -- --only opfs' },
  ] };
  const report = findingsReport(summary, 'Unresolved earlier issue\n');
  assert.match(report, /^Unresolved earlier issue/);
  assert.match(report, /FAILED writes.*\(safari\)/);
  assert.match(report, /Expected 3, received 0/);
  assert.match(report, /BLOCKED opfs/);
  assert.match(report, /uv run npm test -- --only writes/);
  assert.doesNotMatch(report, /passes/);
  assert.equal(findingsReport({ ...summary, results: [{ status: 'passed' }] }), '');
  assert.equal(findingsReport({ ...summary, results: [] }, 'Pending\n'), 'Pending\n');
});

test('command failures retain logs and subsequent checks still run', async t => {
  const root = temporary(t);
  const failed = await runCommand(process.execPath, ['-e', 'console.error("injected regression"); process.exit(7)'], { log: join(root, 'failed.log') });
  assert.equal(failed.code, 7);
  assert.match(readFileSync(join(root, 'failed.log'), 'utf8'), /injected regression/);
  const next = await runCommand(process.execPath, ['-e', 'console.log("next suite")'], { log: join(root, 'next.log') });
  assert.equal(next.code, 0);
  assert.match(readFileSync(join(root, 'next.log'), 'utf8'), /next suite/);
});

test('unavailable executable is an explicit command failure', async t => {
  const result = await runCommand('/missing/coffeeos-executable', [], { log: join(temporary(t), 'missing.log') });
  assert.equal(result.code, null);
  assert.match(result.error, /ENOENT/);
});

test('a hung suite has a bounded timeout', async t => {
  const result = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    log: join(temporary(t), 'hung.log'), timeoutMs: 100,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});

test('interruption terminates an active suite', async t => {
  const controller = new AbortController();
  const promise = runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    log: join(temporary(t), 'interrupted.log'), signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  const result = await promise;
  assert.equal(result.aborted, true);
  assert.notEqual(result.code, 0);
});

test('focused CLI isolates artifacts, reports failure, continues and leaves handoff unchanged', async t => {
  // A miniature project exercises the actual coordinator without running app regressions.
  const root = temporary(t);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'tests'));
  const { copyFileSync, symlinkSync } = await import('node:fs');
  for (const name of ['test-harness.mjs', 'test-harness-core.mjs']) copyFileSync(`scripts/${name}`, join(root, 'scripts', name));
  symlinkSync(resolve('.venv'), join(root, '.venv'), 'dir');
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  writeFileSync(join(root, 'tests/suites.mjs'), `export const supportFiles=['tests/suites.mjs']; export const registeredSuites=[
    {id:'broken',file:'tests/broken.mjs'}, {id:'next',file:'tests/next.mjs'},
    {id:'blocked',file:'tests/next.mjs',depends:['broken']}
  ];`);
  writeFileSync(join(root, 'tests/broken.mjs'), 'console.error("fixture failure");process.exit(4)');
  writeFileSync(join(root, 'tests/next.mjs'), 'if(process.env.TEST_REVIEW_ONLY || process.env.TEST_FIREFOX || process.env.TEST_MVP) throw Error("inherited narrowing flag"); console.log("fixture next")');
  writeFileSync(join(root, 'TESTS.md'), 'Existing finding\n');
  // Git is deliberately unavailable in the fixture; supply a tiny local executable.
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nif [ "$1" = "rev-parse" ]; then echo fixture; fi\n', { mode: 0o755 });
  const log = join(root, 'cli.log');
  const outcome = await runCommand(process.execPath, ['scripts/test-harness.mjs', '--only', 'broken,next,blocked'], {
    cwd: root, env: { ...process.env, TEST_REVIEW_ONLY: 'runtime', TEST_FIREFOX: '1', TEST_MVP: '1', PATH: `${bin}:${process.env.PATH}` }, log,
  });
  assert.equal(outcome.code, 1, readFileSync(log, 'utf8'));
  const runs = (await import('node:fs')).readdirSync(join(root, '.cache/test-runs'));
  const summary = JSON.parse(readFileSync(join(root, '.cache/test-runs', runs[0], 'summary.json')));
  assert.equal(summary.results.find(item => item.id === 'broken').status, 'failed');
  assert.equal(summary.results.find(item => item.id === 'next').status, 'passed');
  assert.equal(summary.results.find(item => item.id === 'blocked').status, 'blocked');
  assert.equal(readFileSync(join(root, 'TESTS.md'), 'utf8'), 'Existing finding\n');
  assert.equal(existsSync(join(root, '.cache/test-harness.lock')), false);

  // Full reporting is tested only in this miniature project, never the app matrix.
  writeFileSync(join(root, 'tests/smoke.test.mjs'), "import test from 'node:test'; test('fixture', () => {});");
  writeFileSync(join(bin, 'uv'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const runFull = (options = {}) => runCommand(process.execPath, ['scripts/test-harness.mjs'], {
    cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, log, ...options,
  });
  assert.equal((await runFull()).code, 1);
  const report = readFileSync(join(root, 'TESTS.md'), 'utf8');
  assert.match(report, /^Existing finding/);
  assert.match(report, /FAILED broken/);
  assert.match(report, /BLOCKED blocked/);
  writeFileSync(join(root, 'tests/broken.mjs'), 'console.log("fixed fixture")');
  assert.equal((await runFull()).code, 0);
  assert.equal(readFileSync(join(root, 'TESTS.md'), 'utf8'), report, 'passing run preserves unresolved findings');
  writeFileSync(join(root, 'TESTS.md'), '');
  assert.equal((await runFull()).code, 0);
  assert.equal(readFileSync(join(root, 'TESTS.md'), 'utf8'), '', 'clean full run has zero-byte handoff');
  writeFileSync(join(root, 'tests/smoke.test.mjs'), "import test from 'node:test'; test.skip('unavailable fixture', () => {});");
  assert.equal((await runFull()).code, 1, 'skipped assertions cannot pass the full run');
  assert.match(readFileSync(join(root, 'TESTS.md'), 'utf8'), /BLOCKED node-tests/);
  writeFileSync(join(root, 'tests/smoke.test.mjs'), "import test from 'node:test'; test('fixture', () => {});");
  writeFileSync(join(root, 'tests/broken.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('ready', ''); setInterval(() => {}, 1000);");
  const controller = new AbortController();
  t.after(() => controller.abort());
  const interrupted = runFull({ signal: controller.signal, timeoutMs: 5000 });
  for (let attempt = 0; attempt < 80 && !existsSync(join(root, 'ready')); attempt++) await new Promise(done => setTimeout(done, 50));
  assert.ok(existsSync(join(root, 'ready')), 'fixture reached its active suite');
  controller.abort();
  assert.equal((await interrupted).aborted, true);
  assert.match(readFileSync(join(root, 'TESTS.md'), 'utf8'), /Run interrupted during suite/);
  assert.equal(existsSync(join(root, '.cache/test-harness.lock')), false, 'interrupted coordinator releases its lock');
  writeFileSync(join(root, '.cache/test-harness.lock'), String(process.pid));
  const locked = await runFull();
  assert.equal(locked.code, 1);
  assert.equal(readFileSync(join(root, '.cache/test-harness.lock'), 'utf8'), String(process.pid), 'second run preserves another owner’s lock');
});
