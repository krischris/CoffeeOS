# Test harness

From the project root, use `uv run npm test` or ask an agent to use
`$coffeeos-tests` ([skill](../.agents/skills/coffeeos-tests/SKILL.md)). The runner
needs no implementation history. Follow root [AGENTS.md](../AGENTS.md) for the
two identities: implementers run focused checks and resolve `TESTS.md`; test
runners execute the full suite and report without fixing code.

The harness starts its own dev/production preview servers, Safari WebDriver and
headless Firefox with unique local profiles. It runs suites sequentially, logs
each under `.cache/test-runs/<run>/`, saves an incremental `summary.json`, and
stops its owned processes afterward. Each suite has a 20-minute deadline. The
test-only coordination lock is `.cache/test-harness.lock`; its contents identify
the owner PID. A second harness refuses to run. Ports 5175, 5176 and 5177 must be
free for legacy fixtures; other endpoints use dynamically allocated local ports.
An occupied port is a blocker, not permission to stop somebody else's server.

Existing `.venv` and locked npm dependencies are reused. Bootstrap a missing
environment using the
[test-runner skill](../.agents/skills/coffeeos-tests/SKILL.md). For the independent
Python checks, run
`uv pip install -r tests/requirements.txt` in the existing environment. Install
Safari/Firefox separately if absent; Safari Remote Automation must already be
enabled. `SAFARIDRIVER_BIN`/`FIREFOX_BIN` override executable locations. The runner
does not change the normal browser profile or enable system automation settings.

| Automated coverage | Environment |
| --- | --- |
| Build/type checks, harness tests, test inventory, Drive helper | Local Node |
| Dev/production main/helper isolation headers and relative `/CoffeeOS/` assets | Local HTTP |
| Startup, navigation, beans/brews, charts/editor layout, gestures, IO, persistence, failures, history scale, legacy text, worker recovery | Safari/IndexedDB; Firefox/OPFS (Firefox suites cover their supported interactions) |
| WebP/photo conversion, legacy photo migration, archive preview/merge/recovery and rollback | Both browsers/backends |
| Historical archive, ZIP/Parquet schemas, microseconds, binary64, nulls, photos, Python DEFLATE and malformed archives, candidate round trips | Python/PyArrow plus both browser backup suites |
| Mocked Drive adapter, authorization, restore/revision races, content fingerprints, diagnostics, removed recovery UI | Both browsers/backends |
| Production helper isolation/worker update, repository subpath startup/ownership; Safari navigation, writes and reload via built UI | Both browsers |
| Populated build replacement, exact records, old CSV/Parquet imports, failed upgrades/rollback, locks, editing/deletion | Both browsers; schema-v1, pre-WebP and previous committed `HEAD` |
| Real offline worker, cold startup, failed/corrupt/quota update, disconnected writes/backups | Both browsers; pinned pre-offline baseline |
| MVP IndexedDB fallback; reduced-motion swipe regressions | Firefox; reduced-motion recent upgrade uses a separate profile |
| Unique-photo backup stress and coarse process RSS | Desktop Safari |

`tests/suites.mjs` defines the runnable entry points and variants. Legacy upgrade
revision `2ccf66cbf840e9455d54f8b31d57b4df944e3bf6`, pre-WebP revision
`3046c70175be042f50d15facda44a4c9191b95f9`, recent `HEAD`, and pre-offline
revision `6ec3ef8` are deliberate baselines. Keep these Git objects in the checkout;
missing history/dependency installations must fail visibly. If a change spans
several commits, add the applicable released baseline before handoff. Previous
and candidate dependencies remain isolated when lockfiles differ. See
[UPGRADES.md](UPGRADES.md) for fixture internals; do not bypass migration guards.
The full harness removes inherited test-selection flags so a caller cannot
silently narrow its matrix. Required variants belong in the registry.

New dependency-free Node tests in `tests/**/*.test.mjs` are automatically included.
For other tests, add the entry point, resources and variants to `tests/suites.mjs`,
or import a shared regression helper from an existing registered suite. Use
`includes` to register browser-evaluated imports (for example `driveChecks.ts`).
Inventory follows real imports with Vite's installed Rolldown parser; every
`.mjs`, `.js`, `.ts` and `.py` under `tests/` must be reachable or explicitly
classified as infrastructure in `supportFiles`. Do not classify assertions as
infrastructure. New coverage must be executable rather than a one-off manual
script. For test kinds outside these extensions, extend inventory and register
the command as part of the implementation.

Useful focused commands:

```sh
uv run npm test -- --list
uv run npm run test:inventory
uv run npm run test:harness
uv run npm test -- --only server-contracts
uv run npm test -- --only photos-safari,photos-firefox
```

`--only` includes declared prerequisite suites and starts required resources;
it writes ignored logs/summary and leaves `TESTS.md` unchanged. Existing
`test:safari`, `test:photos`, etc. remain available for focused development with
their manually supplied servers/endpoints. Browser-generated example archives
now go to `.cache/backups/example-v4.coffeeos`, never tracked `docs/fixtures/`.
Full runs set `TEST_BACKUP_DIR` to their unique artifact directory, preventing
stale optional Python/round-trip fixtures from contaminating another run.

Any failed, timed-out, interrupted or blocked automated check makes the full run
exit nonzero and adds actionable findings to `TESTS.md`. Successful full runs
leave it zero-byte unless prior unresolved findings exist. Only implementers
resolve/remove findings after fixes and focused verification; neither a narrower
rerun nor a passing unrelated suite clears a finding. Detailed successful-run
evidence stays in the ignored summary, keeping the handoff small.
Skipped/todo assertions in automatically discovered Node tests are blocked
coverage and also make the full run nonzero.

Physical iPhone/iPad touch/keyboard/viewport, Home Screen/storage lifecycle,
deployed-host headers and live Google OAuth/Drive transfers are manual gates.
They appear as unverified in the summary and must not be claimed as passed by
desktop automation. No live Google calls or deployment occur in the harness.
