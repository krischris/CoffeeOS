# Codebase review — 2026-10-28

Reviewed the working tree based on `35ab417`, including the uncommitted Stage 42
swipe changes. This is a review and implementation handoff, not a fix. The
existing application edits were preserved. Stage 43 in [PLAN.md](../PLAN.md)
tracks remediation.

Implementation follow-up: R1–R7 and both investigations are implemented in
Stage 44; Stage 45 recorded final desktop acceptance. The independent
[Stage 46 follow-up review](remediation-followup-review-2026-10-28.md) confirms the
original fixes and records two follow-up gaps plus native-pointer evidence;
Stage 47 implements those follow-up fixes.
The [handover](remediation-handover-2026-10-28.md) retains implementation results.
The findings below retain the original review evidence.

## Findings and implementation order

P1 means a data-integrity issue to fix first. P2 means a concrete correctness or
performance issue for the follow-up implementation. All seven findings below
were reproduced in isolated desktop Safari 27.2 on localhost, using IndexedDB
and synthetic collections. Google authorization and transport were mocked;
no real account, upload, or normal browser collection was used.

| ID | Priority | Finding | Owning stages |
| --- | --- | --- | --- |
| R1 | P1 | Failed ordinary SQL commits publish changed IndexedDB snapshots | 2, 5, 6, 7, 15, 16, 32 |
| R2 | P2 | Cancelling empty-collection Drive recovery can still commit without refreshing views | 24, 25 |
| R3 | P2 | Bean deletion's durability warning is inside a hidden form | 7, 32 |
| R4 | P2 | Account-switch confirmation is lost when reloading before authorization | 25, 41 |
| R5 | P2 | An open bean editor silently overwrites a newer imported record | 22, 25, 32 |
| R6 | P2 | Accepted legacy photos can produce backups the app cannot import | 9, 22 |
| R7 | P2 | Every bean refresh eagerly builds every collapsed brew history | 3, 4, 11, 21 |

### R1 — Coordinate IndexedDB publication for every write

