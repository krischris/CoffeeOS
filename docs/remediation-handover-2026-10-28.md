# Review remediation handover — 2026-10-28

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
