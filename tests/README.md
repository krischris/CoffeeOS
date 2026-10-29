# Test harness

From the project root, use `uv run npm test` for the routine Safari suite, or
ask an agent to use `$coffeeos-tests` ([skill](../.agents/skills/coffeeos-tests/SKILL.md)). The runner
needs no implementation history. Follow root [AGENTS.md](../AGENTS.md) for the
two identities: implementers run focused checks and resolve `TESTS.md`; test
runners execute the full suite and report without fixing code.

The harness starts its own dev/production preview servers and Safari WebDriver.
When explicitly selected, it starts headless Firefox with unique local profiles.
Firefox and every non-Safari browser variant are strictly opt-in, including browser-specific Python
round trips. Local Node/Python checks still run by default.
It runs suites sequentially, logs each under `.cache/test-runs/<run>/`, saves an
incremental `summary.json`, and stops its owned processes afterward. Each suite has a 20-minute deadline. The
test-only coordination lock is `.cache/test-harness.lock`; its contents identify
the owner PID. A second harness refuses to run. Ports 5175, 5176 and 5177 must be
free for legacy fixtures; other endpoints use dynamically allocated local ports.
An occupied port is a blocker, not permission to stop somebody else's server.

Existing `.venv` and locked npm dependencies are reused. Bootstrap a missing
environment using the
[test-runner skill](../.agents/skills/coffeeos-tests/SKILL.md). For the independent
Python checks, run
`uv pip install -r tests/requirements.txt` in the existing environment. Install
Safari separately if absent; Firefox is needed only when explicitly selected.
Safari Remote Automation must already be enabled. `SAFARIDRIVER_BIN`/`FIREFOX_BIN`
override executable locations. The runner does not change the normal browser profile or enable system automation settings.

| Automated coverage | Environment |
| --- | --- |
| Build/type checks, harness tests, test inventory, Drive helper | Local Node |
| Dev/production main/helper isolation headers and relative `/CoffeeOS/` assets | Local HTTP |
| Startup, navigation, beans/brews, charts/editor layout, gestures, IO, persistence, failures, history scale, legacy text, worker recovery | Safari/IndexedDB; opt-in Firefox/OPFS (Firefox suites cover their supported interactions) |
| WebP/photo conversion, legacy photo migration, archive preview/merge/recovery and rollback | Both browsers/backends |
| Historical archive, ZIP/Parquet schemas, microseconds, binary64, nulls, photos, Python DEFLATE and malformed archives, candidate round trips | Python/PyArrow plus both browser backup suites |
| Mocked Drive adapter, authorization, restore/revision races, content fingerprints, diagnostics, removed recovery UI | Both browsers/backends |
| Production helper isolation/worker update, repository subpath startup/ownership; Safari navigation, writes and reload via built UI | Both browsers |
| Populated build replacement, exact records, old CSV/Parquet imports, failed upgrades/rollback, locks, editing/deletion | Both browsers; schema-v1, pre-WebP and previous committed `HEAD` |
| Real offline worker, cold startup, failed/corrupt/quota update, disconnected writes/backups | Both browsers; pinned pre-offline baseline |
| MVP IndexedDB fallback; dedicated reduced-motion swipe regressions | Opt-in Firefox; reduced-motion checks use a separate profile and no old build |
| Unique-photo STORE/DEFLATE backup stress | Routine backup suite in each selected browser |
| Coarse process RSS while running backup stress | Opt-in extended Desktop Safari run |

`tests/suites.mjs` defines the runnable entry points and variants. Legacy upgrade
revision `2ccf66cbf840e9455d54f8b31d57b4df944e3bf6`, pre-WebP revision
`3046c70175be042f50d15facda44a4c9191b95f9`, recent `HEAD`, and pre-offline
revision `6ec3ef8` are deliberate baselines. Keep these Git objects in the checkout;
missing history/dependency installations must fail visibly. If a change spans
several commits, add the applicable released baseline before handoff. Previous
and candidate dependencies remain isolated when lockfiles differ. See
[UPGRADES.md](UPGRADES.md) for fixture internals; do not bypass migration guards.
The harness removes inherited test-selection flags so environment variables cannot
silently change the selected profile. Browser/profiling opt-ins use CLI arguments;
required variants belong in the registry.

Compatibility and functional coverage have separate owners. Database smoke
entries keep their startup/UI/storage checks; shared layout, swipe, transaction,
history and worker helpers run only in the current-production owner:

| Entry point | Responsibility |
| --- | --- |
| `upgrade-{legacy,jpeg,recent}-<browser>` | Same-profile/origin migration, exact fields/photos/recoveries and fingerprints, old CSV/Parquet and archive round trips, failed migration/open preservation, ownership lock and short edit/write/delete/reload |
| `review-<browser>` | Current production `/CoffeeOS/` fixture: startup/worker failures and durable bytes, bean/session gestures/edit/delete/rollback, session bean filtering and refresh, backup UI/recovery, legacy text, transaction faults, history scale and runtime-worker recovery |
| `photos-<browser>` | Current production fixture: WebP migration rollback/retry and once-only conversion, photo compression and full photo workflows |
| `drive-<browser>` | Mocked Drive transfers, content/revision races, restore and recovery-view regressions, once per selected browser |
| `motion-firefox` | Only swipe assertions with native reduced-motion preference; explicitly select Firefox |
| `offline-<browser>` | Real generated production worker and disconnected cold startup/update/write/backup compatibility |

Current production fixtures add automation-only hooks under `.cache/`; none ship
in `dist/`. Their isolation-only worker supports injected network/startup faults.
The separate offline suites retain the real generated worker and upgrade checks.

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
uv run npm test -- --list                         # routine Safari matrix
uv run npm test -- --list --browser all --extended # every registered variant
uv run npm test -- --browser firefox               # opt-in Firefox + local checks
uv run npm test -- --browser all                   # opt-in both browsers
uv run npm test -- --extended                      # Safari + coarse RSS
uv run npm run test:inventory
uv run npm run test:harness
uv run npm test -- --only server-contracts
uv run npm test -- --only photos-safari,photos-firefox
```

`--only` is an explicit opt-in to its named suites (including Firefox or memory
profiling), includes declared prerequisites and starts required resources;
it writes ignored logs/summary and leaves `TESTS.md` unchanged. Existing
`test:safari`, `test:photos`, etc. remain available for focused development.
Photo/review checks build and serve their own current-production fixture on port
5175; other direct commands still need their documented servers/endpoints.
Browser-generated example archives now go to `.cache/backups/example-v4.coffeeos`, never tracked `docs/fixtures/`.
Managed runs set `TEST_BACKUP_DIR` to their unique artifact directory, preventing
stale optional Python/round-trip fixtures from contaminating another run.

`test:db` defaults to Safari too. Use `test:db:firefox` for the direct Firefox
database entry point, or the managed `--only db-firefox` equivalent.

Summaries record the selected profile and `optedOut` suites; excluded optional
coverage is never reported as passed or as a missing-browser blocker. `--extended`
adds profiling only and never enables Firefox.

Any failed, timed-out, interrupted or blocked selected automated check makes the
run exit nonzero. Non-focused runs add actionable findings to `TESTS.md`. Successful full runs
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