**Locations:** [db.ts:443](../src/db.ts#L443), `write()`;
[db.ts:508](../src/db.ts#L508), `deleteBean()`;
[db.ts:989](../src/db.ts#L989), the non-archive `processImport()` branch.
Compare the existing `commitArchiveImport()` at line 769.

Ordinary writes persist `tables-v1` using a completed IndexedDB transaction
*before* asking DuckDB to COMMIT. If COMMIT rejects, ROLLBACK restores the live
tables, but the saved snapshot still contains the rejected edit/deletion/import.
Reopening restores that snapshot. The UI reports a retryable failure and can
claim the data was preserved even though reload will expose a different dataset.

**Reproduction:** Seed a bean and linked session in Safari/IndexedDB. Save the
current records. Temporarily wrap the installed
`AsyncDuckDBConnection.prototype.query` to reject `sql === 'COMMIT'` without
forwarding it, while forwarding all other queries. Perform a write, restore
the wrapper, compare live records, then `await closeDB(); await initDB();` and
compare again. Use isolated test storage only.

| Tested operation | Rejected | Live records unchanged | Records unchanged after reopen |
| --- | --- | --- | --- |
| `addBean` | Yes | Yes | **No** |
| `updateBean` | Yes | Yes | **No** |
| `deleteBean` with a linked session | Yes | Yes | **No** |
| `deleteBrewSession` | Yes | Yes | **No** |
| `importData` overwriting a bean from CSV | Yes | Yes | **No** |

This is a deterministic injected-failure reproduction, not evidence that normal
SQL commits fail frequently. It exposes a real mismatch in the failure contract.
Archive imports already cover this case; ordinary-write tests generally inject
COPY failure on IndexedDB and COMMIT failure only on OPFS, missing this ordering.

**Fix direction:** Generalize the coordinated archive commit mechanism and use
it for all three paths. Preserve the distinction between a pre-commit failure
and a committed write whose durability could not be confirmed. Do not fix this
by simply reversing the two commits: that would create the opposite failure
window. Ensure committed-warning paths increment collection revision exactly
once and never run an invalid ROLLBACK over the original error.

**Regression gate:** Test bean/session add, update and delete, cascading bean
delete, and legacy CSV/Parquet imports. Inject SQL COMMIT rejection after snapshot
capture, IndexedDB put failure, transaction abort, and post-SQL-commit IndexedDB
abort. Compare exact records and durable snapshots, reopen, and verify retry
behavior. Extend the existing archive tests rather than weakening them. Run
populated previous-build IndexedDB and OPFS upgrades and historical imports.

### R2 — Make the local recovery commit boundary explicit

**Locations:** [driveView.ts:148](../src/views/driveView.ts#L148), `synchronize()`;
[driveView.ts:205](../src/views/driveView.ts#L205), Cancel;
[db.ts:989](../src/db.ts#L989), the last abort check before `commitArchiveImport()`;
[drive.ts:283](../src/drive.ts#L283), empty recovery.

Manual merge/replace sets `committing = true`, but automatic recovery into an
empty collection does not. Cancel and Disconnect remain enabled while its
commit is running. The database checks the abort signal before entering the
commit helper, then commits even if cancellation arrives inside that helper.
The view's subsequent `signal.throwIfAborted()` prevents `onImported()` from
refreshing the visible collection. Its generation guard also discards the old
operation's completion/error, potentially hiding a committed durability warning.

**Reproduction:** Start with empty isolated storage and mock Drive history/media
using `docs/fixtures/example-v1.coffeeos`. Wrap SQL COMMIT with a manually released
promise. Start Sync, wait until the COMMIT wrapper is reached, click Cancel, then
release COMMIT. Observed: Cancel was visible and enabled; the database contained
**3 beans and 2 sessions** afterward; the refresh callback ran **zero** times;
the status said “Transfer cancelled” and discussed only files accepted by Drive.

**Fix direction:** Give empty recovery the same explicit apply/commit lifecycle
as manual restore. Cancellation before apply must preserve emptiness; once
committing, report the real result and refresh views even if the network
operation is cancelled. Handle committed warnings separately. Do not attempt
to undo a completed local commit or silently switch datasets.

**Regression gate:** Cancel/Disconnect before staging, during snapshot capture,
at COMMIT, and after COMMIT, including injected flush/IDB failures. Assert exact
stored records, accurate status, refreshed counts, and no spurious retry/upload.
Cover both backends and the actual view, not only the `recoverEmptyBackup` API.

### R3 — Keep deletion durability warnings visible outside the bean editor

**Location:** [beanManager.ts:364](../src/views/beanManager.ts#L364).

The committed-delete catch refreshes the list, removing the affected row, and
sets the form-level `error`. That element belongs to `.bean-form`, which is
normally hidden when deleting a bean. Consequently the only warning telling
the user to export before closing is invisible.

**Reproduction:** With the bean form closed, inject a rejection from
`AsyncDuckDB.prototype.flushFiles`, then delete a bean through its menu. The
warning text exists and its own `hidden` property is false, but its parent form
has `hidden = true` and the warning has no client rectangles. The deletion has
already been applied.

**Fix direction:** Use a persistent collection-level alert outside the
collapsible form and rows. Preserve it across the refresh that follows a
committed failure; do not suggest retrying the deletion.

**Regression gate:** Assert *rendered visibility* and accessible alert semantics
with the form closed and with a bean expanded. Test both ordinary failure/retry
and committed-warning paths. Checking `.hidden` alone is insufficient.

### R4 — Preserve the pending account-switch decision independently of a token

**Locations:** [driveView.ts:52](../src/views/driveView.ts#L52), state defaults;
[driveView.ts:58](../src/views/driveView.ts#L58), `restore()`;
[driveView.ts:214](../src/views/driveView.ts#L214), Switch account;
[driveAuthorization.ts:26](../src/driveAuthorization.ts#L26), cache restoration.

Switch account deletes cached authorization and stores `switching = true` only
in memory. Reload before completing the next authorization loses that flag.
The next Connect follows the ordinary connect-and-sync path rather than asking
the user to enable backup to the newly displayed account. This contradicts the
Stage 41 and Drive-help promise that pending switch confirmation survives reload.
Existing tests reload only *after* the new account has been cached with
`enabled: false`, leaving the earlier interval uncovered.

**Reproduction:** Seed a remembered account and a nonempty collection. Click
Switch account, reload, then complete mocked authorization for a different
account. Observed three Drive reads followed by a **POST to create the backup
folder**, without an Enable confirmation. The mock deliberately did not return
a folder ID, so no actual archive upload occurred. Source flow continues to
upload when folder creation succeeds.

**Fix direction:** Retain pending switch intent separately from expiring or
cleared credential material, or otherwise require confirmation safely when
that state cannot be recovered. Preserve explicit Disconnect semantics and
ordinary first-connection behavior. Do not store tokens in collection metadata.

**Regression gate:** Reload before new authorization, after authorization but
before Enable, and after the unenabled token expires/is invalidated. Cover
denied/quota-limited credential storage and back/forward cache. No Drive
read/create/upload/restore may run until the required confirmation.

### R5 — Reject stale editor saves that overwrite imported changes

**Locations:** [beanManager.ts:294](../src/views/beanManager.ts#L294), edit prefill;
[beanManager.ts:412](../src/views/beanManager.ts#L412), save;
[db.ts:482](../src/db.ts#L482), `updateBean()`;
[main.ts:117](../src/main.ts#L117), post-import refresh.

A bean draft remains open while navigating to IO and importing records. Refresh
replaces the list but retains the editor's original values. Saving that draft
writes all editable fields; `updateBean` checks only that the ID exists. A
successful newer import can therefore be silently overwritten, including its
photo/dates, even if the user changes nothing in the old draft.

**Reproduction:** Open Edit for the fixture bean named `Photo`. Navigate to IO
and import a CSV changing the same ID to `Imported replacement name`. Return to
Bean Manager and save the still-open editor without changing its contents.
Observed stored names: `Photo` → `Imported replacement name` → `Photo`.
The probe invoked `importData` directly while IO was selected; the UI import
callback refreshes lists but does not invalidate the draft either.

**Fix direction:** Capture a record version/original state when editing and
check it atomically in the serialized database operation before update. If the
record changed, preserve the draft and ask for review/reload rather than
overwriting silently. Avoid treating unrelated edits as changes to this record
if practical. Audit session editing for the same interaction with an already
running asynchronous Drive import.

**Regression gate:** Open a draft, merge/replace its ID, and attempt a stale save;
the imported record must remain intact until an explicit conflict decision.
Cover photo/null/date changes, deletion of the edited ID, unrelated imports and
normal unchanged saves with exact precision preservation.

### R6 — Align accepted data with backup readability without discarding old bytes

**Locations:** [photos.ts:2](../src/photos.ts#L2), `isBeanPhoto()`;
[db.ts:919](../src/db.ts#L919), import photo checks;
[db.ts:1006](../src/db.ts#L1006), `validPhotoEncoding()`;
[backups.ts:66](../src/backups.ts#L66), packaging.

Legacy CSV/Parquet imports and bean writes accept a JPEG-prefix/base64-shaped
string without checking the encoding or end marker. Archive validation adds
those checks. Export packages the records without applying the archive reader's
logical validation, so an accepted collection can produce an unreadable backup.
This needs crafted/damaged legacy data; normal canvas-compressed photos were
not shown to trigger it.

**Reproduction:** Import a bean CSV with
`photo_jpeg = data:image/jpeg;base64,/9j/`. The legacy import succeeds. Save a
`.coffeeos` backup; export succeeds. Immediately call `prepareBackup` on those
same bytes: it rejects with “The beans file contains an invalid JPEG photo.”
One such bean prevents restoring the whole archive.

**Fix direction:** Validate new input consistently. Existing saved/previously
exported values need a deliberate compatibility/recovery path retaining their
original bytes; tightening startup validation or dropping the photo would
violate preservation requirements. Never label an export as a usable backup
if the matching reader cannot consume it. Resolve archive-contract compatibility
explicitly if supporting previously accepted opaque photo values requires it.

**Regression gate:** Cover truncated/malformed JPEG encoding, valid old photos,
existing stored malformed values, and historical CSV/Parquet exports. Assert
that a newly accepted collection has a readable backup and that an existing
collection is never cleared, silently rewritten or made inaccessible by a fix.

### R7 — Render brew histories on demand

**Locations:** [beanManager.ts:69](../src/views/beanManager.ts#L69), history DOM;
[beanManager.ts:350](../src/views/beanManager.ts#L350), refresh;
[brewController.ts:117](../src/views/brewController.ts#L117), save callback contract;
[main.ts:107](../src/main.ts#L107), refreshing Bean Manager after every saved brew.

Every refresh loads every session and constructs its full metrics DOM, even
with every bean collapsed or the entire Bean Manager hidden. Each saved brew
also refreshes this hidden view. The session feed independently rebuilds its
whole list. This is avoidable work proportional to the entire journal on an
ordinary save/tab visit; lazy image loading does not avoid constructing histories.

**Measurement:** With 1,000 added synthetic sessions plus three remaining probe
sessions, a fully collapsed Bean Manager contained **1,003 history rows and
31,163 descendant elements**. Trigger-to-observed-refresh completion was about
**88 ms on desktop Safari** (includes automation polling; not an isolated render
benchmark). No physical iPhone timing or memory measurement is claimed.

**Fix direction:** Fetch counts for collapsed rows; load/render a bean's history
when opened, with bounded rendering/pagination for long histories. Refresh or
invalidate visible views after writes and defer hidden-view work until needed.
Use appropriate cache invalidation so imports, renames and deletions remain
correct. Preserve sorting, keyboard navigation, scroll restoration and swipe
behavior; do not solve this by deleting/limiting stored history.

**Regression gate:** A collapsed 1,000-session collection must not allocate one
metrics subtree per stored session. Verify that opening histories still reaches
every session in the right order, and that save/import/delete updates counts
and visible data. Record before/after node counts and comparable timings; leave
physical iOS performance as an explicit device gate.

## Additional areas to investigate, not counted as reproduced findings

- `listImportRecoveries()` (`db.ts:727–746`) opens a value cursor and accesses
  `cursor.value` for every full Parquet recovery record just to read its date.
  `createIOView()` calls this during initial mounting, inside the shared database
  queue. Cost grows with all retained recovery payloads, even before visiting IO.
  Profile multiple photo-heavy recovery copies; consider additive lightweight
  metadata and lazy listing while preserving all existing recovery keys/bytes.
  No large-recovery benchmark was run in this review.
- `createEngine()` removes its worker-error listeners after instantiation. The
  installed DuckDB client's `onError` clears pending requests without rejecting
  them. A later worker failure can therefore leave the serialized queue and
  saving UI pending. Startup tests cover a different phase. Add post-startup
  worker-failure injection before designing a recovery response; never reopen an
  empty database or encourage a retry when commit outcome is unknown. Runtime
  failure behavior was inspected in the installed SDK but not fault-tested here.

## Review coverage and verification

- Read all application TypeScript modules and CSS, HTML/public scripts, manifest,
  Vite configuration, dependency declarations, deployment workflow, storage and
  backup/Drive documentation, and the relevant test harnesses/checks. This was
  application-source review, not a line-by-line audit of vendored Wasm or every
  transitive dependency, and not a live OAuth/provider audit.
- Confirmed Node resolves to this project's `.venv/bin/node`.
- `uv run npm run build`, `uv run npm run test:safari`,
  `uv run npm run test:drive:authorization`, and `uv run npm run test:drive`
  passed. Drive checks included 31 simulated adapter checks, fingerprints,
  merge/replacement/recovery and reload. The existing
  Safari suite covers startup/navigation, writes/reload, older backup formats,
  editor/layout/chart behavior and Stage 42 swipes; its passing result does not
  negate the focused failures above.
- `uv run node tests/drive-isolation.mjs` passed the local production `/CoffeeOS/`
  startup/assets and main/helper isolation boundary. Direct dev/preview response
  checks confirmed COOP `same-origin` and COEP `require-corp`; helper exceptions
  passed separately. `git diff --check` passed. These are local-host checks.
- Temporary reproduction scripts/results are retained locally under
  `.cache/review-probes.{mjs,json}` and `.cache/review-edge-cases.{mjs,json}`.
  The descriptions and regression gates above are self-contained; ignored cache
  artifacts are not required by a future checkout. All injected failures/mock
  transports were scoped to disposable automation sessions.
- No application, dependency, schema, storage identity, service worker, origin
  or deployment change was made for this review. No populated previous-build
  upgrade was rerun: that is a mandatory gate for the storage/startup fixes,
  not something established by same-build reloads in these probes.
- Physical iPhone/iPad, Home Screen/storage lifecycle, Safari OPFS, a fresh
  Firefox/OPFS regression pass, live Google, and deployed-host behavior remain
  unverified by this review. Existing dated evidence in PLAN.md is historical,
  not a new pass.
