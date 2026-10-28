# CoffeeOS: Specification & Staged Execution Plan

## 0. Global Rules for All Agent Sessions (READ FIRST)

1. **Scope:** Execute only the requested stage, verify its gate, update its
   status and stop. Completed stages below describe the consolidated feature;
   their dated notes distinguish original work, later fixes and remaining gaps.
2. **Plan maintenance:** Put a bug's cause, corrected implementation requirements
   and regression acceptance criteria in the stage that introduced the feature.
   Add dated verification there. Record each future update with the next unused
   stage number as required by `AGENTS.md`; a repair entry can refer to its owning
   stage rather than repeat its specification. Never renumber or reuse stages.
   Stages absorbed by this compaction remain in the history map below.
3. **Toolchain:** Vanilla TypeScript + Vite, no application framework. Use the
   existing `.venv`, managed by `uv` + `nodeenv`; prefix every direct Node/npm/npx
   command with `uv run`. `process.execPath` must be inside this project's `.venv`.
   Run `uv run npm run build` after changes; it checks application/config types.
4. **Runtime and hosting:** Pin local DuckDB-Wasm/assets together. Preserve Vite
   `base: './'`, dev/preview COOP `same-origin` and COEP `require-corp`.
   Check relative assets at `/CoffeeOS/`; dev headers do not prove host isolation.
   The isolation service worker is not an offline cache. Keep the deployment
   origin stable; an origin change needs an explicit tested transfer/recovery plan.
5. **Data preservation:** Preserve IDs, bean/session relationships, units, dates,
   timestamp precision, null/empty distinctions, comments, photos and numeric
   precision. Historical CSV/Parquet backups remain readable. Use additive optional
   fields or explicit versioned migrations with immutable recovery copies.
   Never reset storage, replace unreadable data with empty tables, switch datasets
   on failure or overwrite snapshots during startup/deployment. Empty initialization
   requires confirmed first use. Stage 6 is mandatory for affected future updates.
6. **Mobile/browser checks:** Inputs/selects use 16px CSS text and controls have
   44px minimum targets, with the existing Stage 14 proportional-scale exception
   documented there. Safari is primary; isolated Firefox supplies additional OPFS
   coverage. Do not launch Chrome without explicit user authorization. Desktop
   geometry/synthetic pointers do not establish physical iOS, keyboard, Home Screen
   or storage-lifecycle behavior. Record tested environments and gaps explicitly.
7. **Extraction:** `extraction_pct = (yield_g * tds_pct) / dose_g`, where both TDS
   and extraction use percentage points. Round display only, never stored values.

### Consolidated stage history

This map preserves completed session numbers and outcomes. Requirements and dated
evidence now live with the owning stages, including fixes discovered after initial
acceptance. Earlier “pending” notes are superseded only by explicit later results;
completion/user acceptance does not imply every device or live-service path passed.

| Historical stage (all completed unless noted) | Owning stage(s) | Retained outcome |
| --- | --- | --- |
| Cross-stage bug review, 2026-10-25 | 2, 4, 5, 6 | Ownership/backend guards, committed-write warnings, date/number validation; memory-only fallback subsequently removed. |
| 8: Complete Upgrade Resilience Guards & Regression Coverage | 6 | 2026-10-26: safe startup and previous-build Safari/IndexedDB + Firefox/OPFS gates passed. |
| 10: Home Screen Bottom Navigation Layout | 1 | 2026-10-26: standalone layout corrected; physical iOS confirmation pending. |
| 12: Safari Automation Retry for Compact Brew Cards | 11 | 2026-10-26: Safari dev/production passed; intermittent fixture failure retained. |
| 13: Contain Bean Date Fields on Narrow iPhone Layouts | 3 | 2026-10-26: native date sizing constrained; desktop Safari geometry passed. |
| 17: Compact Brew Editor Header and Larger Chart | 14, 15 | 2026-10-26: header/date access, larger chart, aligned actions; disclosure later replaced. |
| 18: Direct Header Date Picker and Aligned Tasting Notes | 14, 15 | 2026-10-26: native header picker and aligned Grind/notes passed Safari. |
| 19: Larger Brew Graph with Tighter Measurement Spacing | 14 | 2026-10-27: 20% chart increase verified; fixed heights later superseded. |
| 20: Proportional Session Editor Fit | 14 | 2026-10-27: shared 80–100% scale and scrolling fallback passed Safari. |
| 23: Raise Portable Backup Size Limit to 1 GB | 22 | 2026-10-27: configuration/build passed; no 1 GB memory test. Later caps removed. |
| 26: Temporary In-App Drive Diagnostics for Personal Device Testing | 24 | 2026-10-27: simulated tests/rollback-only round trip passed; panel retired in 28. |
| 27: Recoverable Database Worker Startup and Loading Diagnostics | 2, 6 | 2026-10-27: worker-hang recovery/upgrade tests passed; user confirmed deployed fix. |
| 28: Registered Google Drive Connection and Remove Temporary Test UI | 24 | 2026-10-27: public client integrated, temporary panel removed, upgrade checks passed. |
| 29: Stable Session Editor While the Keyboard Is Open | 14, 22, 25 | 2026-10-27: simulated keyboard geometry passed; archive/Drive collection caps removed. |
| 31: Crawler-Readable Homepage | 30 | 2026-10-27: script-independent homepage/policy and populated upgrades passed. |
| 33: Implement Stage 25 Drive History, Transfers and Recovery | 25 | 2026-10-27: full workflow implemented; later live failure fixed in 35. |
| 34: Opt-In Live Drive Failure Diagnostics | 24, 25 | 2026-10-27: sanitized diagnostics passed; root cause subsequently fixed in 35. |
| 35: Correct Native Fetch Receiver in Drive Requests | 24, 25 | 2026-10-27: native transport fix, three-browser adapter checks and real Google upload/download passed. |
| 36: Record Acceptance of Drive Backup Stages | 24, 25 | 2026-10-27: user accepted 24/25/33; no additional test coverage implied. |
| 37: Dismiss Swipe Actions Before Opening Cards | 7, 16, 32 | 2026-10-27: tap/reverse-swipe dismissal and Safari populated upgrade passed. |

## Stage 1: Toolchain, Vite Scaffold & PWA 3-Tab Shell

- [x] **Status:** Complete; desktop checks passed, physical Home Screen checks pending.

### Goal

Provide the project-local toolchain and a mobile dark shell with Brew Controller,
Bean Manager and IO, deployed with relative PWA assets and database isolation.

### Tasks

1. Bootstrap only when `.venv` is absent: `uv venv`, `uv pip install nodeenv`,
   `uv run nodeenv -p --node=lts`, then `uv run npm ci` for a locked checkout.
   Keep TypeScript/Vite in devDependencies and caches/generated files untracked.
2. Configure strict TypeScript, Vite relative base and both dev/preview isolation
   headers. Load the local `coi-serviceworker.js`; retain its license and Safari
   compatibility retry for bodyless conditional 304 responses without validators.
3. Supply relative manifest/start URL, icons, standalone iOS metadata and
   `viewport-fit=cover`. Default to Brew Controller; tabs switch cleanly.
4. Share navy surfaces, light text, peach accents, visible borders/focus and
   dark native controls across every view and feedback state. Align theme/PWA
   background with `#0e1222` and use dark-compatible iOS status-bar metadata.
5. In standalone mode use the existing `100vh` workaround for WebKit viewport
   under-sizing, navigation as the last non-shrinking flex row and scrollable
   content above it. Retain home-indicator padding without duplicate overlay space.

### Acceptance Criteria (Stage 1 Gate)

- Type checks/build pass; default view, all tabs, keyboard navigation and scrolling
  work at phone/desktop widths without overflow or content hidden beneath tabs.
- Dark palette, native color scheme, focus and readable loading/error states are
  consistent. Controls retain mobile sizing except the documented editor scale.
- Test standalone geometry at 390×844 and 844×500 with 0/34px bottom padding:
  navigation ends at the shell bottom and content ends above navigation.
- Dev/preview headers pass. On a plain static repository-subpath host, relative
  assets load, worker isolation activates and cached-worker reload does not stall.
- Record actual host and physical iOS/Home Screen results independently; CSS
  simulation cannot close the native toolbar/safe-area acceptance gap.

### Verification — 2026-10-25–26

- Builds/type checks and initial shell/navigation checks passed (historical Chrome
  run); later Safari 27/macOS dev/production `/CoffeeOS/` suites verified theme,
  navigation, narrow layout, forms and reloads. Plain static subpath tests verified
  service-worker isolation/local assets; Safari cached-worker 304 retry passed.
- Dark-theme follow-up recorded 2026-10-26, with checks performed 2026-10-25.
  Stage 10's 2026-10-26 desktop Safari simulation passed both standalone sizes and
  padding variants without overflow. Dev/preview isolation headers passed.
- Physical iPhone/iPad installation, toolbar-gap resolution, rotation, safe-area
  reporting and deployed-host behavior were not established by these local checks.

## Stage 2: Database Layer & Schema (`src/db.ts`)

- [x] **Status:** Complete; local persistence/startup recovery passed, user confirmed deployed startup fix.

### Goal

Expose typed, serialized DuckDB CRUD with durable storage, bounded runtime loading
and recoverable failures that preserve the original collection.

### Tasks

1. Use pinned `@duckdb/duckdb-wasm`, local Vite-managed worker/Wasm/signed Parquet
   extension assets; disable automatic external extension downloads. Check the
   installed API, request persistent storage and close connections/workers on exit.
2. Preserve `Bean`/`BrewSession` fields in `src/types.ts`: string IDs/relationships,
   nullable date-only roast/freeze fields, creation/brew timestamps, nullable
   dose/water/yield grams, temperature °C, grind µm, TDS/EY percentage points,
   duration text and comment. Stage 9 adds optional nullable JPEG photos.
3. Register the physical `opfs://coffeos.db` handle with DuckDB alias `coffeos.db`.
   Use durable IndexedDB Parquet snapshots for the compatible runtime/backend.
   Selection/open/restore must obey Stage 6: no competing engine, dataset switch
   or memory-only fallback when access fails. Schema setup is idempotent.
4. Serialize `initDB`, bean/session reads and writes; parameter-bind values,
   join bean names, order descending by creation/brew date and filter sessions
   by bean when requested. Validate dates in years 0001–9999 and finite numbers.
5. Coordinate SQL transactions with atomic snapshots/CHECKPOINT. Pre-commit
   failures roll back; after-commit flush failures report that the change exists,
   refresh views and offer backup guidance rather than invite duplicate retries.
   Cleanup must not mask a committed result or the original error.
6. Reject worker `error`/`messageerror` during instantiation; the pinned worker
   otherwise clears pending requests without rejecting them. Use a 120-second
   inactivity deadline reset by real loading progress, terminating failed workers
   before persistent-file registration/open. Do not time out an active restore.
7. Show loading phase and read-only/copyable environment/resource details after
   ten seconds or failure, with Reload and a recoverable error. Never include
   collection contents. Release database ownership on initialization failure.

### Acceptance Criteria (Stage 2 Gate)

- Build and CRUD checks pass: binding, joins/filter/order, concurrent init/writes,
  nulls/zeroes, UTC timestamps, invalid dates/nonfinite numbers and reload.
- Only one engine owns the origin. Competing tabs fail recoverably and can open
  the original collection after ownership releases; they never open a fallback DB.
- Inject failed snapshot writes, corrupt Parquet and post-commit flush errors;
  check exact durable data/drafts, rollback versus committed warnings and retry.
- Missing worker, decode error and silent instantiation exit loading recoverably;
  slow progress resets the deadline. Compare durable bytes/backend before and
  after failure; Reload recovers exact records without a reset or backend change.
- Apply Stage 6's populated previous-build checks on both backends. Verify local
  assets/isolation/subpath and distinguish physical/deployed results from localhost.

### Verification — 2026-10-25

- Type checks/build, Firefox EH/OPFS and forced MVP/IndexedDB CRUD/persistence,
  corrupt-snapshot/write rollback and lifecycle suites passed. Safari 27/macOS
  startup, writes, joins, nulls, reload and static-subpath isolation passed.
- Cross-stage review added lifetime Web Lock, sticky backend, finite/date validation
  and committed-write warnings; Safari/Firefox regressions passed. Earlier accepted
  independent second-tab writes, lock-triggered fallback and memory-only storage
  are superseded by these guards and Stage 6; they are not supported behavior.

### Verification — 2026-10-27 (absorbed Stage 27)

- Eight Vite reloads and twelve production-mirror starts passed before the fix;
  they did not reproduce the user's precise Home Screen trigger. A missing-worker
  fixture reproduced the pinned runtime's indefinite loading path. Worker error,
  messageerror and inactivity handling fixed that path without storage mutation.
- Full Safari 27.2 suite/build/diff passed. Populated upgrades from `f5babb8`
  passed Safari/IndexedDB and Firefox/OPFS: all three worker failures preserved
  durable hashes and exact data, then Reload recovered; old backups still imported.
  Only fixtures shorten the timeout. Firefox verified simulated slow-start details;
  that final clock-based assertion was not rerun on Safari. Twelve corrected
  production-mirror starts passed. A transient Parquet NetworkError did not recur.
- Public deployed runtime assets were reachable with correct types; Pages had
  no native isolation headers and a ten-minute HTTP cache. User confirmed the
  deployed fix worked, without device/version details. Precise original device
  trigger and a full physical iOS/Home Screen lifecycle matrix remain unverified.

### Follow-up Verification — 2026-10-28

- R1 ordinary writes and imports now coordinate SQL/IndexedDB publication; see
  the Stage 44 failure matrix and populated upgrade evidence.

## Stage 3: Bean Manager Tab (`src/views/beanManager.ts`)

- [x] **Status:** Complete; desktop Safari passed, physical iOS date-control checks pending.

### Goal

Create beans and display each bean's complete, correctly associated brew history.

### Tasks

1. Provide required nonblank Name and optional native Roast/Freeze date inputs.
   Save through `addBean`, reset after success, refresh the list and prevent double
   submits. Rollback retains the draft/list; committed warnings follow Stage 2.
2. Render names/dates and all sessions descending by brew date: full timestamp,
   every input/result metric and comment. Use safe text rendering, preserving
   multiline text, zero/null distinctions and empty-history feedback.
3. Constrain native date appearance, border-box width, internal value minimum
   height and alignment so padded iOS date inputs cannot exceed their grid cell.
   Keep native date semantics; later compact/edit workflows are in Stages 21/32.

### Acceptance Criteria (Stage 3 Gate)

- Name-only/dated beans save once, reset and persist after reload; blank/whitespace
  names fail. Inject a storage failure, retain the entered values and retry once.
- Histories contain only the selected bean's sessions in correct order, render
  markup-like text safely, refresh on tab entry and retain all fields after reload.
