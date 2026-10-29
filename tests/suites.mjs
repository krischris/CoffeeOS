// Existing entry points and variants. New *.test.mjs files need no registration.
// Keep execution serial: upgrade/offline suites share fixture paths and ports.
const node = (id, file, options = {}) => ({ id, file: `tests/${file}.mjs`, ...options });
const browsers = ['safari', 'firefox'];
const suites = [
  node('drive-helper', 'drive-auth-helper'),
  { id: 'python-fixture', file: 'tests/backup-interoperability.py', python: true },
  node('server-contracts', 'server-contracts', { resources: ['dev', 'preview'], depends: ['build'] }),
];
for (const browser of browsers) {
  const dev = { browser, resources: ['dev', browser] };
  suites.push(node(`db-${browser}`, browser === 'safari' ? 'db-safari' : 'db-browser', dev));
  suites.push(node(`production-${browser}`, browser === 'safari' ? 'db-safari' : 'db-browser', {
    browser, resources: ['preview', browser], depends: ['build'], env: { TEST_PRODUCTION: '1' },
  }));
  if (browser === 'firefox') suites.push(node('db-firefox-mvp', 'db-browser', { ...dev, env: { TEST_MVP: '1' } }));
  for (const [id, file] of [
    ['review', 'review-browser'], ['photos', 'photo-browser'], ['backups', 'backups-browser'],
    ['drive', 'drive-browser'], ['authorization', 'drive-authorization'], ['diagnostics', 'drive-diagnostics'],
  ]) suites.push(node(`${id}-${browser}`, file, { ...dev,
    ...(id === 'drive' ? { includes: ['tests/driveChecks.ts'] } : {}),
    ...(id === 'backups' ? { depends: ['python-fixture'] } : {}),
  }));
  suites.push({ id: `python-roundtrip-${browser}`, file: 'tests/backup-interoperability.py', python: true,
    args: ['$BACKUP_DIR/example-v4.coffeeos'], depends: [`backups-${browser}`] });
  suites.push(node(`isolation-${browser}`, 'drive-isolation', {
    browser, resources: ['preview', browser], depends: ['build'], port: 5176,
  }));
  // Preserve both the original schema migration and the immediately preceding build.
  for (const [baseline, ref] of [['legacy', '2ccf66cbf840e9455d54f8b31d57b4df944e3bf6'], ['recent', 'HEAD']]) {
    suites.push(node(`upgrade-${baseline}-${browser}`, 'bean-upgrade', {
      browser, resources: [browser], port: 5175, env: { TEST_PREVIOUS_REF: ref },
    }));
  }
  suites.push(node(`offline-${browser}`, 'offline-browser', {
    browser, resources: [browser], port: 5177, env: { TEST_PREVIOUS_REF: '6ec3ef8' },
  }));
}
suites.push(node('backup-memory-safari', 'measure-backup-memory', { browser: 'safari', resources: ['dev', 'safari'] }));
suites.push(node('upgrade-reduced-motion-firefox', 'bean-upgrade', {
  browser: 'firefox', resources: ['firefox-reduced'], port: 5175,
  env: { TEST_PREVIOUS_REF: 'HEAD', TEST_REDUCED_MOTION: '1' },
}));

export const registeredSuites = suites;
// Harness infrastructure and Firefox launch preferences are not assertion entry points.
export const supportFiles = ['tests/suites.mjs', 'tests/firefox-user.js'];
