# Upgrade verification

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

The test seeds the old build and exports its historical CSV/Parquet backups,
replaces the served build at the same origin and `/CoffeeOS/` path, updates a
service worker with changed script bytes, and checks exact records after reload.
It verifies old backups, new writes, failed startup recovery, stored byte digests,
lock exclusion, and the bean deletion regressions. Failure injection is confined
to automation fixtures. Safari currently selects IndexedDB; Firefox covers OPFS.
Service-worker replacement runs with host isolation headers; it is not proof of
GitHub Pages or physical iOS Home Screen behavior.

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
The photo checks cover resize, JPEG encoding, save/reset, expanded display,
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