- Measure actual field bounds with empty/populated dates at 320, 375, 390, 393,
  420, 430 and 852px: dates match Name in a single column and fit both desktop
  grid cells. No horizontal overflow; native type/date values, 16px text/44px height
  remain. macOS success does not rule out the iOS-specific sizing defect.
- Build/Safari regressions and production-subpath/isolation checks pass; record
  physical iPhone/iPad date picker, keyboard and Home Screen checks separately.

### Verification — 2026-10-25–26 (includes Stage 13)

- Safari 27/macOS passed creation/validation/reset/double-submit, safe complete
  histories, storage-failure retry, reload and production static-subpath workflows.
- Date sizing issue was not reproduced on macOS; WebKit issue 301648 identified
  the iOS padded-width risk. Scoped constraints added; dev/production exact-width
  checks passed all seven widths, empty/populated, including two-column layouts.
  At 393px, fields measured 327px within a 361px card; native semantics retained.
- Build, full Safari regression suite and dev/preview headers passed. Physical
  iOS/date-picker and deployed-host checks remain unverified by these runs.

### Follow-up Verification — 2026-10-28

- R7 collapsed bean rows fetch counts; opened histories use 50-session pages.
  Hidden views refresh on entry. See Stage 44 measurements and Safari
  interaction checks.

## Stage 4: Brew Controller & Live Extraction Chart

- [x] **Status:** Complete; desktop Safari workflows passed, physical iOS pending.

### Goal

Show the chronological brew feed and create sessions with live extraction and a
responsive brewing-control chart. Stages 14–16 own the later editor/edit/delete UI.

### Tasks

1. Default to a feed ordered by `brewed_at DESC`, showing bean name, timestamp,
   input/result values and comment. New Session opens a cancellable labeled form.
2. Require an existing bean; if none exist, link to the bean form. Preserve drafts
   while refreshing bean choices across tabs. Accept optional dose, water, time,
   temperature, grind, comment, yield and TDS with appropriate decimal input modes.
3. Recompute EY on dose/yield/TDS input: valid positive operands display two
   decimals; missing/zero/negative operands display `—`. Store full precision.
4. Draw extraction X=14–26%, TDS Y=0.95–1.75%, grid, shaded nine-region quality
   labels, live result marker and dashed guides. Provide readable accessible
   region/result text, invalid/empty state and explicit off-scale feedback.
5. Save once through the serialized DB path, refresh both feed and bean histories,
   reset/cancel cleanly and restore focus. On rollback keep the draft/chart;
   on a committed warning exit the draft and show the saved result/backup guidance.

### Acceptance Criteria (Stage 4 Gate)

- Required bean, no-beans navigation, optional/zero/null fields, ordering, safe
  text rendering, cancel/focus and cross-tab draft retention pass in Safari.
- Test formula/display versus exact saved numbers, every chart region, endpoints,
  off-scale values, invalid inputs, live guides and cancel/reset clearing.
- Save updates both views immediately and persists. Repeated submits insert once;
  inject rollback and committed-flush failures and verify distinct retry behavior.
- Build, phone layout/control sizes, production `/CoffeeOS/` workflows and
  isolation headers pass; physical keyboard/touch/Home Screen gaps are explicit.

### Verification — 2026-10-25

- Build and Safari 27/macOS dev/plain-static production suites passed all creation,
  formula, chart-region/range/accessibility, duplicate-submit, rollback/retry,
  safe-text, draft/cancel and immediate-history/reload checks. Safari select
  appearance was adjusted to honor 44px height. No overflow at 390px.
- Service-worker isolation, local assets and dev/preview headers passed. Physical
  iPhone/iPad, native keyboard, Home Screen and actual host checks remain open.

### Follow-up Verification — 2026-10-28

- R5 session drafts check the original record atomically; R7 hidden Bean Manager
  work is deferred after saves. See Stage 44 precision/conflict and interaction
  checks.

## Stage 5: Historical CSV/Parquet IO & Deployment

- [x] **Status:** Complete; legacy compatibility retained, normal UI superseded by Stage 22.

### Goal

Preserve interoperable legacy backups and a reproducible GitHub Pages deployment.

### Tasks

1. Maintain combined/separate CSV and Parquet readers/export fidelity in the data
   layer. Keep beans without sessions and empty tables. Normal file UI now uses
   Stage 22's `.coffeeos` archive; expose historical imports through its legacy path.
2. Stage imports with fixed SQL identifiers; validate complete input before atomic
   upsert by ID. Do not rely on automatic CSV inference or blind replacement to
   preserve relationships, null markers, dates, precision and optional fields.
3. Retain selections on rollback and make cleanup unable to mask success/errors.
   Report applied counts, refresh both histories and distinguish committed warnings.
4. Prepare downloads and use a separate user-activated Share action, with download
   fallback. Deploy `dist/` via Pages Actions on main/manual runs with Node LTS,
   locked dependencies and separate build/deploy jobs; preserve origin/storage.

### Acceptance Criteria (Stage 5 Gate)

- All four combined/separate CSV/Parquet variants round-trip exact logical data,
  including empty collections, beans without sessions, reordered columns, IDs,
  joins, timestamps, precision, null/empty/literal-null-marker values and Unicode.
- Repeated imports are idempotent; referenced-bean updates/session moves work.
  Invalid schemas/duplicate IDs/orphans/nonfinite numbers/invalid dates or corrupt
  Parquet fail atomically. Date range is 0001–9999. Failure retains files for retry.
- Test second-table/snapshot rollback and committed-warning cleanup semantics;
  Share success/cancel/error fallback must not lose prepared downloads.
- Build/workflow validation and Safari subpath/isolation checks pass. Hosting,
  physical Files/Share and Stage 6 deployment upgrades require separate evidence.

### Verification — 2026-10-25

- Type checks/build, workflow YAML and Safari 27/macOS full IO suite passed:
  four variants including empty fixtures, exact values, idempotence, invalid-batch
  rejection, storage rollback, retry and mocked Share. Date/number validation and
  cleanup/committed-warning fixes passed the cross-stage Safari/Firefox review.
- Production plain-static subpath/service-worker isolation and reload passed;
  dev/preview headers checked. Historical memory-only test fixtures predate Stage
  6's durable-only startup policy and do not authorize application memory fallback.
- No GitHub Actions deployment, physical Files/Share or host acceptance was
  established by this stage. Stage 22 replaces ordinary CSV/Parquet export controls.

### Follow-up Verification — 2026-10-28

- R1 legacy CSV/Parquet imports share coordinated commit handling. R6 damaged
  historical photos have an explicit preservation option. See Stage 44 old-file
  and failed-commit checks.

## Stage 6: Upgrade Compatibility & Persistent Data Protection

- [x] **Status:** Complete for implemented local gates; platform/deployment limits remain.

### Goal

Make upgrades, startup and failures preserve the same exact recoverable collection.

### Tasks

1. Keep `coffeos.db` / `coffeos.db.wal`, IndexedDB `coffeos-snapshots`, store
   `snapshots`, keys `tables-v1` / `backend-v1` and lock `coffeos-database` stable.
   Never derive identities from build/version/URLs. Preserve all data contracts
   in the global rules; schema/format changes need explicit versioned migrations.
2. Acquire a lifetime ownership lock and read required backend metadata before
   opening data. Preserve the selected durable backend. Reject denied metadata,
   unknown markers/schemas, invalid snapshot envelopes, corrupt Parquet, missing
   remembered files/snapshots and ambiguous/inaccessible legacy OPFS.
3. Inspect existing files before creation. Confirm first use before initializing;
   new IndexedDB storage saves the empty snapshot before its backend marker.
   A marker with a missing snapshot is a recovery error, even if it might be an
   older unused install. Never silently switch backends, auto-merge historical
   split datasets or offer an empty memory-only replacement.
4. Preserve originals and immutable pre-migration copies; make migration/retry
   atomic/idempotent. Unsupported/newer formats fail without mutation. Include
   interruption, rollback and original-build reopening in migration coverage.
5. Follow `tests/UPGRADES.md`: seed an immutable previous build, export old backups,
   replace with candidate at the same isolated profile/origin and `/CoffeeOS/`,
   update worker bytes, reload repeatedly, compare every field and add new records.
   Exercise IndexedDB and OPFS separately; run shared-port suites sequentially.
6. If lockfile packages differ, install/build old and candidate fixtures separately;
   never bypass dependency guards. Keep test hooks in `.cache`, outside `dist`.
   Extend failure injections for each new dependency/schema/startup/worker change.

### Acceptance Criteria (Stage 6 Gate)

- `test:upgrade` (Safari/IndexedDB) and `test:upgrade:firefox` (isolated Firefox/OPFS)
  retain every exact field/relationship after previous-build replacement/startup/
  reload. Historical CSV/Parquet imports stay idempotent; new writes survive too.
- Inject metadata denial/unknown backend/schema, missing remembered data, corrupt
  snapshots/Parquet, interrupted restore, lost isolation/OPFS permission and lock
  contention. Compare durable byte hashes; fail recoverably with no active empty
  database and recover original records after access returns.
- Apply Stage 2 worker error/decode/timeout failures before persistent open; release
  ownership and verify Reload, with no dataset switch or empty snapshot overwrite.
- For each migration test recovery-copy failure, interruption after schema DDL,
  rollback, old-build reopening and successful retry without replacing recovery.
- Build and relative assets/isolation pass. Record prior commit, browser/backend,
  fixture contents, failure results and unverified paths in each affected update.
  Same-build reload/fresh DB tests alone never establish upgrade safety.
- No deployment/worker/cache path clears storage; any planned identity/origin move
  has a verified migration/transfer and access to the original until recovery passes.

### Verification — 2026-10-26 (includes Stage 8)

- Initial Stage 6 was requirements-only; Stage 8 completed the guards and harness.
  Added `test:upgrade` / `test:upgrade:firefox`, immutable default fixture `2ccf66c`
  and instructions in `tests/UPGRADES.md`. No storage/format identity changed.
- Both populated suites passed same-profile/origin build replacement, changed
  worker, exact comparisons, old backups, new writes/reloads and the failure
  matrix above. Metadata/backend/schema failures preserved durable byte hashes;
  IndexedDB additionally covered corrupt/missing/invalid/interrupted snapshots;
  OPFS covered isolation/directory/file access. Locks rejected competing startup.
- Full Safari and Firefox DB regressions, build/script syntax/diff and local
  headers passed. Automatic memory-only fallback removed. No migration introduced
  here; Stage 9 supplies actual schema-migration rollback evidence.

### Verification — 2026-10-27 (later upgrade evidence)

- Stage 27 upgrades from `f5babb8` passed worker-failure preservation on both
  backends (see Stage 2). Subsequent feature notes record recent-build fixtures,
  including `abcddcd`, `a0a427d`, `27e039b`, `4d31002` and `0fb9a4d`.
- Safari OPFS, DuckDB-version upgrade fixtures, physical iOS/Home Screen
  lifecycle and actual hosted build replacement/headers remain unverified.
  Local worker replacement uses host isolation headers; it is not live Pages
  upgrade proof. Future migrations/dependency/origin changes need their own tests.

### Follow-up Verification — 2026-10-28

- Stage 44 repeats populated previous-build IndexedDB/OPFS upgrades, old-file
  imports and failed-startup preservation; collection storage identities remain
  unchanged.

## Stage 7: Collapsible Bean Entries & Swipe-to-Delete

- [x] **Status:** Complete; local gestures/deletion/upgrades passed, physical touch pending.

### Goal

Keep bean histories compact and provide deliberate, recoverable bean deletion.

### Tasks

1. Use accessible details/summary: name, defined dates and session count initially;
   summary tap/keyboard toggles history. Stage 21 adds pinned inspection.
2. Left swipe reveals Delete; reserve vertical/short/cancelled gestures for normal
   interaction, suppress the swipe-generated click, provide actions menu/Escape.
3. While actions are visible, consume a deliberate surface tap only to close them;
   do not expand/collapse history. Reverse swipe closes the current action first.
   Stage 32 adds Edit on the opposite side; crossing requires a subsequent swipe.
4. Delete the bean and linked sessions atomically, preserving unrelated records.
   The pinned DuckDB's eager FK index requires the existing retained-session-table
   swap with identical constraints inside the transaction, not naive child/parent
   DELETE. Guard duplicate submits and preserve rollback/committed warnings.

### Acceptance Criteria (Stage 7 Gate)

- Initially hidden history/empty message, independent summary toggles, expanded
  state and keyboard actions pass. Swipes never activate a card or delete data.
- Test fresh pointer-down/up taps separately from swipe-generated clicks: a tap
  closes Delete/Edit without toggling even inside expanded history; next tap works.
- Test Edit→closed→Delete and Delete→closed→Edit. One reverse swipe reveals neither
  action; the next may reveal the other. Menu dismissal and buttons still work.
- Explicit deletion affects exactly one bean/all its sessions, refreshes both
  views and survives reload. Inject table-swap and snapshot failures; exact original
  records survive rollback/reopen, retry deletes once, unrelated data stays exact.
- Build/Safari/subpath/isolation and Stage 6 upgrades pass; non-writing gestures
  preserve exact records/reload. Report synthetic versus physical coverage.

### Verification — 2026-10-26–27 (includes Stage 37)

- Initial build/full Safari and populated `2ccf66c` Safari/IndexedDB + Firefox/OPFS
  suites passed collapse, synthetic gestures, scoped deletion, table-swap/snapshot
  rollback, retry and reload, with unchanged identities/formats.
- 2026-10-27 Safari 27.2 full suite and populated `TEST_PREVIOUS_REF=HEAD`
  upgrade passed fresh-tap dismissal, both close-before-opposite transitions,
  expanded-history/menu dismissal, next-tap activation and exact non-writing data.
  Build/diff, local headers and all eight production resources passed.
- Stage 37 did not rerun Firefox/OPFS. Physical touch/scroll arbitration, screen
  reader operation, Home Screen lifecycle, Safari OPFS and deployed host remain open.

### Follow-up Verification — 2026-10-28

- R1 cascading deletes share coordinated commit handling; R3 committed deletion
  alerts are outside the editor/rows; R7 histories load on demand. See Stage 44
  regressions.

## Stage 9: Optional Compressed Bean Photos

- [x] **Status:** Complete; local photo/migration gates passed, physical device pending.

### Goal

Add optional bean photos with a recoverable additive migration and old-backup fidelity.

### Tasks

1. Offer native image picker, preview/remove; resize longest edge to 1600px,
   JPEG quality 80% (65%/50% fallback), data URL ≤2 MB. Reject unreadable images,
   block submission during preparation and keep failed drafts for retry.
2. Add nullable `photo_jpeg` through schema v2. Save immutable original Parquet at
   `schema-v1-before-photos` before OPFS ALTER or first later IndexedDB writes.
   Transfer copies into the worker so recovery buffers cannot become detached.
