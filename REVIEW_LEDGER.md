# CoffeeOS review ledger

The reviewer owns review events in this ledger. Record actual inspection only,
including partial work with its exact inspected subset and remaining gaps.
Coverage records inspection, not absence of bugs. Preserve previous endpoints,
findings and decisions; append follow-up/correction events rather than replacing
them. Update report links when archiving `REVIEW.md`; carry unresolved finding IDs
and source links into the new report. Never add a planned range as reviewed.

For ordinary ranges, **base is exclusive and head is inclusive**. `ROOT` includes
the first commit, `ffceed36cfcb9f1086195b6dfc9f62dc7593fa97`. Store full SHAs.
Only independent, complete, contiguous committed range reviews (plus the existing
legacy inference) advance the last covered head. Findings may remain open on an
inspected range. Snapshot audits, working-tree observations, self-checks and scoped
rechecks do not extend that boundary. Check ancestry against the candidate and
account for all merged work; another branch's endpoint is not automatically usable.

For each new row record event ID/date/reviewer, kind and completeness in the event
and scope columns, full base/head SHAs when applicable, disposition and a report
link. Use `—` for a non-range base. A dirty target needs its snapshot fingerprint
in the linked report; its HEAD alone is not the reviewed content. Separate any
committed coverage established in the same task from provisional dirty results.
A sign-off names its exact committed target and scope in the report; it is neither
full-suite acceptance nor deployment approval. Missing coverage remains a gap,
even when a later fix is signed off.

| Review/event | Base (exclusive) | Head (inclusive) | Coverage/scope | Decision/sign-off | Evidence |
| --- | --- | --- | --- | --- | --- |
| LEGACY-20261029 (imported 2026-10-30) | ROOT | deaa0d068a927db543707f394f1cea263f4102fe | Inferred legacy; beginning through Stage 52 offline completion | Historical fixes and desktop acceptance recorded; independent sign-off not inferred | [Original review](docs/code-review-2026-10-28.md), [follow-up review](docs/remediation-followup-review-2026-10-28.md), [updated handover](docs/remediation-handover-2026-10-28.md) |

## Legacy boundary evidence

The initial workflow draft records user authorization for eager, right-inclusive
inference for older work; this revision preserves that baseline. The original
review identifies base `35ab417`; the follow-up covers its remediation and the
Stage 47 legacy-text/pointer issues. The handover continues through **Stage 52,
completed 2026-10-29**, explicitly describing verified offline reopening, shell
integrity, failure preservation and populated upgrades. Its filename retains the
older October 28 date; its latest contents establish the later feature boundary.

`git log --format='%H %cI %s' -- docs/remediation-handover-2026-10-28.md`
maps that last update to `deaa0d068a927db543707f394f1cea263f4102fe`, committed
**2026-10-29T07:04:27+01:00** (`offline mode`). The stored Git committer timestamp
is the commit metadata used for the comparison; a live GitHub API fetch was
unavailable during import. Include that commit and all its ancestors. Its immediate
successor introduces WebP/photo work absent from the handover, so the content
narrows a date-only end-of-day cutoff to the offline completion commit.

This is a one-time historical inference used as a starting boundary, not evidence
that every ancestral commit was independently inspected, that Stage 52 received a
new independent review, or that remaining device/live-service gaps passed. Do not
extend this inference using timestamps or implementation handovers. Future rows
must identify actual inspected ranges, report links, reviewer/date and findings
or recheck decisions. See [reviewer instructions](AGENTS_reviewer.md).
