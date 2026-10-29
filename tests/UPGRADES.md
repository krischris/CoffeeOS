# Upgrade verification

The full test runner uses `uv run npm test` and manages prerequisites and
Safari automatically; Firefox requires `--browser firefox`, `--browser all` or
an explicit Firefox `--only` selection. See [the harness guide](README.md).
The commands below remain available for focused runs and fixture maintenance.

Start `safaridriver -p 4444`, then run `uv run npm run test:upgrade`.
For OPFS, start Firefox with an isolated profile containing `firefox-user.js`
and `--remote-debugging-port 9223`, then run
`uv run npm run test:upgrade:firefox`. Never use a normal browsing profile.
Run these suites sequentially: both serve port 5175 and rebuild the same fixtures.
The existing workflow suite runs with Vite on port 5173 using
`uv run npm run test:safari`.

The fixture builder archives immutable revision
`2ccf66cbf840e9455d54f8b31d57b4df944e3bf6`, including its public assets/config,
then builds current source. `TEST_PREVIOUS_REF` can select another supported
revision. Test-only database hooks stay in `.cache/bean-upgrade`, never `dist`.
Both versions use the installed dependencies only when their lockfile packages
match; a dependency upgrade deliberately fails this prerequisite and requires
separate old/candidate installations. Do not bypass that check.

The maintained matrix also pins pre-WebP revision
`3046c70175be042f50d15facda44a4c9191b95f9` (`upgrade-jpeg-safari` and
`upgrade-jpeg-firefox`) and selects `HEAD` for recent-build upgrades. Fixture
setup uses each previous build's public APIs: schema-v1 has no photo/recovery
support, historical whitespace/damaged-photo imports use explicit preservation
options, and overwriting a valid archive creates the prior immutable recovery.
Only the pre-WebP build must convert JPEGs and add a conversion recovery; recent
builds must preserve photo fields and content fingerprints without rerunning
the completed migration. All baselines retain linked whitespace records through
failed-startup probes and reimport both original CSV and Parquet exports.

The test seeds the old build and exports its historical CSV/Parquet backups,
replaces the served build at the same origin and `/CoffeeOS/` path, updates a
service worker with changed script bytes, and checks exact records after reload.
Each baseline verifies exact records, immutable recoveries, original CSV/Parquet,
archive round trips, failed migrations/opening, ownership locks and a short
edit/write/delete/reload check. Extensive bean/session editing/deletion, rollback,
gestures, history scale, startup/worker faults and backup controls run once per
selected browser in `review-<browser>` on the current production fixture.
`photos-<browser>` owns compression and WebP migration failure/retry checks.
`drive-<browser>` owns Drive restore/recovery checks. The opt-in `motion-firefox`
suite runs only swipe regressions with reduced motion; it never seeds an old build.
Safari's current functional run also checks edit-form phone geometry and saves a
screenshot in `.cache/`.
Failure injection is confined
to automation fixtures. Safari currently selects IndexedDB; Firefox covers OPFS.
Service-worker replacement runs with host isolation headers; it is not proof of
GitHub Pages or physical iOS Home Screen behavior.
The original fault-injection matrix serves the isolation-only worker template
for both previous and candidate builds, and asserts that policy before use;
its deliberately changing HTML/worker responses cannot be served from an
immutable offline shell. Stage 52's separate offline suite tests the actual
generated production worker and update lifecycle on a headerless host.

Stage 9 introduces schema v2: nullable `beans.photo_jpeg` stores a bounded JPEG
data URL. Existing identifiers and the pinned DuckDB runtime remain unchanged.
Before altering OPFS or subsequently writing restored IndexedDB records, startup
retains the original Parquet tables in the existing snapshot store under the new
`schema-v1-before-photos` recovery key. This key is never overwritten. The OPFS
ALTER runs in a transaction; both legacy and v2 schemas are accepted on startup.
Historical backups omit the optional field; imports retain existing photos for
those files, while v2 backups preserve explicit nulls and photo values.