3. Keep storage identities and legacy headers readable. Missing historical photo
   columns retain existing photos; explicit nulls in new backups mean removal.

### Acceptance Criteria (Stage 9 Gate)

- Save with/without photo, preview/remove/reset/error and expanded rendering pass;
  a 2400×1800 PNG becomes a 1600×1200 JPEG. Invalid decode never changes records.
- All four historical CSV/Parquet variants and `.coffeeos` preserve photos/exact
  records; legacy merges without the column retain saved photos.
- Populated v1→v2 OPFS/IndexedDB upgrades retain exact data. Inject recovery-copy
  failure and failure after ALTER before commit; old build reopens original data,
  retry/reload succeeds, immutable recovery stays intact with non-detached bytes.
- Build/Safari/subpath/isolation checks pass; record device image-format/lifecycle gaps.

### Verification — 2026-10-26

- Safari caught detached snapshot buffers before recovery-save; restore now
  transfers a copy. Full Safari/build/diff and Safari/IndexedDB + Firefox/OPFS
  populated upgrade suites passed, including post-ALTER rollback/old-build reopen.
- Resize/save/reset/display, four backup variants/reload and invalid decode passed;
  Firefox also checked removal and legacy photo retention. Local headers/subpath
  assets passed; runtime/dependencies/storage names remained stable.
- Physical camera/library, HEIC/orientation, Home Screen lifecycle, Safari OPFS
  and deployed-host checks remain unverified; unsupported images fail recoverably.

### Follow-up Verification — 2026-10-28

- R6 new photos use consistent encoding/marker checks. Previously accepted
  damaged photo bytes survive upgrade and explicit legacy import; compatibility
  archives use format 2. See Stage 44.

## Stage 11: Compact Mobile Brew Cards & Saved Charts

- [x] **Status:** Complete; Safari retry passed. Feed disclosure later superseded by Stage 15 direct editing.

### Goal

Provide a compact date/bean/EY feed and saved-brew chart access on phone widths.

### Tasks

1. Keep collapsed summaries readable, wrap long bean names, show missing EY as a
   dash and full details/chart on access. Original lazy disclosure charts are
   historical; direct editor opening in Stage 15 is the current feed interaction.
2. Preserve null/missing/out-of-range chart feedback, safe areas and compact spacing.
3. Verify installed Safari dev/production; investigate automation failures and
   report partial runs without equating a Firefox pass to Safari acceptance.

### Acceptance Criteria (Stage 11 Gate)

- Compact summaries, dates/bean names/EY and long-name wrapping fit 393px; saved
  charts retain exact coordinates, invalid/empty text and range feedback.
- Original disclosure toggle/lazy chart checks are historical evidence; current
  card activation must satisfy Stage 15, never reintroduce disclosure accidentally.
- Full Safari dev/production, build and local headers pass; distinguish transient
  fixture failures from diagnosed application bugs and retain unresolved limits.

### Verification — 2026-10-26 (includes Stage 12)

- Initial Safari session creation timed out; Firefox production UI passed, while
  dev stopped at an unsupported multi-window command. No Safari pass then claimed.
- Retry connected Safari 27/macOS: full dev and production `/CoffeeOS/` suites
  passed UI, cards/charts, writes/reloads and historical IO. Initial dev empty-engine
  fixture failed with an OPFS/isolation recovery error; diagnostic and unchanged
  reruns passed. Cause unconfirmed; no application fix claimed.
- Build/diff and headers passed. Physical iOS/Home Screen, hosted behavior and
  previous-build upgrade paths were not established by this presentation rerun.

### Follow-up Verification — 2026-10-28

- Stage 44 preserves brew card editing/swipes and defers hidden Bean Manager
  work. Session drafts reject imported record changes atomically.

## Stage 14: Single-Page iPhone Brew Editor

- [x] **Status:** Complete; later Safari layout/keyboard simulations passed, physical iOS pending.

### Goal

Fit the graph and labeled measurements into a stable mobile editor with reachable
actions, including small screens, safe areas and software-keyboard viewport changes.

### Tasks

1. Hide shell branding/intro/tabs only while editing; restore on exit. Place chart
   above bean selection and two input/output columns; labels focus native inputs.
2. Put the native datetime control over the visible edit-header timestamp, with
   accessible name/focus indication. No extra Brewed row or layout shift. Align
   Grind and Tasting notes in matching rows; keep accessible chart descriptions
   while visually hiding the redundant caption. Stage 15 owns edit semantics.
3. Use shared proportional scale from width/height and safe areas, reference
   393×759 usable viewport and minimum 80%. Give spare height to the chart;
   scrolling body and persistent action row prevent gaps or covered final fields.
   This supersedes historical fixed 160/220/240/264/288px chart heights.
4. Preserve 16px computed input font and 44px unscaled controls. Existing shared
   scaling can reduce visual targets to 35.2px; retain this explicit limitation
   rather than claim universal 44px visual sizing or physical no-zoom verification.
5. Before native input UI opens, capture height/scale/chart/safe-area geometry.
   Hold it through keyboard shrink and focus transfer; add covered-area scroll
   space instead of compressing the editor. Release stale sizing on exit, recovered
   blur/viewport, width/orientation change and cancel/reopen, without losing drafts.
6. Keep recoverable save errors visible and scroll-reachable; retain chart/draft
   on rollback. Do not add persistence or format changes for layout refinements.

### Acceptance Criteria (Stage 14 Gate)

- Actual DOM/CSS frames at 320×568, 320×852, 375×667, 375×812, 393×680,
  393×852, 430×932 and 852×393 fit horizontally with/without simulated 59/34px
  safe areas. Normal 393×852 and 375×667 editors fit without scroll, keyboard closed.
- Chart fills spare height; only intentional padding remains above actions. At
  minimum scale/short heights, scroll reaches Comment above the pinned actions.
  Header/labels/fields/actions scale together; Grind/notes align within 1px.
- Timestamp hit testing targets the native control; no extra date row appears.
  Labels focus inputs and date changes update the header without shifting content.
- Focus then reduce frame/visual viewport by 300px: exact editor/graph/control
  dimensions and draft values stay stable. Covered fields scroll into view;
  field transfer, blur/dismissal, height/width resize and cancel/reopen clear stale
  captures appropriately. Also test native keyboard on physical iOS when available.
- Save/cancel/shell restoration, error/retry, reloads and existing IO regressions
  pass; build/local headers/production subpath remain valid. Record browser fallback
  and scaling/accessibility limitations rather than treating simulations as devices.

### Verification — 2026-10-26 (original editor; Stages 17–18)

- Initial Safari automation timed out. Firefox initial production suite and final
  targeted editor/failure/retry capture passed; final full repeat exited during
  IO reload, and dev stopped in a capability-loss fixture. No crash/storage fix
  or complete final Firefox rerun claimed. Exact-width frames fit; synthetic
  1179×2556 preview saved at `.cache/brew-editor-iphone-15-pro.png`, not a device image.
- Later Safari 27.2 dev/production suites passed header/date targeting, native
  picker overlay, Grind/notes alignment, fixed actions and safe-area geometry.
  Stage 17's timestamp disclosure was superseded by Stage 18's direct overlay.

### Verification — 2026-10-27 (Stages 19–20 and 29)

- Safari dev/production suites passed final proportional layout at all eight
  frame sizes. At 393×852 chart grew to 314px; measurement/action gap was the
  intended 12px. Short/landscape layouts stopped at 80% and scrolled to final fields.
- Keyboard simulation at 393×852 and 375×667 retained exact geometry/drafts under
  300px shrink; covered-field scrolling, focus/dismissal, recovery, width change
  and reset/reopen passed. Production `/CoffeeOS/`, build/diff/headers passed.
- These UI-only refinements did not rerun populated upgrades. Physical keyboard
  animation, zoom/touch precision with scaled targets, enlarged text, browser
  chrome, native picker, Home Screen and deployed-host behavior remain unverified.
  Older browsers' unscaled scrolling CSS fallback was not tested.

## Stage 15: Direct Brew Session Editing & Persistent Save/Cancel

- [x] **Status:** Complete; Safari UI and both-backend populated upgrades passed, physical iOS pending.

### Goal

Edit the original brew record directly without losing imported values or precision.

### Tasks

1. Feed card activation opens the complete prefilled editor; retain the original
   ID, bean relationship, date and all nullable fields. Cancel never writes.
2. Update through the serialized transaction path. A no-op edit preserves exact
   dates/numbers/nulls/empty or whitespace/multiline comments and imported EY.
   Recalculate EY only when dose/yield/TDS changes. Compare normalized native
   datetime input against its initial value so unchanged saves preserve the
   original sub-millisecond timestamp rather than reserialize it via JS Date.
3. Keep Save/Cancel in a persistent action row with safe-area/scroll clearance;
   follow Stage 14's current layout and keyboard rules. Prevent double submits;
   rollback retains drafts, committed warnings exit the draft and refresh data.

### Acceptance Criteria (Stage 15 Gate)

- Edit each field/bean/date in place, with original ID and no duplicate record.
  Cancel/reopen restores saved data. Save unchanged then compare full CSV values
  byte-for-byte, especially microsecond timestamps after native-input normalization.
- Imported EY survives unrelated edits; operands changed by the user recalculate
  it. Preserve null versus empty, whitespace comments and binary64 values.
- Inject update/snapshot/commit errors: exact rollback and reopen, retained draft,
  retry once and committed-warning behavior. Pinned actions remain reachable.
- Build/Safari and Stage 6 upgrades on both backends, old backup imports and
  production-subpath/isolation pass; physical native picker/keyboard gaps recorded.

### Verification — 2026-10-26

- Safari 27.2 production UI/layout suite and populated upgrades from `2ccf66c`
  passed on Safari/IndexedDB and Firefox/OPFS. Tests covered every field, no-op
  precision/null/text/imported EY, cancel, rollback/reopen/retry/double-submit/reload.
- Final upgrades explicitly preserved unchanged sub-millisecond dates byte-for-byte
  in CSV after native input normalization. Original Stage 1 misplaced edit result
  belongs here. Build/diff/headers and `/CoffeeOS/` assets passed.
- Physical iOS picker, keyboard, larger text, Home Screen and actual host remain
  unverified; current proportional layout supersedes original fixed-size assertions.

### Follow-up Verification — 2026-10-28

- R1 session writes share coordinated commit handling; R5 stale session drafts
  reject imported changes, including microseconds. See Stage 44 exact-data and
  failure tests.

## Stage 16: Swipe to Delete Brew Sessions

- [x] **Status:** Complete; Safari/IndexedDB + Firefox/OPFS checks passed, physical iOS pending.

### Goal

Delete exactly one brew through deliberate swipe/actions without accidental editing.

### Tasks

1. Left swipe reveals a separate Delete button; right swipe/Escape/menu dismiss.
   Keep keyboard-accessible actions, mobile targets, vertical scrolling and swipe
   click suppression; short/cancelled gestures never reveal deletion.
2. A fresh surface tap while Delete is visible closes it without opening the
   editor; next tap opens normally. Reverse swipe closes the revealed action.
3. Delete transactionally, refresh counts/histories and prevent repeated submits.
   Retain drafts/data on rollback and show backup guidance after committed flush errors.

### Acceptance Criteria (Stage 16 Gate)

- Test intentional swipe versus fresh tap, opposite-swipe/Escape/menu dismissal,
  ordinary editing and vertical/short/cancelled gestures. Dismissal cannot open
  the editor; swipe completion cannot activate the card. Actions remain usable.
- Explicit Delete removes exactly the selected session, preserving every bean/
  sibling field, counts/history and reload. Failure rollback/retry deletes once.
- On injected post-commit CHECKPOINT failure, export the committed collection;
  do not promise reload durability until a later healthy flush succeeds.
- Build/Safari, phone geometry, Stage 6 upgrades/old backups and subpath/headers
  pass; non-writing gestures preserve exact records, device limits stay explicit.

### Verification — 2026-10-26–27 (includes Stage 37)

- Initial Safari 27.2 full production/targeted gestures and both populated `2ccf66c`
  upgrade suites passed deletion scope, exact siblings, rollback/retry/duplicate,
  reload and committed-warning backup. Incorrect failed-CHECKPOINT durability
  expectation was corrected; no durability guarantee after failed flush claimed.
- Stage 37 Safari/full IndexedDB upgrade passed fresh-tap Delete dismissal,
  opposite swipe/menu, normal editor opening, cancelled/vertical gestures and
  exact non-writing data. Build/diff/headers/eight relative resources passed.
- Firefox/OPFS not rerun for Stage 37. Physical touch/scroll, native keyboard,
  Home Screen lifecycle, Safari OPFS and deployed host remain unverified.

### Follow-up Verification — 2026-10-28

- R1 session deletion shares coordinated commit handling. Stage 44 verifies
  rollback/reopen, retry and committed warnings; hidden histories refresh on tab
  entry.

## Stage 21: Compact Bean Editor & Pinned Bean Histories

- [x] **Status:** Complete; desktop Safari/IndexedDB upgrades passed, physical iOS pending.

### Goal

Keep bean creation compact and inspect long histories without losing collection position.

### Tasks

1. Start with accessible Add a bean toggle; closing preserves drafts, no-beans
   navigation opens/focuses the form. Fit name/dates/photo/submit above navigation.
2. Pin inspected heading at content top, scroll only history and retain the final
   session above navigation. Include native `::details-content` in flex sizing.
3. Close via heading/history/photo/blank space or Escape, restoring collection
   scroll/focus. Preserve text selection, vertical scrolling and actions/swipes.
   If swipe actions are open, Stage 7's dismiss-first rule takes priority.

### Acceptance Criteria (Stage 21 Gate)

- Hidden initial form/toggle state/draft preservation/no-beans focus pass. At
  393×759 and 393×852, with/without 59/34px safe areas, photo-inclusive form fits;
  320×568, 375×667 and 430×932 stay horizontally contained, controls 16px/44px.
- Long history scrolls both ways at 320/375/393/430px without moving heading;
  last session is reachable. Close restores prior collection position/focus.
  Menu actions leave inspection open; visible swipe actions dismiss first.
- Build, Safari dev/production, persistence/IO and Stage 6 affected-path checks pass.
  Record physical touch/selection and backend/host paths not rerun.

### Verification — 2026-10-27

- Safari 27.2 dev/production/full suite and exact frames passed form/history fit,
  scroll/position/focus and action isolation after fixing details-content flex sizing.
  Build/diff/headers/subpath passed. Populated `2ccf66c` Safari/IndexedDB upgrade
  passed exact records, old backups, failure recovery and edit/photo/delete regressions.
- OPFS upgrades not rerun in this feature session; older Safari, physical native
  selection/touch/keyboard, Home Screen and deployed host remain unverified.

### Follow-up Verification — 2026-10-28

- R7 expanded histories page through all stored sessions; collapsed beans render
  no metrics rows. Stage 44 repeats pinned scrolling, keyboard, selection and
  swipe checks.

