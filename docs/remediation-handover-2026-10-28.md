# Review remediation handover — 2026-10-28

**Latest follow-up — Stage 51, 2026-10-28:** Permanent restore-fixture diagnostics
now identify each format/layout and lifecycle phase, mock storage calls and
isolation state. Body and cleanup errors retain separate messages/stacks; failed
close or override restoration prevents reopening with incomplete cleanup. Seven
injected fault/success scenarios, the full isolated desktop Safari 27.2 suite,
production `/CoffeeOS/` checks, build and whitespace checks passed. Production
storage/startup code and guards are unchanged. The original error did not recur;
its cause remains unresolved. See
[Stage 51](../PLAN.md#stage-51-preserve-safari-restore-fixture-failure-diagnostics)
for evidence and environment gaps. The Stage 50 investigation below remains valid
as historical evidence; its temporary diagnostics now have a tracked counterpart
in `tests/io-checks.mjs`.

**Latest investigation — Stage 50, 2026-10-28:** The failure below did not
reproduce. A temporary instrumented full Safari 27.2 run and a separate unchanged
`uv run npm run test:safari` both passed, including subsequent remediation checks.
Diagnostics confirmed four fresh test IndexedDB stores, mocked OPFS inspection,
isolation disabled during each restore case, successful cleanup reopening and
unchanged original automation records. Build and diff checks passed. No application
or tracked test code was changed; no root cause or fix is claimed. The historical
stack cannot distinguish fixture initialization from cleanup reopening, which can
also mask an earlier error. Retain both errors separately on the next reproduction.
See [Stage 50](../PLAN.md#stage-50-investigate-the-reported-safari-restore-fixture-failure)
for evidence and local diagnostic artifacts. The Stage 48/49 handoff below is
preserved as historical context; its data-preservation constraints still apply.

## Next worker: investigate Safari backup-fixture failure

Stage 48 fixed vertical drift cancelling horizontal bean/session swipes in
`src/views/swipeRow.ts`; preserve that change and its regression checks.
Build, focused Safari 27.2 gestures and production `/CoffeeOS/` checks passed.
Physical iPhone touch remains unverified.

The full `uv run npm run test:safari` stopped at `tests/io-checks.mjs:149`, in
the empty-database CSV/Parquet restore fixture, with:
“Your saved coffee database needs OPFS and cross-origin isolation.”
Earlier startup, writes/reloads, swipe and backup roundtrip checks passed;
later remediation checks did not run. Log: `.cache/stage48-safari.log`
(ignored/local; may be absent in another checkout).

Suspect fixture isolation/setup, **not yet confirmed**. Inspect its overrides of
`indexedDB`, `navigator.storage.getDirectory` and `crossOriginIsolated`, each loop
iteration and cleanup/reopen. Trace whether the failure is in fixture startup or
cleanup, and where OPFS detection/backend metadata comes from. Keep the production
guard: never bypass it, clear real storage or silently open an empty replacement.

Reproduce in isolated Safari, fix the confirmed cause and rerun the full suite
plus `uv run npm run build`. Use the existing `.venv` and `uv run` commands;
start Vite and `safaridriver -p 4444` first (both were stopped after Stage 48).
Record the fix as the next stage after Stage 49 in `PLAN.md`. If production
storage/startup changes are necessary, run the mandatory populated previous-build
upgrade checks on both backends. Historical acceptance below remains unchanged.

**Stage 47 follow-up:** the two P2 issues found in the independent review are
complete, with desktop acceptance passed on Safari/IndexedDB and Firefox/OPFS.
New legacy imports reject whitespace-only required fields; explicit
historical preservation and format 3 backups retain original IDs, links and values.
Off-row releases/window interruptions clear stale pointer state. Native Safari
tests explicitly activate the automation window and distinguish absent input
from handler feedback. See [Stage 47](../PLAN.md#stage-47-preserve-legacy-text-backups--complete-pointer-cleanup)
for the current verification record and [the follow-up review](remediation-followup-review-2026-10-28.md)
for the original reproductions. The Stage 45 evidence below is historical.

R1–R7 and both additional investigations are implemented. **Stages 43–45 are
complete: final desktop acceptance passed on 2026-10-28.** Stage 45 records the
continuation's exact checks and remaining environment gaps. All work remains
uncommitted; existing Stage 42 edits and the Stage 43 review are preserved.

## Implemented

- **R1:** Ordinary writes, cascading deletes and legacy imports use the archive
  commit coordinator. Rejected SQL commits cannot publish candidate IDB snapshots;
  committed warnings advance revision once and avoid invalid rollback.
- **R2–R3:** Automatic Drive recovery enters a non-cancellable local apply phase,
  reports the actual result and refreshes views. Bean-delete warnings live outside
  the editor and rows.
- **R4:** A separate token-free switch marker survives reload/expiry/invalidation.
  If neither decision store can retain a switch, the current connection stays in
  place with a recoverable error. Ordinary first-connect behavior is retained.
- **R5:** Bean/session editors pass their original record to serialized update
  checks. In-memory versions retain raw timestamp/field distinctions; stale drafts
  stay open. Tests include microsecond-only, photo/null/date and deletion changes.
- **R6:** New photos/default imports use consistent validation. Explicit legacy
  import preserves previously accepted damaged bytes. Those collections export
  readable format 2 archives; healthy collections keep format 1. Drive replaces
  equal-hash unreadable old format 1 snapshots with a new preserving copy.
  See `docs/backup-format.md` for compatibility and recovery instructions.
- **R7:** Collapsed beans fetch counts; opened histories page through 50 sessions.
  Hidden views refresh on entry. All 1,000 fixture sessions remain reachable.
- **Investigations:** Recovery listing is lazy and reads additive small metadata;
  old immutable recovery keys/bytes survive indexing. Runtime worker failures
  reject pending callers and quarantine the engine with an unknown-outcome alert.
  A failure during COMMIT aborts the IDB keepalive transaction so reopening cannot
  hang or publish its candidate; no speculative rollback is issued.

## Implementation-session evidence

- Build and `git diff --check` pass. Full Safari smoke passed earlier; Safari and
  Firefox backup, Drive and authorization suites have passed during this work.
- Populated upgrades from **35ab417** passed at the same isolated `/CoffeeOS/`
  origin/profile on Safari/IndexedDB and Firefox/OPFS. Fixtures include historical
  CSV/Parquet, damaged photos accepted by the old build, old immutable recoveries,
  exact records/precision, reload and failed-startup preservation.
- Write failure matrices: **32 IDB / 16 OPFS** cases; Drive recovery actual-view
  lifecycle checks: **16 IDB / 12 OPFS** cases.
- Collapsed upgraded fixture: **0 history rows, 91 descendants**, versus the
  review's 1,003 rows / 31,163 descendants. Observed refreshes varied ~8–112 ms
  (Safari) and ~103–104 ms (Firefox), including automation polling; this is not a
  controlled speed benchmark. All 20 pages preserve exact order.
- Recovery profiling scanned ~3.2–4.9 MB of old-style payloads versus **zero
  payload reads** for indexed listing. Metadata lookup was sometimes slower at
  these fixture sizes; no general timing improvement is claimed.
- **Focused checks after the final COMMIT-worker fix:** build plus
  `TEST_REVIEW_ONLY=runtime uv run npm run test:review` and its `TEST_FIREFOX=1`
  counterpart passed, including actual pending SDK requests, saving UI settlement,
  unknown COMMIT outcome, no rollback and successful explicit reopen.

## Final acceptance — 2026-10-28

- Full Safari smoke/remediation passed twice. The first run reproduced the
  intermittent trusted session-pointer contact assertion. Added native-event
  diagnostics with listener cleanup; immediate press, exact live movement and
  capture assertions remain intact. Ten focused repetitions and the populated
  Safari upgrade passed too. The earlier failure's cause remains unconfirmed;
  retained diagnostics support investigation if it recurs. No production gesture
  behavior changed in this continuation.
- Populated upgrades from **35ab417** passed sequentially on Safari/IndexedDB and
  Firefox/OPFS against the final worker/keepalive source, preserving the same
  isolated `/CoffeeOS/` profile/origin. Exact records, old CSV/Parquet, damaged
  photos, immutable recoveries, reload and injected startup failures passed.
- Final backup, Drive, authorization and diagnostics suites passed on both
  browsers/backends. Firefox's full remediation suite also passed; both upgrade
  suites include commit matrices, actual recovery-view lifecycle and worker faults.
  The 1,000-session upgraded fixtures retain zero collapsed history rows and
  91 descendants, with every ordered history page reachable.
- Production `drive-isolation.mjs` passed `/CoffeeOS/` assets/startup, previous
  service-worker update, main/helper isolation and BroadcastChannel behavior.
  Dev/preview COOP/COEP headers passed; final build and `git diff --check` passed.
- `PLAN.md` Stage 43 task 9 and Stage 44 task 8/status are complete. Stage 45
  contains final evidence, measurements and the automation reliability note.
  Raw logs remain in ignored `.cache/stage45-*.log`.

## Remaining environment gaps

Physical iPhone/iPad touch/viewport behavior, Home Screen installation/storage
lifecycle, Safari OPFS, live Google authorization/transport and deployed-host
headers/behavior remain unverified. No deployment or real Google upload occurred.
The earlier intermittent Safari native-pointer assertion has no confirmed cause;
subsequent passes do not prove it cannot recur.

Storage identities, collection schema, dependencies and origin are unchanged;
archive format 2 and recovery metadata remain the deliberate additive compatibility
paths described above. The tracked example archive was restored byte-for-byte
after generated test output. No further local acceptance gate remains pending.

The Vite dev server (5173), production preview (4174), Safari WebDriver (4444) and
isolated Firefox (9223) used for final acceptance have been stopped. The isolated
Firefox profile remains in `.cache/firefox-stage44`. Use project-local `uv run`
tooling and isolated browser profiles for any future checks.