Upgrade checks inject failure saving the recovery copy and (OPFS) after ALTER,
reopen the original build to compare all original records, then retry the upgrade.
The current-production photo checks cover resize, JPEG encoding, save/reset, expanded display,
all export/import variants, reload, invalid files, removal, and legacy imports.
Recovery archives are Parquet table pairs, suitable for the existing IO importer
once extracted from IndexedDB; there is no automatic destructive rollback UI.
Future migrations must preserve their own recovery copy and repeat these checks.

Metadata access is now required before opening any dataset. Older empty
IndexedDB installs that have a backend marker but no snapshot are conservatively
reported as missing storage: absence cannot distinguish an unused collection
from lost data. New first-use installs persist an empty snapshot before the
backend marker. No automatic reset or memory-only fallback is provided.

An origin change is outside this update. Before such a deployment, retain access
to the old origin, export and verify a backup there, import/verify on the new
origin, and retain the original until recovery has been confirmed. Browser
storage will not follow an origin change automatically.

Stage 22 adds fflate 0.8.3 for portable `.coffeeos` archives. The fixture builder
compares lockfiles: equal packages may share the installed toolchain; differing
packages install the previous lockfile with `npm ci --ignore-scripts` into the
old fixture and build it with that installation. Candidate sources use the
project's separately installed current dependencies. No equality guard is bypassed.
The current-production `/CoffeeOS/` functional suite additionally prepares an archive,
previews an overwrite without applying it, confirms the atomic merge, reloads,
and downloads/validates the additive pre-import recovery copy. Header assertions
cover COOP/COEP on this isolated host; deployment headers remain a separate check.

Focused archive checks: with Vite/Safari driver running,
`uv run npm run test:backups`. For OPFS use
`TEST_FIREFOX=1 uv run npm run test:backups` with the isolated Firefox endpoint.
`uv run python tests/backup-interoperability.py` requires PyArrow in the local
`.venv` and independently verifies the tracked `docs/fixtures/example-v4.coffeeos`.
Browser runs write candidate examples to `.cache/backups/example-v4.coffeeos`;
pass that path as the Python command's argument to verify the generated example.
It also creates a Python DEFLATE repack and malformed Parquet fixtures in
`.cache/backups`; the next browser run verifies these optional generated fixtures.
`uv run npm test -- --extended` adds `backup-memory-safari` to the routine suite;
`uv run npm test -- --only backup-memory-safari` runs just profiling. The sampler
(`tests/measure-backup-memory.mjs`) runs a unique-photo Safari fixture
and records coarse peak RSS for newly started Safari/WebKit processes. The
functional unique-photo/DEFLATE stress also runs in the routine backup suite. The
measurement includes shared/native process memory, not just archive buffers or
JavaScript heap, and does not establish a safe physical iPhone memory budget.

Stage 24 adds optional Drive backup and a helper-only isolation exception. For
the recent-build populated upgrade use `TEST_PREVIOUS_REF=abcddcd` with the same
Safari/Firefox upgrade commands. The harness detects whether the old fixture
actually needs the photo migration, preserves existing photos, and only injects
legacy migration failures when that migration applies. Startup diagnostics stay
in test fixtures. The original pinned legacy fixture remains the default.

With Vite and Safari WebDriver running, `uv run npm run test:drive` checks the
simulated GIS helper, shared in-app self-tests, mocked Drive transfer with actual
DuckDB empty recovery, revision/race guards, rollback, reload and normal
connection controls. Set `TEST_BASE_URL` if Vite uses a port other than 5173. Use `TEST_FIREFOX=1`
for the same OPFS checks in an isolated Firefox profile. These are not real
Google OAuth/transfer verification.