## Stage 22: Portable Single-File CoffeeOS Backups

- [x] **Status:** Complete; Safari/Firefox/interoperability/upgrades passed, signed-zero and device limits retained.

### Goal

Use one standard, portable `.coffeeos` file for exact collection backup and explicit
merge, retaining old backups and recoverable overwrites.

### Tasks

1. Keep `docs/backup-format.md` normative and fixture
   `docs/fixtures/example-v1.coffeeos` independently readable. Ordinary unencrypted
   ZIP contains exactly root `manifest.json`, `beans.parquet`, `brew_sessions.parquet`;
   export STORE, accept STORE/DEFLATE, MIME `application/zip`. Recognize contents
   despite generic MIME or `.zip` extension; empty full-schema tables are valid.
2. Manifest: `format=coffeeos-backup`, archive/data-schema versions both 1,
   UUID backup ID, UTC exported time, informational producer/version and exactly
   two fixed table descriptors: path, row count, byte length, SHA-256, ordered
   typed/nullable/unit columns, primary keys and session→bean FK. Validate known
   contracts/actual Parquet; informational properties cannot authorize new SQL.
3. Preserve exact logical records, photos in `beans.photo_jpeg`, null/empty/text
   distinctions, units and duration notation. Export stored EY, not recalculated
   UI values; never round-trip table data through JS Date/JSON. Exclude derived
   bean names, storage metadata, locks and credentials. Validate archive-internal
   relationships even when missing parents happen to exist locally.
4. Capture both Parquet tables/counts/time in one serialized DB operation, then
   release the queue for hash/ZIP work. Use pinned `fflate` 0.8.3/license/lockfile.
   Release temporary buffers/files/object URLs and preserve earlier prepared
   downloads on failure. Export must not exceed its own reader's supported format.
5. Audit ZIP directory/local metadata/ranges before extraction: exactly three
   unique fixed root files, no traversal/directories/encryption/ZIP64/unsupported
   compression, overlap or conflicting lengths. Verify actual decompressed length,
   CRC32 and SHA-256, UTF-8/JSON, manifest/types/counts/versions, Parquet schemas,
   IDs/required fields/finite numbers/dates/photos and internal relationships.
6. **Current limits:** no application-imposed archive/expanded-collection byte cap.
   Retain 64 KiB manifest and ZIP32 sizes/offsets (no ZIP64). Bound decompression
   by each validated declared entry size and reject inconsistent output; never
   size allocations from row counts. Resource failures are recoverable before
   live mutation. Removed caps are not a guarantee of arbitrary device capacity.
7. File selection only stages/previews date/producer/counts and new/updated/
   unchanged rows. Explicit Import into collection merges by ID, retains local-only
   records and warns that older matching records can overwrite newer local edits.
   Recheck revision/exact comparison under the DB queue; stale preview requires
   another confirmation, including add/delete races back to the same counts.
8. Before overwriting records, persist immutable `import-recovery-v1:<UUID>` in
   the existing snapshot store and expose `.coffeeos` download after reload.
   No rotation/replacement of recoveries, `tables-v1` or backend metadata. Abort
   before DML if recovery save fails. Coordinate IndexedDB snapshot/SQL COMMIT:
   pre-commit failure rolls both tables back; post-commit abort preserves previous
   durable snapshot, shows committed warning and offers recovery/export.
9. Ordinary IO: Save backup → “Backup ready,” download/separate Share; one import
   picker → preview/confirmation/Cancel, accessible status and retained retryable
   files. Legacy collapsed path reads combined/separate/mixed CSV/Parquet with
   old null/photo/partial-merge rules. No normal CSV export or format selector.

### Acceptance Criteria (Stage 22 Gate)

- Empty/populated/photo/multiple-session/bean-without-session archives round-trip
  exact IDs, relationships, dates/microseconds, finite binary64 values, nulls/empty
  strings and Unicode/multiline text through import/reload; unchanged imports
  duplicate neither records nor recoveries. Signed-zero limitation remains explicit.
- Independently unzip/read generated files using Python zipfile/PyArrow, compare
  schema annotations/counts/hashes/values/binary64 bits and import DEFLATE repack.
  Current TIMESTAMP microseconds use `isAdjustedToUTC=false`, interpreted as UTC.
- Corrupt/truncated ZIP/Parquet, unsupported versions/types, duplicate/path-conflict
  entries, false lengths/DEFLATE output, hashes/count mismatches, orphan IDs and
  invalid required/photo/date/number fields fail before live mutation. Keep files
  retryable; do not silently choose an empty collection or bypass validation.
- Selection/cancel/stale preview/double-submit, failed recovery creation, second
  table insert, SQL COMMIT and post-commit IDB abort are covered. Recovery download
  retains exact original records after reload; committed uncertainty refreshes UI
  without encouraging duplicate import. Missing local-only IDs are not deleted.
- Export/import/recovery/Drive use compatible format/limit rules. Check shared
  configuration and ZIP32 boundary rejection without restoring former 8 MiB/1 GB
  application caps; report untested large-file capacity and measured device memory
  separately from structural format limits.
- Build, `test:backups` on Safari/IndexedDB and Firefox/OPFS, historical IO, populated
  Stage 6 upgrades with separate dependencies when needed, subpath and headers pass.
  Physical Files/Share, photo-heavy memory and native Home Screen checks stay explicit.

### Verification — 2026-10-27 (implementation)

- Normative format/fixture, fflate/license, queued snapshot, strict validation,
  revision-aware merge and immutable recovery implemented. Build/typecheck/diff,
  full Safari 27.2 and both backend archive suites passed. Tests included 27 bad
  archive cases, ten independent malformed PyArrow fixtures, false DEFLATE sizes,
  internal orphans, recovery/commit failures, stale previews, UI Share/retry/reload.
- Independent PyArrow 21/zipfile verified standard entries, hashes, schema,
  microseconds and representative binary64 bit patterns; DEFLATE repack imported
  on both browsers. Populated `2ccf66c` upgrades passed exact data/old backups/
  failed-upgrade preservation, separately installing old/current lockfiles.
  Harness now acquires shared port before rebuilding fixtures.
- Negative zero can normalize to positive zero in pinned DuckDB table import;
  isolated setting/compression probes did not fix it. Numerical zero/representative
  finite precision passed; exact negative-zero sign preservation remains unresolved.

### Verification — 2026-10-27 (absorbed size changes in Stages 23/29)

- Original desktop measurement: 30 distinct photos → 30,821,909-byte archive,
  coarse new Safari/WebKit RSS 2,197,168 KiB. Six photos → 6,169,395-byte STORE /
  4,732,905-byte DEFLATE, ~30ms export/~125ms validation, coarse RSS 1,391,520 KiB.
  RSS includes native/shared memory and fixture generation, not just archive heap.
- Initial 8 MiB cap was raised to 1,000,000,000 bytes in Stage 23 (configuration/
  build checks only, no 1 GB capacity test); Stage 29 subsequently removed local/
  Drive collection caps. Current format/source retain 64 KiB manifest and ZIP32
  checks, not a 1 GB policy. Stage 33 explicitly retained that decision.
- Physical photo-heavy capacity, Files recognition, native save/share/picker,
  Home Screen storage, older Safari and deployed-host checks remain unverified.
  Threshold-sized browser tests above 1 GB are not claimed; no deployment performed.

### Follow-up Verification — 2026-10-28

- R6 exports validate logical readability before download. Healthy data keeps
  format 1; damaged legacy photo bytes use explicit format 2. Archive
  corruption/commit tests remain in place; see Stage 44.

## Stage 24: Google Drive Login & Basic Snapshot Sync

- [x] **Status:** Complete; user accepted 2026-10-27, later native-fetch fix/live small round trip passed.

### Goal

Provide optional real Google authorization and one explicit snapshot/recovery operation,
with offline/local data independent of Google availability.

### Tasks

1. Follow `docs/google-drive-backups.md`: registered public web client from
   `src/driveConfig.ts`, optional nonempty `VITE_GOOGLE_CLIENT_ID` override; no
   secret/manual ID input. GIS browser token flow requests `drive.file`, `openid`,
   `email`, verifies scopes/identity and originally kept tokens/expiry only in
   memory (Stage 41 adds reuse of unexpired authorization between visits).
2. Load GIS only in `drive-auth.html`; preserve main database COOP/COEP. Narrowly
   except only the helper, with a random one-time BroadcastChannel, three-minute
   expiry/cancellation and late-result suppression. Test helper updating an old
   isolation worker without opening a database; never relax main-page isolation.
3. Call stored/injected HTTP transport with `globalThis` as receiver. Native
   browser `fetch` can throw TypeError before networking when invoked as
   `this.transport(...)`; arrow-function mocks alone cannot verify this contract.
4. Discover marked folders/snapshots via app metadata, not names/cached IDs. Order
   latest by server `createdTime` including sub-millisecond ties, deterministic ID
   tie-break. Listing/auth/network errors are failures, never empty history.
5. Connect/Sync now perform exactly one operation: successful nonempty local read
   uploads a new immutable snapshot; confirmed empty both tables recovers latest
   validated cloud backup; both empty/no cloud shows “No Drive backup yet” with no
   empty upload. Unreadable local DB means no transfer. Stage 25 owns current
   paginated history/resumable transfers; original 4 MiB multipart MVP is historical.
6. Snapshot before network and release DB queue. Before empty recovery recheck
   revision/counts under serialized access, including add/delete-to-empty races.
   Abort if data changed; no automatic merge/replace. Reuse atomic import/warnings.
7. Serialize controls, suppress duplicate Connect/Sync and disconnected callbacks;
   reauth resolves one pending operation without new connect-time upload.
   Disconnect clears tokens/account/cloud selections without deleting data/files.
8. Keep normal account/connect/reconnect/sync/disconnect UI. Stage 26's temporary
   test panel was retired in Stage 28; simulated helpers stay under `tests/`.
   Preserve Stage 2 startup diagnostics and Stage 25 opt-in Drive diagnostics.

### Acceptance Criteria (Stage 24 Gate)

- Native browser regression sends the client's actual transport receiver through
  native fetch to a localhost fixture; no receiver TypeError. Run in Safari and
  Firefox, and Chrome only when authorized. Mocks do not satisfy this regression.
- Real-service login followed by authenticated history succeeds while database
  isolation persists. Distinguish API/firewall/connectivity errors from JS failures;
  verify mocked success cannot mask a broken native transport.
- Connection behavior table, serialization, failed/expired/denied/blocked/cancelled
  auth and late callbacks pass. Failed storage/cloud reads never infer emptiness.
  Empty recovery rechecks revision; rollback and committed-warning paths stay intact.
- Real fixture upload/download validates exact archive/schema/relationships. A
  full cross-profile restore/reload is a separate required service path; record
  acceptance versus actual coverage, never infer it from a same-profile preview.
- No credentials/email/collection/file/session URLs in reports, logs or storage.
  Routine offline brewing/file imports work after auth failure/disconnect.
- Build, helper isolation/static-subpath tests, backup regressions and populated
  Stage 6 upgrades pass. Public release approval/physical iOS remain separate gates.

### Verification — 2026-10-27 (MVP, Stages 26/28)

- Safari 27.2/IndexedDB and Firefox/OPFS passed 16 simulated adapter checks, actual
  DuckDB photo/session precision round trips (~8.3 KiB archives), empty-recovery
  races/rollback/reload, denial/duplicates/layout. GIS/helper simulation and
  previous-worker/static-host helper exception passed. `abcddcd` populated upgrades,
  backups, build/diff/headers/subpath passed; mocks did not establish Google success.
- Temporary diagnostics tested rollback-only pinned round trip with unchanged
  revision/recoveries; removed from normal UI in Stage 28. Registered public client
  shipped; `a0a427d` populated upgrades and bundle checks confirmed no manual ID,
  test buttons/fake-token fixtures. Live localhost attempt was cancelled by user;
  rejected restart/production-origin override did not run, no account settings changed.
- User privately tested/accepted Stage 24; device/account details unspecified.

### Verification — 2026-10-27 (Stages 34–36 native-fetch fix/live evidence)

- Later full-workflow login failed before history requests. Native Chrome probe:
  ordinary-object receiver threw TypeError, global receiver reached Drive (401
  using an invalid placeholder); CORS OPTIONS returned 200. Firewall reachability
  confirmed separately. Earlier HTTP 308 suspicion was not reproduced, no redirect
  change made. Fixed stored transport to invoke with `globalThis`.
- All 30 adapter checks, including localhost native receiver regression, passed
  in authorized isolated Chrome 156, Safari and Firefox; Safari/Firefox full Drive
  and populated `0fb9a4d` upgrades passed exact data/backups/recoverable failures.
- User reconnected and reported no Drive backup/no empty upload, confirming live
  authenticated history. Auto-review rejected an earlier tool-driven Sync retry
  lacking explicit payload/destination authorization; no upload executed then.
- With later explicit approval, prepared one synthetic bean/session/generated 16px
  JPEG archive (8,856 bytes, null/zero/binary64/microsecond fields). User reconnected
  and reported upload success; remote size/hash passed. Pinned HTTP 200 download
  validated, SQL comparison showed exact unchanged tables/photos/revision/recoveries.
  Preview did not apply restore; authorized test file retained in dev-account Drive.
- An initial development Chrome RuntimeError cleared on ordinary reload preserving
  original empty data; no reset/storage deletion used. Final Chrome OPFS reload
  retained exact synthetic CSV/photo/dates; tokens appropriately cleared. Build/diff,
  main/helper headers and eight relative production resources passed. No deployment.
- User accepted 24/25/33 (Stage 36). Live Safari OAuth, cross-profile recovery,
  live merge/replace, large/interrupted/expired-token transfers, physical iOS/Home
  Screen, Safari OPFS and deployed-build behavior remain unverified by this evidence.

### Follow-up Verification — 2026-10-28

- R2 automatic empty recovery enters an explicit local apply phase. Stage 44
  actual-view Cancel/Disconnect tests cover staging, snapshot/commit boundaries
  and durability failures on both backends.

## Stage 25: Complete Google Drive Backup & Recovery Workflow

- [x] **Status:** Complete; user accepted 2026-10-27 after Stage 35 fix, remaining service/device limits retained.

### Goal

Extend basic sync with complete history, resumable transfers and explicit recoverable
merge/replacement, preserving existing records and cloud snapshots.

### Tasks

1. Discover all eligible app-marked completed/non-trashed snapshots account-wide,
   including moved files and paginated history. Select marked upload folder stably
   across simultaneous creation/renames/moves; cached IDs are hints, no unrelated
   name-only adoption or deletion of duplicate folders. Preserve old app markers.
2. Order by server upload time/ties and label “Most recently uploaded.” Capture
   previous latest before connect upload and keep it the default restore choice;
   label new upload separately. Let user choose older files explicitly, never
   silently substitute for corrupt/unsupported backup. Pin file ID and validated bytes.
