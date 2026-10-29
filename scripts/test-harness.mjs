import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { relative, resolve } from 'node:path';
import { inventory, findingsReport, runCommand, startProcess, selectSuites } from './test-harness-core.mjs';
import { registeredSuites, supportFiles } from '../tests/suites.mjs';

const root = process.cwd();
const options = process.argv.slice(2);
const selectedIndex = options.indexOf('--only');
const selected = selectedIndex < 0 ? null : new Set((options[selectedIndex + 1] ?? '').split(',').filter(Boolean));
const browserIndex = options.indexOf('--browser');
const browser = browserIndex < 0 ? 'safari' : options[browserIndex + 1];
const extended = options.includes('--extended');
const list = options.includes('--list');
const checkInventory = options.includes('--inventory');
if (options.some((arg, index) => !['--list', '--inventory', '--only', '--browser', '--extended'].includes(arg)
  && !(selectedIndex >= 0 && index === selectedIndex + 1) && !(browserIndex >= 0 && index === browserIndex + 1))
  || selected?.size === 0 || !['safari', 'firefox', 'all'].includes(browser)) {
  throw Error('Usage: uv run npm test [-- --list | --inventory | --only id,id] [--browser safari|firefox|all] [--extended]');
}
const allSuites = [
  { id: 'node-tests', file: 'tests', discovery: true },
  { id: 'build', file: 'package.json', build: true },
  ...registeredSuites,
];
if (new Set(allSuites.map(suite => suite.id)).size !== allSuites.length) throw Error('Duplicate suite IDs');
const suites = selectSuites(allSuites, {selected, browser, extended});

let discovered;
let inventoryError;
try { discovered = inventory(resolve('tests'), registeredSuites, supportFiles); }
catch (error) { inventoryError = error; }
if (list || checkInventory) {
  if (inventoryError) throw inventoryError;
  if (list) for (const suite of suites) console.log(`${suite.id}\t${suite.browser ?? 'local'}\t${suite.file}${suite.env ? ' ' + JSON.stringify(suite.env) : ''}`);
  console.log(`Inventory passed: ${discovered.length} automatically discovered Node test files; all test sources registered.`);
} else {
  await main();
}

async function freePort(port = 0) {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  const allocated = server.address().port;
  await new Promise(done => server.close(done));
  return allocated;
}