Stage 41 adds `uv run npm run test:drive:authorization` (or set `TEST_FIREFOX=1`)
for token reuse across actual reloads, unchanged expiry, account verification,
revocation/renewal, switch confirmation, cancellation and credential-storage
failures. Google is simulated, and the normal browser profile is never used.
The populated previous-build upgrade baseline for this update is
`TEST_PREVIOUS_REF=fa42a52`; run the Safari and Firefox upgrades sequentially.

After `uv run npm run build`, start
`uv run npm run preview -- --host 127.0.0.1 --port 4174 --base /CoffeeOS/` and run
`uv run node tests/drive-isolation.mjs`. Its isolated Safari session serves the
built app on port 5176 without host isolation headers, installs the previous
isolation worker, then verifies the helper can update that worker, retain its
one-time BroadcastChannel, and leave the database page isolated. It also checks
native production preview headers. Google is never loaded in that test.

Google configuration and the normal IO connection flow are documented in
`docs/google-drive-backups.md`. Live authorization, a real Drive round trip,
fresh-profile recovery and physical iOS/Home Screen checks remain separate gates.

Stage 27 extends the populated upgrade checks with database-worker error,
message-decoding failure and silent-instantiation cases. Use
`TEST_PREVIOUS_REF=f5babb8` to upgrade from the deployed Stage 24 build. Fixture
injection adds a worker URL query and shortens the 120-second deadline only in
automation; production identifiers/URLs remain unchanged. Each failure compares
durable storage hashes, checks the recoverable error and uses Reload to reopen
exact records. A separate simulated elapsed-time check verifies that pending
startup exposes read-only details after ten seconds. Document identifiers in the
fixture synchronize Reload before readiness checks; no automatic test retry
conceals an application startup error.


Stage 28 uses the registered public Google client and removes manual ID entry and
in-app test controls. `test:drive` loads its shared checks from
`tests/driveChecks.ts`; production does not import them. Real Google testing was
deferred at the user's request. Only `https://krischris.github.io` is authorized;
localhost regressions continue to mock OAuth and Drive. Populated upgrade checks
use `TEST_PREVIOUS_REF=a0a427d` for the preceding build.


Stage 47 uses `TEST_PREVIOUS_REF=35ab417` for both upgrade suites. The old build
seeds tab/newline-only fields and a linked session using its original public
import API, plus damaged photos. Historical CSV/Parquet, immutable recovery
payloads, exact fields and format 3 exports are checked after build replacement
and reload; whitespace records remain present through failed-startup probes.
Run the two backends sequentially. The new legacy-text checks also cover default
rejection, opt-in preservation, merge/empty recovery and recovery downloads.
Native Safari swipe checks explicitly activate the automation window and assert
feedback sampled during pointerdown dispatch; missing input gets its own failure.

Stage 52 adds `uv run npm run test:offline` and
`TEST_FIREFOX=1 uv run npm run test:offline`. Run them sequentially: they rebuild
the shared `.cache/bean-upgrade` fixtures and serve port 5177. Safari WebDriver
and the isolated Firefox endpoint must already be running. The previous revision
defaults to the pre-offline revision `6ec3ef8` and can be overridden with
`TEST_PREVIOUS_REF`.

These checks replace a populated previous production build at the same profile,
origin and `/CoffeeOS/` path. The candidate host has no isolation headers; the
real production worker must supply them. After installation, every origin
request is disconnected and actual tab close/reopen verifies cold startup,
UI brew saves, exact records/microseconds/photos/nulls/precision, old CSV/Parquet,
immutable recoveries and local backup creation/validation. Additional checks
cover failed storage startup, missing/corrupt/interrupted update downloads,
injected shell-cache quota failure, coherent cache repair, waiting updates with
drafts, scope-limited cleanup, the helper exception and a headerless first visit
on a second isolated localhost origin. Quota injection is not a real disk-full
capacity measurement. These desktop checks do not replace physical airplane-mode
and Home Screen/storage-eviction acceptance.