3. Upload immutable bytes/backup ID in 1 MiB resumable chunks, progress/cancel,
   confirmed-offset probes and bounded transient/rate-limit retry/backoff. Reconcile
   ambiguous completion by backup ID before any second POST; verify final size/hash.
   Keep unfinished uploads out of history and never claim an unconfirmed result.
4. Handle quota/revoked/expired/offline/missing-session states. Same-account user
   reauth resumes the pending operation once, without connect-time duplication.
   Preserve the cap-removal decision in Stage 22, ZIP32/manifest/actual-length
   validation and recoverable resource failures; configured format is not capacity proof.
5. Restore selection downloads/validates/previews before mutation. Default Merge
   adds/updates IDs, retains local-only records and discloses older-value overwrite.
   Explicit Replace identifies snapshot/removal counts and requires a deliberate
   Replace local collection confirmation, including valid empty snapshots.
6. Under serialized DB access recheck revision/exact comparisons and reconfirm
   stale previews. Before replacement save durable immutable local recovery; if
   it fails, abort. Stage both tables and apply atomically with coordinated SQL/
   snapshot commit, original identity/lock/backend; no empty intermediate state.
7. Respect pinned DuckDB FK behavior, including the stale reverse FK catalog from
   the existing bean-delete table rename. Use the validated rollback-safe temporary
   constraint-holder/recreate-identical-tables transaction only for explicitly
   confirmed, recovery-protected replacement; never recreate the database/storage.
8. Pre-commit errors roll back exact original tables; post-commit uncertainty
   refreshes data, retains recovery and offers backup guidance. Do not retry local
   destructive work after ambiguous commit or automatically upload after restore.
9. Account switching clears old authorization/operations/selections and requires
   confirmation before sending the local collection to the new account. Preserve
   originally no remembered authorization or secret preferences (Stage 41 adds
   unexpired-token reuse). Disconnect is non-destructive;
   explain revoking Google's grant separately. Offline file/brew flows remain usable.
10. Opt-in `?drive-debug=1` diagnostics only: safe phase/status/exception locations,
    copy report and read-only local snapshot/rollback-only staging comparison.
    Exclude tokens/email/contents/file IDs/SQL/session URLs/raw free-form messages.
    Ordinary visits expose no debug global/output. No diagnostic upload/import/
    replacement/recovery creation. History refresh retains completed operation status.

### Acceptance Criteria (Stage 25 Gate)

- Adapter checks cover pagination/ties/multiple folders/moves/concurrent uploads,
  lost responses, chunks/probes/retry/cancel/expired sessions/reauth, quota and
  delayed callbacks. One operation never duplicates verified snapshots or sends
  data to an unconfirmed different account. Include Stage 24's native fetch test.
- Pinned preview is stable despite history refresh. Merge retains local-only IDs;
  confirmed Replace adopts exactly selected snapshot. Local changes force renewed
  confirmation; unchanged/repeated action is idempotent, cancellation never mutates.
- Inject recovery save/removal/insertion/SQL COMMIT/snapshot save failures on both
  backends. Verify exact rollback/reload, immutable recovery download, stale-FK
  runtime handling and visible committed-warning exports. Failed CHECKPOINT does
  not establish post-reload durability; separately verify later healthy flush.
- Diagnostics ordinary/opt-in paths and injected packaging failure preserve exact
  records/revision/recoveries across reload. Private sentinels/IDs/raw errors stay
  out of output, including V8's first stack-message line. Local checks never upload.
- Full Safari/Firefox Drive workflow, build, backups and populated Stage 6 upgrades
  pass. Compare real-service history/upload/download separately from simulated
  multi-chunk/interruption/account switching/merge/replacement/recovery evidence.
- Physical iPhone/Home Screen authorization/background/capacity, cross-profile
  recovery and deployed headers are reported explicitly; no continuous/background
  sync, automatic conflict resolution or retention cleanup is implied.

### Verification — 2026-10-27 (absorbed Stage 33)

- Implemented history/folders/pinned previews, resumable transfer, restore/recovery
  and switching. 26 simulated adapter checks + complete Safari/IndexedDB and
  Firefox/OPFS workflows passed. Raw transfer fixture 6 MiB+1 byte; photo archives
  ~8.3 KiB. These do not establish large-photo/physical iOS memory capacity.
- Populated Safari upgrade from build preceding `0fb9a4d` and Firefox/OPFS from
  `0fb9a4d` passed exact records, old backups, failed startup and transactional
  restore/recovery/reload. Runtime probes confirmed stale reverse FK catalog and
  rollback-safe constraint-holder workaround with identical recreated table schemas.
- Recovery failure/removal/insertion/commit/snapshot rollback, local-only modes,
  stale reconfirmation, committed-warning export and later healthy flush passed.
  Forced OPFS CHECKPOINT failure does not promise durability after reload.
- User subsequently reported live post-login failure; mocked success did not close
  that gate. Stage 35 fixed native receiver behavior; actual history/small live
  upload/download and acceptance evidence are consolidated in Stage 24 above.

### Verification — 2026-10-27 (absorbed Stage 34 and final acceptance)

- 29 simulated checks/full workflows and opt-in diagnostics passed on both browsers:
  no debug global ordinarily, exact read-only local compare, injected packaging
  failure, sanitized reports and unchanged records/revision/recoveries after reload.
  V8 raw stack-message filtering and upload-result preservation after history
  refresh were fixed and regression checked. `0fb9a4d` populated upgrades passed.
- Native receiver fix brought adapter count to 30 in all three browsers; full
  Safari/Firefox workflows and sequential populated upgrades passed. User accepted
  Stages 24/25/33 after real 8,856-byte upload/pinned validated download.
- No real multi-chunk/interrupted/expired-token transfer, fresh-profile recovery,
  live explicit merge/replace or cross-device background test is claimed. Physical
  iOS/Home Screen, Safari OPFS and deployed workflow remain unverified. Testing-mode
  Google use does not establish public consent approval. No deployment performed.

### Follow-up Verification — 2026-10-28

- R2 local recovery outcomes remain visible and refresh views; R4 switch
  confirmation is independent of credentials; R5 editor conflicts protect
  imported records. See Stage 44.

## Stage 30: Public Privacy Policy, About Overlay & Readable Homepage

- [x] **Status:** Complete locally; deployment/Google approval and physical iOS pending.

### Goal

Expose accurate app/privacy information without login, JavaScript or a working database,
and let in-app users read it without losing work.

### Tasks

1. Supply standalone `public/privacy.html`/shared CSS: app identity/effective date,
   local records/photos/recovery, optional Google identity/Drive transfers,
   ephemeral tokens, hosting, retention/deletion/revocation/security limits and
   user-approved GitHub project contact. Keep disclosures consistent with behavior.
2. Header About & privacy opens same-document native dialog, shared policy text,
   scrolling content/persistent Back, Escape, focus containment/explicit return,
   retryable loading errors and preserved active tab/drafts. No DB/network auth needed.
3. Initial `index.html` visibly includes app name/journal description, local/optional
   Drive explanation and relative `./privacy.html` link with noscript guidance.
   Keep it during loading/failure; successful startup replaces it with the app.

### Acceptance Criteria (Stage 30 Gate)

- Plain HTTP client reads description/privacy link from production homepage;
  standalone policy works without scripts/login/DuckDB. Blocked/pending DB cannot
  hide the policy; normal startup removes fallback and retains About/navigation.
- Policy/overlay text matches. Back/Escape/retry, focus containment/return, drafts/
  active tab/record persistence and same-document behavior pass. At 393px, no
  overflow; Back/link remain touch-sized and Back stays visible while scrolling.
- Test script-blocked and actual scripts-disabled behavior separately; CSP does
  not exercise native noscript rendering. Build/Safari/Stage 6 startup upgrades,
  subpath assets/isolation pass; public hosting/Google approval require own evidence.

### Verification — 2026-10-27 (includes Stage 31)

- Policy checked against implemented disclosures and official Google/GitHub
  guidance during implementation; no blanket zero-information claim. Build/full
  Safari and production public/overlay focus/draft/reload/offline-retry checks passed.
  Explicit Safari focus return fixed; screenshot inspected. No dependencies changed.
- Crawler follow-up passed plain HTTP and script-blocked Safari initial view,
  policy navigation, narrow layout, pending/failed storage, successful app startup.
  Native scripts-disabled noscript rendering not exercised. Populated `27e039b`
  Safari/IndexedDB + Firefox/OPFS upgrades passed exact records/backups/recoveries
  and injected failures; transient local Parquet error passed unchanged rerun.
- Build/diff, relative policy/assets/manifest/icons and dev/preview headers passed.
  No deployment/Google Console changes or approval claimed. Physical iOS/Home
  Screen, live host reachability and storage lifecycle remain unverified.

## Stage 32: Edit Beans from Swipes & Actions Menu

- [x] **Status:** Complete; Safari/IndexedDB + Firefox/OPFS upgrade checks passed, physical iOS pending.

### Goal

Edit beans in the shared form while preserving identity, photos and all linked brews.

### Tasks

1. Right swipe reveals yellow Edit, left reveals Delete; three-dot menu offers
   both, including expanded history. Apply Stage 7 dismiss-first interaction:
   reverse swipe closes before revealing opposite action; surface tap only dismisses.
2. Edit opens/focuses prefilled form at top with Save/Cancel. Cancel/Escape exits
   without mutation and completion restores add mode. Preserve photo preparation
   cancellation and explicit native empty-date normalization.
3. Update non-key fields without `UPDATE ... RETURNING id`: pinned DuckDB rejects
   that form for referenced parents. Select result under same serialized queue
   after transaction. Preserve ID/created_at/linked sessions; never insert on missing ID.
4. No-op edit retains name whitespace, null dates/photos and timestamp precision.
   Rollback retains draft for retry; committed flush warning exits edit mode and
   refreshes without inserting a duplicate. Guard repeated submissions.

### Acceptance Criteria (Stage 32 Gate)

- Edit from collapsed/expanded/menu and both swipe directions works without
  toggling history. Visible actions dismiss on tap/reverse swipe; next gesture
  activates normally, action buttons remain usable. Non-writing gestures preserve data.
- No-op save compares full CSV exactly, including microsecond creation timestamp/
  whitespace and every sibling/session value. Edit name/dates/photo replacement/
  removal, cancel while decoding, Cancel/Escape and blank/missing IDs all pass.
- Inject write/commit/snapshot errors: rollback/reopen/retry updates exactly once;
  committed warning refreshes and exits. Test Safari empty optional date input
  via native value reset, keeping validation enabled.
- Photo-inclusive form fits 393×852 with simulated safe areas, 320×568 has no
  horizontal overflow, Save/Cancel ≥44px. Build/Safari/Stage 6 upgrades/old backups/
  subpath/headers pass; physical/device/host gaps remain explicit.

### Verification — 2026-10-27 (includes Stage 37 interaction fix)

- Full Safari 27.2, focused bean-edit cases and populated `4d31002` upgrades
  passed Safari/IndexedDB + Firefox/OPFS: exact CSV/no-op/linked data, all edits/
  photos, rollback/retry/warnings, old backups and failed startup preservation.
- Runtime probe confirmed UPDATE without RETURNING works for referenced beans.
  Safari date probe identified empty segmented input normalization; fixtures and
  nullable prefill reset native value explicitly without disabling validation.
- Geometry/screenshot `.cache/bean-edit-safari.png`, build/diff/headers/eight
  resources passed. Stage 37 Safari/full populated upgrade added fresh-tap and
  close-before-opposite regressions (see Stage 7); Firefox not rerun for that fix.
- Transient local Parquet errors passed unchanged reruns. Safari OPFS, native
  touch/keyboard, Home Screen/storage lifecycle and deployed-host checks remain
  unverified. No normal user collection changed and no deployment performed.

### Follow-up Verification — 2026-10-28

- R1 bean edits/deletes share coordinated commit handling, R3 warnings are
  visible outside the editor, and R5 original-record checks preserve stale
  drafts. See Stage 44 Safari and upgrade evidence.

## Stage 38: Consolidate Feature Requirements & Regression Gates

- [x] **Status:** Complete; documentation compaction and build checks passed.

### Goal

Fold repair sessions into the original feature stages so their instructions and
acceptance criteria prevent repeating the bugs while preserving dated evidence.

### Tasks

1. Consolidate repair/retry/implementation-duplicate stages into their feature
   owners; retain historical numbers, dates, acceptance and verification limits.
2. Replace superseded unsafe fallback, stale UI sizing/caps and pending statuses
   with current requirements, while distinguishing historical checks from new gates.
3. Put failure causes, specific regression scenarios and applicable test commands
   beside original tasks. Keep future numbering sequential, starting at Stage 39.
4. Check stage mapping, required structure, preserved contract/coverage limitations,
   diff and build. Change documentation only; claim no new runtime/browser results.

### Acceptance Criteria (Stage 38 Gate)

- Every original stage number 1–37 remains either a feature stage or a mapped
  completed/retired historical entry; none is renumbered/reused. Cross-stage review
  findings live with owners. Every active feature stage has status, Goal, Tasks,
  Acceptance Criteria and dated Verification.
- Original storage/startup/date/commit, mobile layout/keyboard, swipe-dismissal,
  native-fetch and restore/diagnostics defects have explicit owner-stage tasks
  and failure/regression gates. No active instruction reinstates unsafe fallback,
  obsolete backup caps or a superseded editor interaction.
- Preserve known negative-zero/scaled-target limits, measured archive sizes,
  user acceptance and unverified live/device/upgrade paths. Newly strengthened
  criteria do not retroactively claim tests were run.
- `uv run npm run build` and `git diff --check` pass. Only `PLAN.md` changes;
  application/storage/format/identity/dependencies/hosting remain unchanged.

### Verification — 2026-10-27

- Consolidated 37 stage records into 18 feature stages and 19 numbered historical
  entries, also mapping the cross-stage review; this documentation update is Stage 38.
  Moved causes/regression gates into feature owners; preserved acceptance dates,
  actual test evidence, superseded behavior context and explicit coverage gaps.
- Structure checks passed: all 38 numbers accounted for once, every history owner
  resolves to a retained feature stage, and every feature/update has checked status,
  Goal, Tasks, stage gate and dated Verification. Plan reduced from 3,245 to about
  1,200 lines (63%); no full duplicate repair specifications retained.
- Checked current archive specification/source for cap removal and native transport/
  startup handling against consolidated requirements. `uv run npm run build` and
  `git diff --check` passed; Node resolves inside this project's `.venv`. Only
  `PLAN.md` changed. No new Safari/Firefox/Chrome, physical iOS, live Google,
  populated-upgrade or deployment pass is claimed by this documentation update.

## Stage 39: Simplify Backup Details & Prioritize Google Drive

