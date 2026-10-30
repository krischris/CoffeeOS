# CoffeeOS review

Status: **Not started**. This is a report template, not a review result.
See [reviewer instructions](AGENTS_reviewer.md) for the workflow and
[REVIEW_LEDGER.md](REVIEW_LEDGER.md) for historical coverage.

## Scope

- Review ID/date/reviewer: not assigned. Record model only if known.
- Independence: independent review or self-check; disclose implementation involvement.
- Kind: committed range, working-tree review, snapshot audit or scoped recheck.
- Target: branch/detached state, full base/head SHAs, and any working/staged snapshot
  fingerprint. State base exclusive/head inclusive, or use ROOT when applicable.
- Included/excluded scope: requested target, subsystems/commits inspected and gaps.
- Inspection: not started / partial / complete for the declared scope.
- Disposition: pending / changes requested / no confirmed findings / incomplete.
  Record any independent sign-off separately below.

## Confirmed findings

No review performed yet. List findings by priority, using the original ID when
carrying a finding forward. Include unresolved findings from earlier reports,
fixes awaiting recheck and user-deferred risks, with source links and status.

For each new finding include ID, priority, title, source revision/path/lines,
trigger, impact, expected/actual behavior, reproduction with observed output or
labeled static proof, fix direction and regression acceptance criterion. Reference
an owning plan stage when known. Evidence must be usable without local cache files.

## Investigations and limitations

Record unconfirmed questions and the evidence needed to resolve them. List scope,
setup and verification gaps; distinguish desktop, physical-device and live-service
coverage. An empty findings section does not erase these limitations.

## Checks and evidence

No reviewer checks have been run for this template. For each actual check record
command, target snapshot, environment, result and optional local artifact path.
Record skipped checks with reasons and the final target/fingerprint comparison.

## Implementer handoff

Append dated entries keyed by finding ID: fix commit or uncommitted files,
maintained regression coverage, focused results and remaining gaps. Preserve the
original evidence. Use **implemented; awaiting reviewer recheck** for fix claims;
record disagreements with counterevidence rather than removing findings.

## Reviewer recheck and sign-off

No recheck or sign-off has occurred. Append reviewer/date, independence, exact
committed head (or provisional working snapshot), per-finding disposition and
supporting results. Cite user decisions for accepted/deferred risks. State the
scope and limitations of any independent sign-off and link its ledger event.
A scoped fix recheck does not approve unrelated changes or extend range coverage.
