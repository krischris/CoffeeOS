# Remediation follow-up review — 2026-10-28

**Remediation follow-up:** Stage 47 fixes F1 and F2; desktop acceptance passed
on Safari/IndexedDB and Firefox/OPFS. Historical text now has
an explicit preserving import option and readable format 3 exports; default new
imports reject it. Off-row releases and window interruptions clear gesture state.
Safari's native harness activates its test window and distinguishes missing input
from synchronous feedback. See [PLAN Stage 47](../PLAN.md#stage-47-preserve-legacy-text-backups--complete-pointer-cleanup)
for acceptance evidence. The findings below retain the original review record.

The original R1–R7 reproductions have substantive fixes, and both additional
investigations have working implementations. The original photo-specific R6 case
is fixed, but its broader “accepted data produces a readable backup” gate still
has a gap. Two P2 findings remain below. This is an independent review, not an
application fix; all pre-existing uncommitted work is preserved.

## Findings

### F1 — P2: Legacy imports can still make the collection unbackable

**Locations:** [db.ts:978–982](../src/db.ts#L978),
[backups.ts:59–63](../src/backups.ts#L59).

Legacy CSV/Parquet imports only apply `length(trim(...))` to required text fields;
the broader whitespace rejection is conditional on `archive`. A quoted tab-only
bean name or ID passes legacy import. The new export-time `previewBackupData`
uses archive validation and rejects the same stored record, preventing a backup
of the entire collection. This also affects packaging recovery copies and new
Drive uploads. Format 2 only relaxes photo validation and does not cover this.

**Reproduced in isolated Safari 27.2 / IndexedDB:** both `{id: "tab-name",
name: "\t"}` and `{id: "\t", name: "ordinary"}` imported successfully, then
`saveBackup()` rejected with “The beans file contains invalid values or duplicate
IDs.” Here `\t` means one actual tab, not a backslash followed by `t`. No data was
lost in the probe. This is a remaining validation/compatibility mismatch related
to R6, rather than a failure of its JPEG preservation path.

Minimal API reproduction in a disposable dev session:

```js
const db = await import('/src/db.ts');
const backups = await import('/src/backups.ts');
const csv = 'id,name,roast_date,freeze_date,created_at\n' +
  'tab-name,"\t",\\N,\\N,2024-01-02T03:04:05.123456Z\n';
await db.importData([{target: 'beans', name: 'beans.csv',
  data: new TextEncoder().encode(csv)}]); // succeeds
await backups.saveBackup(); // rejects
```

**Fix/gate:** align new-input validation with archive rules, and provide a
versioned, byte-preserving path for already stored/previously exported affected
records. Do not trim IDs, replace names, delete records or tighten startup
validation. Test tab/newline/Unicode whitespace across IDs, names and foreign keys,
CSV and Parquet, historical stored data, linked sessions, local/Drive exports and
immutable recovery downloads. Verify populated upgrades on both backends for any
storage/format fix. Rejecting new imports alone does not recover existing users.

### F2 — P2: Releasing outside a row leaves a stale gesture and loses the next swipe

**Locations:** [swipeRow.ts:27–28](../src/views/swipeRow.ts#L27),
[swipeRow.ts:39–48](../src/views/swipeRow.ts#L39),
[swipeRow.ts:62–71](../src/views/swipeRow.ts#L62).

The row acquires pointer capture only after horizontal intent. Before that,
`pointerup`/`pointercancel` are listened for only on the surface. Press near an
edge and release just outside it: the surface misses the release and keeps its
`gesture` and `is-pressed` state. The next press takes the existing-gesture branch,
clears the old gesture and returns without starting a new one.

**Trusted Safari mouse reproduction on an actual session row:**

1. Press one pixel inside the bottom of `.session-surface`.
2. Move just outside its bottom and release before horizontal capture.
3. Move back into the row and press again.

The native trace recorded `pointerdown` on `session-summary` at `(199,487)`, then
`pointermove` and `pointerup` on `app-content` at `(199,492)`. The row was still
pressed after release. The next trusted `pointerdown` on the summary cleared
`is-pressed` instead of starting a gesture. A synthetic off-row release confirmed
the same state transitions. A second native reproduction also moved 60 pixels
left on the next press: the row stayed at offset zero and no action was revealed.
Both row kinds share this handler; the native
reproduction used the session row. Physical iOS touch is not established by this
mouse result; touch's implicit capture is a separate path.

**Fix/gate:** terminate pending gestures on outside release/cancellation and
window interruption, using temporary scoped listeners or capture that preserves
the existing scroll/selection/multitouch behavior. Remove any temporary listeners
on every exit. Add trusted off-row release and subsequent-swipe regressions;
retain exact live movement, capture, vertical scrolling and data-preservation
assertions. Do not treat the next normal press as a second simultaneous contact.

## The handover's intermittent pointer assertion

A fresh full Safari suite passed. Repeating the existing swipe checks then failed
on the second bean/session cycle at the same trusted-contact assertion described
in the handover. The trace at failure was **empty**: neither trusted pointer nor
mouse events reached the document after successful WebDriver move/down responses.
The row was clean beforehand, the hit target was the expected bean summary and
selection was empty.

That localizes this observed failure to native input delivery/automation before
the CoffeeOS handler, not a delivered press that the handler rejected. It does
not establish whether Safari/WebDriver lost or delayed the events, or whether
window activation was involved. The exact underlying cause remains unconfirmed.
Forty cycles with an extra state observation passed; that timing-sensitive result
is not proof of a fix. Another ten cycles preserving the original first-state-read
timing also passed, so the two-second delayed-event diagnostic added for that run
was never exercised. Lost versus delayed delivery remains unresolved.
F2 is a separately reproduced application defect and does
not explain an empty document event trace.

A useful harness follow-up is to distinguish “native pointerdown never arrived”
from “pointerdown arrived but did not set pressed.” Observe the state at the end
of that event dispatch and retain the immediate-feedback assertion. Do not hide
this by retrying gestures or merely waiting for `is-pressed` to become true.

## Original findings and investigations

| Item | Disposition and evidence |
| --- | --- |
| R1: snapshot before rejected SQL commit | Fixed for the original cases: ordinary writes, cascading delete and legacy imports share `commitTransaction`; fresh 32-case IndexedDB matrix passed, including SQL rejection, put/abort and post-commit abort, revisions, retry and reopen. Audited prior OPFS matrix/upgrade evidence. |
| R2: cancelled empty recovery conceals commit | Fixed: explicit `onCommit` boundary disables Cancel/Disconnect, committed outcomes refresh views. Fresh actual-view 16-case IndexedDB lifecycle matrix passed. |
| R3: hidden deletion durability warning | Fixed: collection-level alert outside the editor. Fresh rendered-geometry/alert-semantics check passed with the editor closed; expanded-view CSS keeps the alert above the overlay. |
| R4: pre-authorization switch reload | Fixed: independent token-free decision marker and conservative storage failure behavior. Fresh authorization suite passed pre/post-authorization reload, expiry/invalidation and storage-failure checks. BFCache test simulates page lifecycle events; it is not a physical iOS lifecycle pass. |
| R5: stale draft overwrites import | Fixed: serialized record-local original-version checks, including raw timestamp distinctions. Fresh API and actual draft tests passed; beans and sessions both pass original versions. |
| R6: malformed legacy photo breaks own backup | Original photo case fixed: consistent new-photo validation, explicit old-byte preservation, readable format 2, and documented recovery for old malformed format 1. Fresh photo/CSV/Parquet/reopen checks passed. Broader input/export consistency remains open as F1. |
| R7: eager collapsed histories | Fixed for the reported path: counts plus on-demand 50-row pages and deferred hidden-view refresh. Fresh 1,000-session test created zero collapsed history rows and reached every ordered page. |
| Recovery listing | Implemented: lazy IO listing and additive metadata avoid payload reads after indexing. Fresh test measured zero payload reads versus 4,675,667 bytes in the baseline scan; original recovery records remain intact. |
| Runtime worker failure | Implemented: pending callers reject, engine quarantines, unknown COMMIT reports honestly and IDB keepalive aborts. Fresh pending-read/editor/COMMIT/reopen checks passed. |

## Verification and limits

- Project-local Node confirmed. `uv run npm run build` and full
  `uv run npm run test:safari` passed in isolated desktop Safari 27.2 / IndexedDB.
- `uv run npm run test:drive:authorization` and
  `TEST_REVIEW_ONLY=recovery uv run npm run test:review` passed. Google behavior was
  simulated; no real account or collection was used.
- `uv run node tests/drive-isolation.mjs` passed local production `/CoffeeOS/`
  assets/startup, previous service-worker update and main/helper isolation.
  Direct dev/preview requests returned HTTP 200, COOP `same-origin` and COEP
  `require-corp`. Final build and `git diff --check` passed.
- Audited Stage 45 test sources and raw logs for populated `35ab417` upgrades at
  the same `/CoffeeOS/` origin/profile on Safari/IndexedDB and Firefox/OPFS,
  historical backups, failed-startup preservation and Drive checks. Those are
  previous implementation-session results, not new upgrade/Firefox runs here.
- This review changes documentation only. Application code, dependencies, schema,
  storage identity, deployment origin and existing fixtures remain unchanged.
- Physical iPhone/iPad, Home Screen/storage lifecycle, Safari OPFS, live Google
  and deployed-host behavior remain unverified. Native mouse checks do not certify
  iOS touch behavior.
- Raw review logs and disposable probes are under ignored `.cache/stage46-*`.
  Reproduction steps above are retained independently of that cache.