- [x] **Status:** Complete locally; Safari checks passed, physical iOS pending.

### Goal

Keep Drive backup selection and upload feedback concise and readable, with cloud
backup first and clearly named local backup options below.

### Tasks

1. Remove the full Drive file ID from dropdown labels while retaining upload date,
   exact byte count and the most-recent marker. Keep IDs as option values.
2. Format the Uploaded message size in bytes, KB, MB or GB as appropriate.
3. Show the upload result once in the existing live status; remove its duplicate
   grey hint. Preserve backup transfers, verification, selection and stored data.
4. Place Google Drive backup before all local options. Rename the local sections
   to “Save local backup” and “Import local backup”, including the save button and
   recovery guidance that references the import section.

### Acceptance Criteria (Stage 39 Gate)

- Dropdown labels contain the existing date, byte count and most-recent marker
  without file IDs; selecting and restoring the previous snapshot still works.
- Completed uploads show one status message with a human-readable size and the
  existing capture date, record counts and manual-sync guidance.
- DOM/visual order places Google Drive first, followed by the existing local
  options. Local section titles/save button use the explicit local labels;
  navigation, local file workflows and Drive controls still work.
- Build, Safari app/Drive regression checks, isolation headers and production
  subpath assets pass. Record any environment limitations explicitly.
- No storage identifiers, backup formats, dependencies or deployment change.

### Verification — 2026-10-27

- `uv run npm run build`, `git diff --check`, full `test:safari` and `test:drive`
  passed in desktop Safari 27.2 using isolated localhost automation sessions
  (IndexedDB). Drive checks used simulated Google authorization/transport and
  covered snapshot selection, restore, exact records/photos/precision, failed
  writes, recovery backups and reload persistence.
- Focused Safari display probe passed: dropdown retained date/exact bytes/marker
  and ID value; one live Uploaded status showed `5 KB` for 4,956 bytes; a second
  upload kept the previous snapshot selected. Size checks passed for bytes, KB,
  MB, GB and decimal rounding. Dev/preview isolation headers, relative production
  assets and Safari `/CoffeeOS/` production startup/navigation passed.
- UI text/presentation only; no storage, format, startup, dependency, service-worker
  or deployment change, so no new populated-build upgrade run was required.
  Physical iOS/Home Screen, live Google and deployed-host checks were not run;
  no new Firefox/OPFS or populated-build upgrade pass is claimed.
- Ordering/label follow-up passed build, diff checks and full `test:safari`
  again, including local backup imports/exports and persistence. Focused desktop
  Safari checks confirmed cloud-first DOM/visual order, exact local titles/save
  button, Drive connect/sync and previous snapshot selection on localhost; the
  production `/CoffeeOS/` preview also passed ordering/labels/navigation, relative
  assets and isolation headers. Physical iOS and live Google remain unverified.

## Stage 40: Skip Unchanged Drive Backups & Separate Backup Cards

- [x] **Status:** Complete locally; Safari/IndexedDB and Firefox/OPFS checks passed, live Google and physical iOS pending.

### Goal

Avoid uploading unchanged collections, including those backed up before content
hashes existed, and restore the gap below the Google Drive card in I/O.

### Tasks

1. Fingerprint captured logical records with SHA-256 and a versioned, deterministic
   encoding: fixed table/column order, rows sorted by ID, exact strings/nulls,
   microsecond timestamps and IEEE-754 doubles. Ignore archive identity/dates/layout.
2. Store the optional fingerprint in Drive app metadata and verify it after upload.
   Compare the latest completed cloud snapshot before packaging/uploading; show an
   explicit unchanged result. Validate/download/hash older snapshots without this
   metadata. Stop on comparison failures; never replace old backups or local data.
3. Preserve newest-snapshot recovery semantics: a match to an older backup alone
   does not suppress a new upload. Keep cancellation, account scoping, capture-time
   consistency and upload reconciliation. No persistent cache or format migration.
4. Put 24px below the first Drive card. Document behavior and add focused hash,
   unchanged/changed/legacy/failure/reload and card-spacing regressions.

### Acceptance Criteria (Stage 40 Gate)

- Consecutive unchanged syncs and a reloaded collection create no new upload;
  new metadata avoids archive downloads. Existing hashless backups compare after
  validation. Real edits upload once, with older history and selection preserved.
- Parquet row order/compression, capture dates and archive IDs do not affect the
  fingerprint. Every column, numeric precision, microseconds, null/empty/text/photo
  differences affect it; stable blocks cover more than 256 records.
- Failed reads/listing/checksums/validation and cancellation preserve records and
  prevent uploads; failed upload verification never retries with a new archive.
  Empty recovery, merge/replace and old CSV/Parquet/archive imports remain intact.
- Drive/local cards have at least 24px separation at phone width; no horizontal
  overflow. Build, Safari app/Drive checks, subpath assets/isolation and populated
  previous-build IndexedDB/OPFS upgrades pass, with environment gaps recorded.
- Keep all storage identifiers, schema/archive contracts, dependencies and origin.

### Verification — 2026-10-27

- `uv run npm run build`, `git diff --check`, full `test:safari`, Safari and
  Firefox `test:drive`, and Safari `test:drive:diagnostics` passed. Drive transport
  and Google authorization were simulated; no live Google pass is claimed.
- Fingerprint checks passed for every one of the 18 stored fields, adjacent
  high-precision doubles, microsecond timestamps, null/empty/literal-null strings,
  Unicode/multiline values, photos, reordered/compressed Parquet and 257-row blocks.
  Signed-zero fixture passed; existing Parquet normalization limits remain unchanged.
  A reused temporary path exposed DuckDB's cached Parquet metadata during testing;
  unique virtual filenames fixed it, and failed-read cleanup/retry passed.
- Unchanged syncs skipped upload/download with metadata, including after reload;
  hashless archives downloaded/validated and skipped upload. Changed collections
  uploaded once, previous selection/history stayed available, and restoring older
  contents uploaded when the newest backup differed. Corrupt downloads, mismatched
  metadata, incomplete history, hashing failures and cancellation preserved records
  without uploads. New hash metadata is checked on completion/reconciliation.
- Populated previous-build `642d9ee` upgrades passed in isolated desktop Safari
  27.2/IndexedDB and Firefox/OPFS at the same `/CoffeeOS/` origin/profile. Exact
  records/photos/relationships, old CSV/Parquet imports, old/new logical hashes,
  merge/replacement/recovery and reloads passed. Injected startup/permission/worker
  failures preserved durable bytes and showed recoverable errors. Firefox's
  focused archive suite also passed historical archives and invalid-file rejection.
- At phone width, Drive/local cards had at least 24px separation with no horizontal
  overflow. Production subpath assets/startup and dev/preview isolation headers
  passed, including the helper exception and prior isolation-worker update.
- No storage identity, schema/archive format, dependency, origin or deployment
  changed; no normal user collection was used. Safari OPFS, physical iOS/Home
  Screen/storage lifecycle, live Google and deployed-host checks remain unverified.

## Stage 41: Reuse Unexpired Google Drive Authorization Between Visits

- [x] **Status:** Complete locally; Safari/IndexedDB and Firefox/OPFS checks passed, live Google and physical iOS pending.

### Goal

Avoid repeating Google account selection while Google's existing access token
remains valid, preserving explicit transfers and all local records/backups.

### Tasks

1. Cache the verified token/account, original expiry and backup-enabled choice in
   a versioned, app-path/client-scoped localStorage value. Keep Google's supplied
   lifetime and existing 30-second margin; never extend it or request a refresh token.
2. Restore valid authorization without a popup, network request or automatic sync.
   Reverify the restored account before the first Drive operation. Clear expired,
   malformed, incompatible-client, revoked or mismatched credentials safely.
3. Remove the cache on Disconnect/Switch account, stop work on cross-window
   connection changes, preserve switch confirmation over reload, and tolerate
   blocked/full credential storage without changing collection persistence.
4. Update privacy/help text and add focused reload/reuse, expiry, rejection,
   identity, cancellation and storage-failure checks. Run build, Safari app/Drive
   checks, production subpath/isolation checks and populated previous-build
   IndexedDB/OPFS upgrades. Record live/device/environment gaps.

### Acceptance Criteria (Stage 41 Gate)

- Reopening restores an unexpired connection without requesting another token;
  explicit sync/history uses it after identity verification. Reuse retains the
  original expiry, and opening alone never uploads/downloads/restores records.
- Expired/malformed/wrong-client cache entries cannot authorize requests; Google
  rejection or account mismatch clears credentials before a transfer. Transient
  verification failures preserve the collection and allow retry without a popup.
- Disconnect/switch remove remembered credentials. Pending switch confirmation
  survives reload. Wrong-account renewals/cancelled late callbacks never persist
  or transfer data. Blocked/full localStorage leaves memory authorization usable.
- Tokens/account details stay out of database/backups/logs; clear only the new
  credential key. Preserve all database identities, records/relationships/units,
  dates/nulls/precision, old CSV/Parquet imports, backend selection and origin.
- Build, focused authorization and Safari regressions, relative subpath assets,
  isolation headers and populated prior-build IndexedDB/OPFS upgrades pass, with
  failed-startup preservation verified and remaining coverage gaps explicit.

### Verification — 2026-10-27

- `uv run npm run build`, `git diff --check`, Safari `test:drive` and
  `test:safari`, and Safari/Firefox `test:drive:authorization` passed. Desktop
  Safari 27.2 used isolated automation sessions; Firefox used a separate test
  profile with external services/traffic disabled. Google authorization and
  transport were simulated; no normal user profile or collection was used.
- Focused authorization checks passed: actual reload retains valid authorization
  and exact records without automatic Google requests/transfers; explicit history
  verifies identity once without a popup and keeps the original expiry. Tests
  cover expiry-timer removal, malformed/wrong-client/expired cache, transient
  verification retry, revoked tokens, Drive 401 invalidation, wrong-account
  renewal rejection, same-account resume, switch confirmation over reload,
  Disconnect, cancelled late verification, simulated cross-window storage events
  and back/forward-cache events, denied reads and quota failures. In-memory
  requests remain usable after cache writes fail, with a visible retention hint.
- Populated upgrades from prior build `fa42a52` passed in the same isolated
  profile/origin at `/CoffeeOS/` for Safari/IndexedDB and Firefox/OPFS. Exact
  records/photos/relationships/dates/nulls/precision survived replacement/startup
  and reload. Historical CSV/Parquet imports, archive merge/replacement/recovery
  and write rollback passed. Injected schema/metadata/permission/worker startup
  failures preserved durable data and exposed recoverable errors without an empty
  collection; reload recovered the original records.
- Built production `/CoffeeOS/` Safari probe passed restored-token use, original
  expiry, no automatic Google access, account verification without a popup,
  Disconnect/reload, navigation and relative assets. `drive-isolation.mjs` passed
  the helper/worker boundary and dev/preview main/helper COOP/COEP checks.
- No database identifiers, schema, archive format, dependencies, origin or
  deployment changed. Credentials are confined to the new app-path/client cache,
  excluded from collection/backup/diagnostic code paths, and documented in the
  privacy policy/help. Expired stored credentials are removed on next open if the
  app was closed or browser timers were suspended.
- Reviewed Google's browser token model and token-handling guidance: use the
  returned lifetime, obtain fresh authorization from a user gesture after expiry,
  and handle revocation. Persistent browser storage retains its same-origin
  script-access exposure; documentation now discloses it.
- Live Google renewal/revocation, Safari OPFS, actual browser-restart cookie/token
  lifecycle, physical iPhone/iPad/Home Screen/storage lifecycle and deployed-host
  behavior remain unverified. No deployment or Google Console change performed.

### Follow-up Verification — 2026-10-28

- R4 switch intent survives the pre-authorization reload gap and token
  expiry/invalidation. Unretainable switches keep the current connection with a
  recoverable error; see Stage 44 storage-failure checks.

## Stage 42: Direct Touch Feedback & Finger-Tracking Row Swipes

- [x] **Status:** Complete locally; desktop Safari/Firefox checks passed, physical iOS feel pending.

### Goal

Make brew and bean rows react on contact and follow horizontal finger movement
while preserving native vertical scrolling, explicit actions and stored records.

### Tasks

1. Replace release-only swipe recognition with shared pointer tracking: immediate
   pressed feedback, a small direction threshold, live transforms without easing
   during drag, bounded end resistance and animated open/closed settling.
2. Preview the revealed action during dragging, but keep it inert until release.
   Preserve bean Edit/Delete directions, reverse-to-close, menus, keyboard access,
   tap-to-edit/expand/dismiss, and the existing 40px reveal threshold.
3. Preserve vertical scrolling/pinch zoom, scrollable expanded bean histories,
   text selection, and reduced-motion support. Cancel safely on pointer loss,
   multi-touch/cancellation without accidental activation; prevent native image
   dragging from interrupting row tracking.
4. Verify intermediate movement before release, press/scroll/cancel/reversal,
   action/tap separation and unchanged data in isolated Safari, plus existing
   editor/delete regressions and production subpath/isolation checks.

### Acceptance Criteria (Stage 42 Gate)

- A row highlights on contact and moves with horizontal input before pointerup;
  the revealed control tracks the exposed edge and cannot activate mid-drag.
  Dragging has no transform transition; release settles to the intended action.
- Small drags return to their prior state; reverse swipes close existing actions
  without switching sides in one gesture. Cancellation/lost capture/multi-touch
  restore prior state and remove temporary styles without editing/deleting data.
- Vertical gestures preserve scrolling and do not reveal actions or open editors.
  Normal taps, menu/keyboard controls, expanded history interaction and selection
  remain usable. Touch targets/phone layouts and reduced motion remain intact.
- Build, focused Safari gesture checks, existing edit/delete/data checks and
  production `/CoffeeOS/` assets/COOP/COEP pass. Record physical-device limitations.
- No storage/startup/dependency/service-worker/format/origin changes. Preserve all
  IDs, relationships, record fields/units/dates/nulls/precision and old backups.

### Verification — 2026-10-28

- `uv run npm run build`, `git diff --check` and full `test:safari` passed on
  desktop Safari 27.2 in isolated automation sessions. Shared row tracking now
  highlights on contact, locks horizontal intent after 5px, follows the finger
  without an easing transition and settles after release with the existing
  40px threshold. No swipe invokes Edit/Delete directly.
- New `swipe-row-checks.mjs` runs in Safari smoke and populated-upgrade suites.
  It checks exact intermediate 8/32/60px offsets before release, pressed state,
  inert action previews, short/reverse drags, bounded overscroll, cancellation,
  surface capture loss versus child capture handoff, second-pointer cancellation,
  vertical-axis locking, menus/Escape, tap-to-edit/expand, selected history text,
  native-image-drag prevention, and byte-identical CSV/records after interaction.
  Trusted Safari mouse-pointer actions also verify live tracking/capture across
  separate down/move/up commands; touch/multitouch events are simulated.
