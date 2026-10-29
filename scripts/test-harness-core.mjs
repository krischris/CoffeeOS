import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

export function selectSuites(all, { selected = null, browser = 'safari', extended = false } = {}) {
  if (!['safari', 'firefox', 'all'].includes(browser)) throw Error(`Unknown browser: ${browser}`);
  const chosen = new Set();
  function include(suite) {
    if (chosen.has(suite)) return;
    if (!selected && ((suite.browser && browser !== 'all' && suite.browser !== browser) || (suite.extended && !extended))) {
      throw Error(`Prerequisite ${suite.id} requires explicit opt-in; label its dependent suite with the same browser/profile`);
    }
    chosen.add(suite);
    for (const id of suite.depends ?? []) {
      const dependency = all.find(item => item.id === id);
      if (!dependency) throw Error(`Unknown dependency ${id} in ${suite.id}`);
      include(dependency);
    }
  }
  if (selected) {
    for (const id of selected) {
      const suite = all.find(item => item.id === id);
      if (!suite) throw Error(`Unknown suite: ${id}`);
      include(suite);
    }
  } else {
    for (const suite of all) {
      if (suite.browser && browser !== 'all' && suite.browser !== browser) continue;
      if (suite.extended && !extended) continue;
      include(suite);
    }
  }
  return all.filter(suite => chosen.has(suite));
}

export function testFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(mjs|ts|py|js)$/.test(entry.name))
    .map(entry => resolve(entry.parentPath, entry.name)).sort();
}

// Follow real static/dynamic imports, without treating fixture strings as imports.
// Browser-evaluated imports are declared with a suite's `includes` metadata.
export function inventory(root, suites, support = []) {
  const files = testFiles(root);
  const discovered = files.filter(path => path.endsWith('.test.mjs'));
  const covered = new Set(support.map(path => resolve(path)));
  function visit(path) {
    path = resolve(path);
    if (covered.has(path)) return;
    if (!existsSync(path)) throw new Error(`Missing registered test: ${path}`);
    covered.add(path);
    if (path.endsWith('.py')) return;
    const source = readFileSync(path, 'utf8');
    const ast = parseAst(source, { lang: path.endsWith('.ts') ? 'ts' : 'js' }, path);
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) {
        const imported = node.source?.value;
        if (typeof imported === 'string') {
          const target = imported.startsWith('.') ? resolve(dirname(path), imported)
            : imported.startsWith('/tests/') ? resolve(root, imported.slice(7)) : null;
          if (target?.startsWith(resolve(root) + '/')) visit(target);
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value?.type) walk(value);
      }
    }
    walk(ast);
  }
  for (const path of [...discovered, ...suites.flatMap(suite => [suite.file, ...(suite.includes ?? [])])]) visit(path);
  const missing = files.filter(path => !covered.has(path));
  if (missing.length) throw new Error(`Unregistered test files:\n${missing.map(path => relative(process.cwd(), path)).join('\n')}\nAdd *.test.mjs, import from a registered suite, or register in tests/suites.mjs.`);
  return discovered;
}

export function startProcess(command, args, { log, env = process.env, cwd = process.cwd() }) {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32' });
  let finished = false;
  const done = new Promise(resolveDone => {
    child.once('error', error => resolveDone({ code: null, error: error.message }));
    child.once('close', (code, signal) => resolveDone({ code, signal }));
  }).then(result => { finished = true; closeSync(fd); return result; });
  function kill(signal) {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  return { child, done, get finished() { return finished; }, async stop() {
    // Kill only this owned process group, including descendants of test scripts.
    kill('SIGTERM');
    const timer = setTimeout(() => kill('SIGKILL'), 2000);
    await done;
    // The group may outlive its leader (e.g. a timed-out fixture builder).
    kill('SIGKILL');
    clearTimeout(timer);
  } };
}

export async function runCommand(command, args, options) {
  const process = startProcess(command, args, options);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void process.stop(); }, options.timeoutMs ?? 1_200_000);
  const abort = () => { void process.stop(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const result = await process.done;
    return { ...result, timedOut, aborted: options.signal?.aborted ?? false };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    await process.stop();
  }
}

export function findingsReport(summary, previous = '') {
  const issues = summary.results.filter(result => result.status !== 'passed');
  if (!issues.length) return previous.trim() ? previous : '';
  const lines = [
    `Test run ${summary.startedAt} (${summary.scope})`,
    `Revision: ${summary.revision}; worktree: ${summary.dirty ? 'dirty' : 'clean'}.`,
    `Artifacts: ${summary.directory}/summary.json`,
    '',
  ];
  for (const issue of issues) {
    lines.push(`- **${issue.status.toUpperCase()} ${issue.id}** (${issue.browser ?? 'local'})`,
      `  Reproduce: \`${issue.reproduce}\``,
      `  Expected: suite completes successfully. Actual: ${issue.reason?.replaceAll('\n', ' ').slice(0, 600) ?? 'did not complete'}`,
      `  Log: ${issue.log ?? 'see summary.json'}`);
  }
  return (previous.trim() ? `${previous.trimEnd()}\n\n` : '') + lines.join('\n') + '\n';
}