async function main() {
  if (!process.execPath.startsWith(realpathSync('.venv') + '/')) throw Error('Use this project’s Node: uv run npm test');
  mkdirSync('.cache', { recursive: true });
  const lock = '.cache/test-harness.lock';
  let lockFd;
  try { lockFd = openSync(lock, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw Error('Another harness owns .cache/test-harness.lock. Wait for it; only remove a stale lock after confirming its recorded PID has exited.');
  }
  writeFileSync(lockFd, String(process.pid));
  const startedAt = new Date().toISOString();
  const directory = `.cache/test-runs/${startedAt.replaceAll(':', '-')}-${process.pid}`;
  mkdirSync(directory, { recursive: true });
  const reportPath = 'TESTS.md';
  const previousReport = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const managed = [];
  const resources = new Map();
  const environment = { ...process.env };
  // Caller flags must not silently narrow the full matrix or connect a normal profile.
  for (const key of Object.keys(environment)) if (/^(TEST_|SAFARI_WEBDRIVER_URL$|FIREFOX_BIDI_URL$)/.test(key)) delete environment[key];
  // Node suppresses nested --test execution when this private context leaks in.
  delete environment.NODE_TEST_CONTEXT;
  environment.TEST_BACKUP_DIR = resolve(directory, 'backups');
  mkdirSync(environment.TEST_BACKUP_DIR);
  const summary = { startedAt, directory, scope: selected ? 'focused' : `full automated suite (${browser}${extended ? ', extended' : ''})`,
    profile: {browser:selected ? 'explicit selection' : browser,
      browsers:[...new Set(suites.map(suite => suite.browser).filter(Boolean))],
      extended:extended || suites.some(suite => suite.extended)},
    optedOut: selected ? [] : allSuites.filter(suite => !suites.includes(suite)).map(suite => ({id:suite.id, browser:suite.browser,
      reason: suite.browser && browser !== 'all' && suite.browser !== browser ? 'Browser requires explicit opt-in' : 'Extended profiling requires explicit opt-in'})),
    revision: 'unknown', dirty: true, results: [], node: process.version, platform: process.platform,
    manual: ['Physical iPhone/iPad touch, keyboard/viewport, Home Screen and storage lifecycle',
      'Live Google OAuth/Drive round trip (automated tests mock Google)', 'Deployed-host response headers'] };
  let active;
  const heartbeat = setInterval(() => console.log(`Running ${active ?? 'setup'}; logs: ${directory}`), 30000);
  function save() { writeFileSync(`${directory}/summary.json`, JSON.stringify(summary, null, 2) + '\n'); }
  async function launch(command, args, name) {
    const log = `${directory}/${name}.log`;
    const child = startProcess(command, args, { log, env: environment });
    managed.push(child);
    return { child, log };
  }
  async function waitForServer(child, url) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (controller.signal.aborted) throw Error('Interrupted during server setup');
      if (child.finished) throw Error(`Server exited before ${url} was ready; see resource log`);
      try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch {}
      await new Promise(done => setTimeout(done, 150));
    }
    throw Error(`Server did not become ready: ${url}`);
  }
  async function getResource(name) {
    if (resources.has(name)) return resources.get(name);
    // Cache rejected setup too: do not repeatedly launch a broken prerequisite.
    const promise = (async () => {
      if (name === 'dev' || name === 'preview') {
        const port = await freePort();
        const args = ['node_modules/vite/bin/vite.js', ...(name === 'preview' ? ['preview', '--base', '/CoffeeOS/'] : []),
          '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
        const { child, log } = await launch(process.execPath, args, name);
        const url = `http://127.0.0.1:${port}/${name === 'preview' ? 'CoffeeOS/' : ''}`;
        await waitForServer(child, url);
        return { env: { [name === 'dev' ? 'TEST_BASE_URL' : 'TEST_PREVIEW_URL']: url }, log };
      }
      if (name === 'safari') {
        const port = await freePort();
        const { child, log } = await launch(process.env.SAFARIDRIVER_BIN ?? 'safaridriver', ['-p', String(port)], name);
        const url = `http://127.0.0.1:${port}`;
        await waitForServer(child, url + '/status');
        return { env: { SAFARI_WEBDRIVER_URL: url }, log };
      }
      if (name.startsWith('firefox')) {
        const port = await freePort();
        const profile = resolve(directory, name + '-profile');
        mkdirSync(profile);
        copyFileSync('tests/firefox-user.js', `${profile}/user.js`);
        if (name === 'firefox-reduced') writeFileSync(`${profile}/user.js`, readFileSync(`${profile}/user.js`, 'utf8') + '\nuser_pref("ui.prefersReducedMotion", 1);\n');
        const binary = process.env.FIREFOX_BIN ?? (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : 'firefox');
        const { child, log } = await launch(binary, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port)], name);
        // Firefox exposes a BiDi upgrade at /session; HTTP root responds once ready.
        await waitForServer(child, `http://127.0.0.1:${port}/`);
        return { env: { FIREFOX_BIDI_URL: `ws://127.0.0.1:${port}/session`, TEST_FIREFOX: '1' }, log };
      }
      throw Error(`Unknown resource: ${name}`);
    })();
    resources.set(name, promise);
    return promise;
  }
  try {
    summary.revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8' });
    summary.dirty = Boolean(status.trim());
    writeFileSync(`${directory}/worktree.txt`, status);
    summary.diffSha256 = createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD'], { maxBuffer: 50 * 1024 * 1024 })).digest('hex');
    summary.results.push({ id: 'inventory', status: inventoryError ? 'failed' : 'passed', reason: inventoryError?.message,
      reproduce: 'uv run npm run test:inventory' });
    save();
    for (const suite of suites) {
      active = suite.id;
      const result = { id: suite.id, browser: suite.browser, reproduce: `uv run npm test -- --only ${suite.id}`,
        log: `${directory}/${suite.id}.log`, status: 'blocked', env: suite.env };
      const start = Date.now();
      try {
        if (controller.signal.aborted) throw Error('Run interrupted; suite not completed');
        if (inventoryError) throw Error('Test inventory failed; register missing coverage before running');
        for (const id of suite.depends ?? []) if (summary.results.find(item => item.id === id)?.status !== 'passed') throw Error(`Prerequisite suite ${id} did not pass`);
        const env = { ...environment, ...suite.env };
        for (const name of suite.resources ?? []) {
          result.resourceLogs ??= [];
          result.resourceLogs.push(`${directory}/${name}.log`);
          const resource = await getResource(name);
          Object.assign(env, resource.env);
        }
        if (env.TEST_PRODUCTION) env.TEST_BASE_URL = env.TEST_PREVIEW_URL;
        if (suite.port) await freePort(suite.port);
        let command = process.execPath;
        let args;
        if (suite.build) { command = 'uv'; args = ['run', 'npm', 'run', 'build']; }
        else if (suite.discovery) args = ['--test', '--test-reporter=tap', ...discovered.map(path => relative(root, path))];
        else if (suite.python) {
          const probe = await runCommand('uv', ['run', 'python', '-c', 'import pyarrow'], { log: result.log, env, timeoutMs: 10000, signal: controller.signal });
          if (probe.code !== 0) throw Error('Local Python/PyArrow unavailable. Install into the existing .venv with uv pip install -r tests/requirements.txt; see log');
          command = 'uv'; args = ['run', 'python', suite.file, ...(suite.args ?? []).map(arg => arg.replace('$BACKUP_DIR', env.TEST_BACKUP_DIR))];
        } else args = [suite.file, ...(suite.args ?? [])];
        result.command = [command, ...args];
        console.log(`START ${suite.id}`);
        const outcome = await runCommand(command, args, { log: result.log, env, timeoutMs: suite.timeoutMs ?? 1_200_000, signal: controller.signal });
        result.status = outcome.code === 0 && !outcome.timedOut && !outcome.aborted ? 'passed' : 'failed';
        if (suite.discovery && result.status === 'passed') {
          const tap = readFileSync(result.log, 'utf8');
          const skipped = [...tap.matchAll(/^# (skipped|todo) ([1-9]\d*)\s*$/gm)];
          if (!/^# tests \d+\s*$/m.test(tap)) {
            result.status = 'blocked';
            result.reason = 'Node test runner produced no completion summary';
          } else if (skipped.length) {
            result.status = 'blocked';
            result.reason = `Node tests left unexecuted assertions: ${skipped.map(match => match[1] + ' ' + match[2]).join(', ')}`;
          }
        }
        if (result.status === 'failed') {
          const tail = readFileSync(result.log, 'utf8').trim().split('\n').slice(-10).join(' ');
          result.reason = outcome.timedOut ? 'Suite exceeded its 20-minute deadline' : outcome.aborted ? 'Run interrupted during suite' : outcome.error ?? `Exit ${outcome.code}: ${tail}`;
        }
      } catch (error) {
        result.reason = error.message;
        if (!existsSync(result.log)) result.log = result.resourceLogs?.findLast(path => existsSync(path)) ?? `${directory}/summary.json`;
      }
      result.seconds = Math.round((Date.now() - start) / 100) / 10;
      summary.results.push(result);
      save();
      console.log(`${result.status.toUpperCase()} ${suite.id}${result.reason ? ': ' + result.reason : ''}`);
    }
  } catch (error) {
    summary.results.push({ id: 'harness', status: 'failed', reason: error.message, reproduce: 'uv run npm test' });
  } finally {
    active = 'cleanup';
    for (const child of managed.reverse()) if (!child.finished) {
      try { await child.stop(); }
      catch (error) { summary.results.push({ id: 'cleanup', status: 'failed', reason: error.message, reproduce: 'uv run npm test' }); }
    }
    for (const suite of suites) if (!summary.results.some(item => item.id === suite.id)) summary.results.push({
      id: suite.id, status: 'blocked', reason: 'Harness stopped before this suite ran', reproduce: `uv run npm test -- --only ${suite.id}`,
    });
    summary.finishedAt = new Date().toISOString();
    try {
      save();
      if (!selected) writeFileSync(reportPath, findingsReport(summary, previousReport));
    } finally {
      clearInterval(heartbeat);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      closeSync(lockFd);
      unlinkSync(lock);
    }
  }
  const issues = summary.results.filter(result => result.status !== 'passed');
  console.log(`${summary.results.length - issues.length} passed; ${issues.length} failed/blocked. Summary: ${directory}/summary.json`);
  console.log(selected ? 'Focused run; TESTS.md unchanged.' : 'Full run findings: TESTS.md (existing unresolved findings retained).');
  if (summary.optedOut.length) console.log(`${summary.optedOut.length} opt-in suites excluded; see summary.optedOut. Use --browser all and/or --extended to include them.`);
  console.log('Unverified manual gates: ' + summary.manual.join('; '));
  process.exitCode = issues.length ? 1 : 0;
}