- Safari/IndexedDB and Firefox/OPFS suites passed populated build replacement
  from `35ab417` at the same isolated `/CoffeeOS/` origin/profile. Existing
  session/bean edit and delete tests passed: unchanged field fidelity, rollback,
  retry, duplicate-submit guards, histories, committed-write warnings and reload.
  Prior CSV/Parquet/archive imports and recovery remained readable; injected
  startup/permission/worker failures preserved stored data with recoverable errors.
- Firefox's final focused gesture checks passed with reduced motion enabled only
  in the isolated test profile: direct dragging and zero-duration release settling
  both work. The production-subpath/isolation suite and direct dev/preview header
  checks passed; relative assets and helper-only header exception are preserved.
- This update changes row interaction/CSS only; collection storage, startup,
  dependencies, service worker, backup formats, identifiers, origin and deployment
  are unchanged. No normal browser profile or user collection was used.
- Physical iPhone/iPad touch feel, real pinch/scroll arbitration, Home Screen
  behavior, Safari reduced-motion settings and deployed-host behavior remain
  unverified. Desktop pointer automation is not a physical iOS acceptance pass.

## Stage 43: Codebase Review & Follow-up Remediation

- [x] **Status:** R1–R7 and both investigations implemented; final acceptance passed in Stage 45.

### Goal

Address the correctness, data-preservation and performance findings in
[the 2026-10-28 codebase review](docs/code-review-2026-10-28.md). The report
contains source locations, causes, reproduction steps, observed results, owning
stages, fix directions and individual regression gates. This review did not
change application behavior. Remediation is implemented in Stage 44; its final
acceptance gate passed in Stage 45. See [the handover](docs/remediation-handover-2026-10-28.md).

### Tasks

1. [x] Review the current application, including uncommitted Stage 42 changes,
   inspect storage/backup/Drive/UI failure paths, run existing Safari checks and
   reproduce actionable findings in isolated sessions. Preserve existing edits.
2. [x] **R1 / P1 — fix first:** Use coordinated SQL/IndexedDB commit handling for
   ordinary writes, cascading bean deletion and legacy imports. A rejected SQL
   commit must never publish a changed durable snapshot. Preserve committed-write
   warning semantics and revision accounting. Extend the owning storage/edit/IO
   regression tests with the missing IndexedDB COMMIT-failure cases.
3. [x] **R2–R3 / P2:** Make empty Drive recovery's apply/commit phase explicit;
   cancellation must not conceal committed local records or skip view refresh.
   Move bean-deletion durability warnings outside the hidden editor/removed row.
4. [x] **R4 / P2:** Preserve the account-switch confirmation requirement when
   reloading before authorization and when an unenabled credential expires or
   is invalidated. Keep the choice independent of expiring token material.
5. [x] **R5 / P2:** Detect stale bean editor saves atomically after an import
   changes the edited record; preserve drafts and require an explicit conflict
   decision. Audit the analogous asynchronous-import/session-editor interaction.
6. [x] **R6 / P2:** Reconcile legacy photo acceptance with archive readability.
   Reject inconsistent new input while providing a data-preserving path for
   already-stored/previously-exported values. Never silently strip photos or
   make existing collections inaccessible by tightening startup validation.
7. [x] **R7 / P2:** Load/render histories on demand and defer hidden-view work.
   Preserve all stored history, ordering, counts, navigation and swipe behavior.
   Measure collapsed DOM size and refresh time against the review's fixture.
8. [x] Investigate the two explicitly unverified areas in the report: full
   recovery-payload scans during startup and post-instantiation worker failures.
   Record measured results and either a regression/fix or a justified disposition;
   do not assume they are covered by startup/small-fixture tests.
9. [x] After implementation, update owning-stage verification and this stage's
   status. Run relevant Safari regressions and populated previous-build upgrades
   for both IndexedDB and OPFS, including historical imports and failed-upgrade
   preservation. Keep device/live-service gaps explicit.

### Acceptance Criteria (Stage 43 Gate)

- R1 failure injections cover bean/session add, update and delete, linked bean
  deletion, and CSV/Parquet imports. Pre-commit failures preserve exact live and
  durable data after reload; post-commit durability failures produce visible,
  accurate warnings without duplicate retries or incorrect rollback/revisions.
- R2 cancellation/disconnection before and during recovery has an accurate
  outcome, refreshed views and preserved data on both backends. R3 warnings
  remain visibly rendered and accessible with the editor closed or bean expanded.
- R4 requires Enable confirmation across the pre-authorization reload gap,
  post-authorization reload, expiry and credential-storage failure paths, before
  any transfer. Existing first-connect, reconnect and Disconnect behavior passes.
- R5 stale drafts cannot silently overwrite imported record versions. Ordinary
  no-op saves retain dates, photos, nulls, text and numeric/timestamp precision.
- R6 newly accepted data produces a readable archive; old stored values and
  historical backups retain an explicit, tested recovery/import path with their
  bytes preserved. No silent destructive normalization is permitted.
- R7 a collapsed 1,000-session collection does not construct every session's
  metric subtree. All history remains reachable; counts, ordering, save/import/
  delete refresh and Stage 42 interactions pass. Record comparable measurements.
- The two investigation items have evidence-backed dispositions. Build, relevant
  Safari suites, local production subpath assets and COOP/COEP checks pass.
  Previous-build populated IndexedDB/OPFS upgrade, old-backup import and failed
  upgrade preservation checks pass before claiming storage fixes complete.
- Preserve all record IDs/relationships, field meanings/units, dates/nulls/comments/
  precision, storage identifiers, recoverable copies and deployment origin.
  No implicit reset, fallback to an empty collection or silent backend switch.

### Verification — 2026-10-28

- Reviewed working tree based on `35ab417`, including the existing Stage 42
  edits. Added the review report and this stage only; application/dependency/
  storage/service-worker/deployment changes are not part of this review.
- Project-local Node executable confirmed. `uv run npm run build`, full
  `test:safari`, `test:drive:authorization` and `test:drive` passed in desktop
  Safari 27.2 isolated localhost automation sessions using IndexedDB. Google
  authorization/transport were simulated; 31 Drive adapter checks passed.
- Focused probes reproduced all seven report findings: five ordinary write
  variants rolled back live records but changed records after database reopen;
  a cancelled recovery committed 3 beans/2 sessions with zero view refreshes;
  the bean-delete warning had no rendered geometry; pre-authorization switch
  reload reached a mocked folder-creation POST without Enable; a stale draft
  overwrote an imported bean name; an accepted malformed legacy photo caused
  self-exported archive validation to fail; collapsed histories created 31,163
  DOM descendants for 1,003 sessions (~88 ms desktop trigger-to-observed finish,
  including automation polling, not a physical-device performance benchmark).
- Reproduction instructions and specific regression gates are retained in the
  report. Temporary probe scripts/results remain under ignored `.cache/review-*`;
  a future checkout can implement the tests from the self-contained report.
- `drive-isolation.mjs` passed local production `/CoffeeOS/` startup/assets and
  main/helper isolation checks. Direct dev/preview requests confirmed COOP
  `same-origin` and COEP `require-corp`. Final build and `git diff --check` passed.
- Remediation is not implemented. No new populated previous-build upgrade,
  Firefox/OPFS, physical iPhone/iPad/Home Screen, live Google or deployed-host
  pass is claimed. The two additional investigation items have source evidence
  only. Prior stage results remain historical records; they do not close this gate.

### Remediation follow-up — 2026-10-28

- R1–R7 and both investigation items are implemented in Stage 44. Targeted
  regressions and populated prior-build checks passed during implementation.
  The final worker/COMMIT change passed focused Safari/IndexedDB and Firefox/OPFS
  fault checks; final whole-suite and populated-upgrade reruns remain outstanding.
- The user requested a handover after the current worker-failure item. Continue
  from [the handover](docs/remediation-handover-2026-10-28.md); do not treat the
  original review's historical “not implemented” notes as the current status.

## Stage 44: Implement Review Remediation & Preservation Regressions

- [x] **Status:** Implementation and final acceptance complete; final reruns recorded in Stage 45.

### Goal

Implement Stage 43 findings R1–R7 and investigate its recovery-listing and runtime
worker-failure concerns, preserving existing collections and historical backups.

### Tasks

1. [x] Coordinate every SQL/IndexedDB commit; cover rejected commits, snapshot put/
   abort failures, post-commit warnings, exact revisions and retry/reopen behavior.
2. [x] Make automatic Drive recovery enter an explicit commit phase; keep committed
   results visible and refresh views. Render bean-delete warnings outside editors.
3. [x] Persist pending account-switch confirmation independently of credentials.
4. [x] Reject stale bean/session drafts using record-local original versions inside
   the serialized operation, preserving draft values and precision.
5. [x] Validate new photos consistently; offer explicit historical damaged-photo
   preservation and readable versioned archives retaining original photo bytes.
6. [x] Fetch counts for collapsed beans and page opened histories; defer hidden-view
   refresh and recovery listing. Add lightweight recovery metadata additively.
7. [x] Inject post-startup worker failures; fail pending UI work and quarantine the
   engine with an honest unknown-outcome message, preserving storage for reload.
8. [x] Run build, Safari regressions, authorization/Drive checks, populated prior-build
   IndexedDB and OPFS upgrades, old imports, startup-failure preservation and local
   production subpath/isolation checks. Record device/live-service gaps.

### Acceptance Criteria (Stage 44 Gate)

- Stage 43 R1–R7 acceptance criteria pass with regression evidence; committed
  durability warnings increment revision once and never roll back committed SQL.
- Cancel/Disconnect cannot conceal an automatic local recovery commit; results
  and visible view counts agree. Account-switch confirmation survives reload,
  token expiry/invalidation and unavailable decision storage.
- Changed/deleted edited records reject stale saves without touching imports;
  unrelated changes and ordinary unchanged saves remain valid.
- Healthy collections keep archive format 1. Explicit legacy preservation keeps
  historical damaged photo bytes readable through format 2, with compatibility
  disclosed; startup never tightens validation over saved collections.
- A fresh collapsed 1,000-session collection creates zero history metrics rows;
  all sessions remain reachable in sorted pages of at most 50. Record DOM/time.
- Recovery listing avoids cloning indexed payloads; old immutable recovery keys
  and bytes survive additive metadata indexing. Runtime worker errors release
  pending callers, reject further operations, and preserve reload recovery.
- Build, required Safari and populated previous-build IndexedDB/OPFS checks pass;
  old CSV/Parquet imports and failed upgrades preserve exact data. Keep IDs,
  relationships, meanings/units/dates/nulls/comments/precision, storage identity,
  origin and deployment unchanged. No implicit empty fallback or destructive reset.

### Verification — 2026-10-28

- Implemented R1–R7 and both additional investigations; retained all pre-existing
  Stage 42 edits and the Stage 43 review. Build and `git diff --check` pass.
  No collection schema, dependency, existing storage identity, origin or hosting
  change. Format 2 is an explicit legacy-photo compatibility contract; original
  stored values and old CSV/Parquet remain recoverable without normalization.
- Ordinary-write failure matrices passed 32 IndexedDB and 16 OPFS cases covering
  bean/session add/update/delete, cascading delete and CSV/Parquet imports. SQL
  COMMIT rejection, IDB put/abort/post-commit abort and OPFS post-commit failure
  checks cover exact live/durable data, revisions, retry and reopen behavior.
- Actual Drive recovery views passed 16 IndexedDB / 12 OPFS lifecycle cases for
  Cancel/Disconnect at download/staging/capture/COMMIT/after-COMMIT and applicable
  durability failures. Account-switch checks passed pre-authorization reload,
  post-authorization reload, expiry/invalidation, storage failure and BFCache.
  Unretainable switches preserve the current connection. Drive also replaces an
  equal-hash unreadable old photo archive with readable format 2, retaining old
  files and skipping a repeated upload. All Google traffic was simulated.
- Bean/session original-record checks reject stale edits including microsecond-
  only changes, imported photos/nulls/dates and deleted IDs; unrelated changes
  and ordinary precision-preserving saves pass. Actual UI drafts remain intact;
  committed bean deletion alerts have rendered geometry outside the closed form.
- Populated upgrades from `35ab417` passed in isolated same-profile/origin
  `/CoffeeOS/` Safari/IndexedDB and Firefox/OPFS sessions during implementation.
  Exact records, historical CSV/Parquet, old immutable recovery keys/dates/bytes
  and old-build damaged photos survived build replacement/startup/reload.
  Injected metadata/schema/permission/worker startup failures preserved data and
  exposed recoverable errors. The latest worker/keepalive change still requires
  those full upgrade gates to be rerun before this stage is complete.
- A fresh collapsed 1,000-session upgraded fixture created zero history rows and
  91 descendants, versus the review's 1,003 rows / 31,163 descendants. All sessions
  are reachable in sorted 50-row pages. Trigger-to-observed completion varied
  ~8–112 ms Safari / ~103–104 ms Firefox, including polling; no controlled timing
  or physical-iOS speed claim. Existing pinning, scroll, editor and swipe checks
  passed during implementation. Latest full Safari run hit an intermittent native
  pointer assertion; test input cleanup was added and awaits a full rerun.
- Recovery listing no longer runs at initial mounting. Profiling ~3.2–4.9 MB of
  retained payloads showed zero payload reads after additive metadata indexing;
  original recovery keys/bytes survive. Indexed listing was sometimes slower at
  this small record count (~4–13 ms versus ~3–9 ms value scans); the established
  benefit is avoiding payload cloning and startup work, not a timing guarantee.
- Post-startup real SDK worker-failure injections passed on both backends for a
  pending read, an editor save and COMMIT. Saving UI settles, drafts remain, the
  failed engine rejects further operations and warnings describe unknown commit
  outcome without retry advice. IDB keepalive aborts without publishing candidate
  data or blocking reopen; unknown COMMIT never triggers speculative rollback.
  OPFS preserves all original records whether the interrupted insert committed
  or not. Explicit reopen recovers a readable original collection.
- Latest source passed build and focused runtime checks on both backends.
  Safari/Firefox backup, Drive and authorization suites and earlier full Safari
  smoke passed during this work. Final whole-suite/upgrade/subpath/isolation
  reruns remain open, as detailed in
  [the requested handover](docs/remediation-handover-2026-10-28.md).
- Physical iPhone/iPad/Home Screen/storage lifecycle, Safari OPFS, live Google and
  deployed-host behavior remain unverified. No deployment or real account upload
  performed. Work stopped after the current worker-failure checks at the user's
  request; no final acceptance pass is implied.

### Final acceptance follow-up — 2026-10-28

- Stage 45 completed the outstanding gates against the final worker/COMMIT source:
  full Safari smoke/remediation, populated `35ab417` upgrades on Safari/IndexedDB
  and Firefox/OPFS, historical backups, failed-startup preservation, simulated
  Drive/authorization, diagnostics, build and local production isolation passed.
- Stage 43 task 9 and Stage 44 task 8 are complete. The verification above remains
  the implementation-session record; final measurements, Safari automation
  reliability notes and explicit device/live-service gaps are recorded in Stage 45.

## Stage 45: Complete Remediation Acceptance Verification

- [x] **Status:** Complete; final desktop acceptance gates passed.

### Goal

Complete the outstanding Stage 43–44 acceptance gates against the final worker/
COMMIT implementation, preserving all existing edits, data and historical fixtures.

### Tasks

1. [x] Rerun the full Safari suite and investigate any remaining trusted pointer
   failure without weakening gesture assertions.
2. [x] Rerun populated upgrades from `35ab417` sequentially in isolated Safari/
   IndexedDB and Firefox/OPFS at the same `/CoffeeOS/` origin and profile.
3. [x] Run final backup, Drive, authorization, runtime-worker and production
   subpath/isolation regressions; confirm dev/preview response headers and build.
4. [x] Record results and remaining environment gaps, update Stage 43 task 9 and
   Stage 44 task 8/status only after their gates pass, and refresh the handover.

### Acceptance Criteria (Stage 45 Gate)

- Full Safari gestures/edit/delete/IO checks pass without reduced assertions.
- Both previous-build upgrades preserve exact records, old CSV/Parquet backups,
  immutable recovery copies and damaged-photo compatibility across replacement,
  startup and reload; injected failures retain recoverable original data.
- Final backup/Drive/authorization/runtime regressions, build, diff whitespace
  checks and local production `/CoffeeOS/` assets/COOP/COEP pass.
- Restore the tracked example archive after generated test output. Preserve
  existing storage identifiers, schema, dependencies, origin and user edits.
- Distinguish desktop Safari/IndexedDB and Firefox/OPFS evidence from unverified
  physical iOS/Home Screen, Safari OPFS, live Google and deployed-host behavior.

### Verification — 2026-10-28

- Read the remediation handover and current stages; confirmed project-local Node
  resolves inside `.venv`. Initial `uv run npm run build` passed.
- Full `uv run npm run test:safari` passed twice in isolated desktop Safari 27.2
  after an initial trusted-pointer contact assertion failed on a session row.
  Ten focused bean/session swipe repetitions and the final Safari upgrade also
  passed. Added bounded native-event diagnostics with listener cleanup, retaining
  immediate contact, exact pre-release movement, capture and data assertions.
  The intermittent failure's cause remains unconfirmed; diagnostics are retained
  for recurrence. No production gesture behavior changed in this continuation.
- `TEST_PREVIOUS_REF=35ab417 uv run npm run test:upgrade` and
  `TEST_PREVIOUS_REF=35ab417 uv run npm run test:upgrade:firefox` passed sequentially.
  Each replaces the previous build at the same isolated `/CoffeeOS/` origin/profile.
  Exact IDs/relationships/fields/precision/nulls/dates/comments/photos, historical
  CSV/Parquet, damaged-photo opt-in imports/format 2, immutable recovery keys/bytes,
  reload and injected failed-startup preservation passed. No empty fallback was
  presented on failure. Safari used IndexedDB; Firefox used OPFS.
- Final `test:backups`, `test:drive`, `test:drive:authorization` and
  `test:drive:diagnostics` passed on both browsers/backends. Archive validation,
  rollback, recovery UI, legacy-photo Drive replacement, account-switch retention,
  sanitized diagnostics and unchanged data/revisions passed; 31 simulated Drive
  adapter checks passed per browser. Google authorization/transport were simulated.
- Firefox `TEST_FIREFOX=1 uv run npm run test:review` passed; both populated upgrades
  also ran the final remediation and worker checks. Reconfirmed 32 IndexedDB / 16
  OPFS commit-failure cases and 16 IndexedDB / 12 OPFS actual recovery-view cases.
  Pending SDK requests/save UI settle, failed engines quarantine, unknown COMMIT
  never triggers speculative rollback, and explicit reopen retains original data.
- The final upgraded 1,000-session fixtures produced zero collapsed history rows
  and 91 descendants on both backends; all ordered pages remained reachable.
  Observed trigger-to-finish times were ~111 ms Safari / ~103 ms Firefox, including
  polling. Indexed recovery listing read zero payloads versus ~4.86 MB Safari /
  ~3.21 MB Firefox value scans. These are fixture observations, not controlled
  timing or physical-device performance claims.
- `uv run node tests/drive-isolation.mjs` passed production `/CoffeeOS/` startup,
  relative assets, previous service-worker update, isolated main window and the
  helper-only header exception/BroadcastChannel without requesting Google.
  Direct dev/preview requests returned COOP `same-origin` and COEP `require-corp`;
  preview helper headers also passed. `uv run npm run build` and `git diff --check`
  passed against the final source.
- Restored `docs/fixtures/example-v1.coffeeos` byte-for-byte after backup tests.
  Existing uncommitted work is preserved. This continuation changes only test
  diagnostics and documentation; no collection schema, storage identity,
  dependencies, origin, hosting or production application code changed.
- Test dev/preview servers, Safari WebDriver and isolated Firefox were stopped.
  Raw run logs remain under ignored `.cache/stage45-*.log`. No normal browser
  profile or user collection was used; no commit, deployment or real Google upload.
- Physical iPhone/iPad touch/viewport, Home Screen installation/storage lifecycle,
  Safari OPFS, live Google authorization/transport and deployed-host response
  headers/behavior remain unverified. Desktop acceptance does not certify these.

## Stage 46: Independently Review Remediation & Diagnose Pointer Failures

- [x] **Status:** Review complete; two P2 findings remain for remediation.

### Goal

Audit the Stage 43 findings against the final implementation and tests, and
identify the event boundary behind the handover's intermittent Safari pointer
failure without disturbing the existing uncommitted implementation.

### Tasks

1. [x] Compare R1–R7 and both investigations with source and regression evidence.
2. [x] Rerun build and targeted isolated Safari checks; probe uncovered boundaries.
3. [x] Reproduce native pointer failure with event traces and distinguish
   automation delivery from application gesture handling.
4. [x] Record findings, reproducible evidence and remaining environment gaps in
   a follow-up review; preserve earlier acceptance records.

### Acceptance Criteria (Stage 46 Gate)

- Every original finding has an explicit evidence-backed disposition.
- New defects have concrete reproduction steps and source locations; pointer
  conclusions distinguish observed facts from unconfirmed underlying causes.
- Build and selected regression results are recorded accurately, including
  failures. No passing rerun is used to erase a reproduced intermittent failure.
- Preserve application code, storage identities, schema, dependencies, historical
  fixtures and all pre-existing user edits. Review completion does not imply
  newly reported defects are fixed or physical iOS behavior is verified.

### Verification — 2026-10-28

- Confirmed Node resolves inside this project's `.venv`. Build and fresh full
  desktop Safari 27.2 smoke/remediation checks passed on IndexedDB, including the
  32-case commit matrix, stale drafts, legacy-photo preservation, lazy histories
  and post-startup worker failures. Audited existing previous-build upgrade logs
  and their test sources; no new upgrade or Firefox pass is claimed.
- Reproduced the intermittent trusted-contact assertion in a repeated isolated
  Safari run. At failure the document-level trusted-event trace was empty after
  successful WebDriver move/down responses, with a clean row, expected hit target
  and empty selection. Forty cycles with an extra state observation and ten with
  the original first-state-read timing subsequently passed. Missing versus delayed
  delivery and the underlying Safari/WebDriver cause remain unconfirmed; repeated
  passes do not close that automation issue.
- Independently reproduced a real shared gesture-handler defect with trusted
  Safari mouse input: press just inside a session row, release outside before
  capture, then swipe again. Release leaves the row pressed; the next press only
  clears stale state and its 60px drag leaves offset zero/no revealed action.
  This is distinct from the empty-event-trace failure. Physical touch is unverified.
- Reproduced the remaining R6-related compatibility gap: legacy CSV imports accept
  a tab-only bean name or ID, then `saveBackup()` rejects the entire collection.
  JPEG-specific preservation is fixed, but broader accepted-input/export parity
  is not. No data loss occurred in these isolated probes.
- Fresh `test:drive:authorization` and the 16-case actual recovery-view matrix
  (`TEST_REVIEW_ONLY=recovery uv run npm run test:review`) passed with mocked
  Google traffic. Local production `drive-isolation.mjs`, `/CoffeeOS/` assets,
  service-worker update and main/helper isolation passed. Direct dev/preview
  responses confirmed COOP `same-origin` and COEP `require-corp`; final build
  and `git diff --check` passed.
- Added [the independent follow-up review](docs/remediation-followup-review-2026-10-28.md)
  with all original dispositions, two P2 findings, reproduction steps and fix
  gates. Updated review/handover links without rewriting historical acceptance.
  Application/test code, schema, storage identities, dependencies, fixtures and
  origin are unchanged; only review documentation was edited. Raw logs/probes
  remain under ignored `.cache/stage46-*`.
- Physical iPhone/iPad/Home Screen/storage lifecycle, Safari OPFS, live Google
  and deployed-host behavior remain unverified. No deployment, commit, real
  account upload or normal browser collection was used.


## Stage 47: Preserve Legacy Text Backups & Complete Pointer Cleanup

- [x] **Status:** Complete; fixes and desktop acceptance passed.

### Goal

Fix Stage 46 F1/F2 while preserving existing records, historical backups, storage
identities and the current gesture behavior for scrolling, selection and zoom.

### Tasks

1. [x] Align default legacy text validation; add explicit historical text
   preservation and a versioned archive contract for exact existing values.
2. [x] Propagate compatibility through local/recovery/Drive backups and previews.
3. [x] Clean up gestures on outside release and window interruption; distinguish
   native input delivery from synchronous handler feedback in Safari tests.
4. [x] Run targeted regressions, full Safari checks, populated previous-build
   upgrades on IndexedDB/OPFS, historical imports, failed-startup preservation,
   build and production subpath/isolation checks; document remaining gaps.

### Acceptance Criteria (Stage 47 Gate)

- Default imports reject whitespace-only required text consistently. Explicit
  historical import and existing storage preserve original IDs, links, text,
  photos, dates, nulls and precision; their exports/recoveries restore exactly.
- Healthy archives retain format 1 and photo-only compatibility retains format 2.
  New text compatibility is versioned, disclosed, and used by all restore paths.
  Equal-hash unreadable old Drive archives receive a readable preserving copy.
- Outside release/cancellation, blur/pagehide and hidden documents clear pending
  gestures. The next swipe works; temporary listeners are removed on every exit.
  Exact movement, capture, selection, vertical scrolling and multitouch still pass.
- Native Safari tests identify absent events separately and assert pressed state
  at event dispatch, without retrying gestures or waiting for application feedback.
- Populated prior-build upgrades and failure recovery preserve exact data on
  Safari/IndexedDB and Firefox/OPFS. Build and local production checks pass;
  physical iOS, Safari OPFS, live Google and deployed-host gaps remain explicit.

### Verification — 2026-10-28

- Read the follow-up review and current implementation. Existing uncommitted work
  is preserved. No schema, dependency, database/snapshot/lock identity or origin
  change was made. Existing records and immutable recovery payloads are not rewritten.
- Default legacy imports now share required-text validation with archives. An
  explicit text-preservation checkbox retains historical whitespace-only names,
  IDs and foreign keys. Readable format 3 archives use the explicit
  `legacy-whitespace-v1` text and `legacy-opaque-v1` photo contracts, while healthy
  and photo-only exports keep formats 1 and 2. Local/recovery/Drive exports,
  merge/replace/empty recovery and diagnostics propagate the compatibility flags.
- Pending gestures now have temporary outside-release/cancel, second-contact,
  window-blur/pagehide and visibility listeners, removed by an AbortController on
  every finish. Element focus transfer is distinguished from actual window blur.
  Existing pointer capture, scrolling, selection and pinch behavior is retained.
- Native tests now explicitly activate the automation window and sample pressed
  state synchronously during pointerdown bubbling. Missing native delivery fails
  separately; tests never retry gestures or poll for feedback. An initial trace
  confirmed missing input with `document.hasFocus() === false`; after activation,
  three focused repetitions, full Safari and the production upgrade passed,
  including off-row release followed by a 60px swipe. This fixes the test's focus
  precondition, not a claimed Safari engine defect or physical-iOS certification.
- Full Safari 27.2 smoke/remediation passed, including the new actual legacy-import
  opt-in/export/preview UI, four exact text compatibility cases, 32 IndexedDB commit
  fault cases, stale drafts, recovery indexing and runtime worker failures. The
  larger populated run initially exceeded one batched command's 120-second test
  deadline; splitting the unchanged matrix into one fault case per command passed.
  An early regression also caught element blur being mistaken for window blur;
  the final handler filters the event target, and all native checks then passed.
- Populated upgrades from `35ab417` passed sequentially on Safari/IndexedDB and
  headless Firefox/OPFS at the same isolated `/CoffeeOS/` origin/profile. The old
  build created tab/newline fields, linked sessions, damaged photos and immutable
  recoveries via its original APIs. Exact fields/IDs/links/precision, historical
  CSV/Parquet opt-ins, format 3 roundtrip, build replacement and reload passed.
  Whitespace records remained present through injected worker/schema/metadata/
  storage/permission failures; original durable data survived and no empty
  replacement collection was presented. Both upgrades also ran the new text
  cases, gesture checks, commit matrices (32 IDB / 16 OPFS), actual recovery-view
  lifecycle cases (16 IDB / 12 OPFS), and runtime COMMIT-worker checks.
- Mocked Drive checks passed on both backends: equal-hash unreadable format 1
  archives receive new readable format 2/3 copies, old files remain, repeat sync
  skips upload and empty recovery preserves exact data. Final Safari backup,
  authorization and diagnostics suites passed. Final Firefox backup and diagnostic
  suites also passed, including exact round trips and unchanged revisions/recoveries.
- Local production `drive-isolation.mjs` passed `/CoffeeOS/` assets/startup,
  previous service-worker update and main/helper isolation. Direct dev and preview
  requests returned HTTP 200, COOP `same-origin`, COEP `require-corp`. Build and
  `git diff --check` passed. Raw logs are in ignored `.cache/stage47-*`.
- Physical iPhone/iPad touch/viewport, Home Screen/storage lifecycle, Safari OPFS,
  live Google and deployed-host behavior remain unverified. No normal browser
  profile, real collection, real Google upload, deployment or commit was used.

- Restored the tracked example archive byte-for-byte after backup tests. Final
  build and diff whitespace checks passed. Stopped the local dev/preview servers,
  Safari WebDriver and the isolated headless Firefox process. Existing user edits
  remain uncommitted; no outstanding local acceptance gate remains for this stage.
