# CoffeeOS reviewer instructions

Your job is to find consequential defects and give an implementer enough evidence
to fix them. Be skeptical of both the implementation and your first explanation.
Trace behavior, test counterexamples and revise claims when evidence disagrees.
There is no finding quota: a short, substantiated report is better than speculative
criticism. Use the model selected for the task; do not choose or claim another.

Review without fixing application/test code or running the full regression suite.
A review is independent only when its reviewer did not implement the changes
being assessed. If you authored them, label your work a **self-check** and hand off
independent sign-off to a separate reviewer task. Changing role labels or using
the same model in another role does not by itself establish independence.

## 1. Establish the scope

Read `REVIEW.md`, `REVIEW_LEDGER.md`, pending `TESTS.md`, and `PLAN.md`'s global
rules and relevant feature stages. Follow linked reports for unresolved findings.
Treat old reports and passing tests as leads, not proof of current correctness.

Honor the user's scope first. Otherwise use these defaults and state your choice:

| Request | Inspection scope |
| --- | --- |
| Review new changes / unspecified review | Commits since the ledger's last contiguous covered ancestor, plus current tracked changes and relevant untracked source/config/test files. |
| Review a specified range, PR or staged changes | Exactly that target, with surrounding code needed to assess it. Explicit scope overrides the defaults. |
| Whole-codebase review / broad audit | Current implementation across all major subsystems, including unchanged code. Map the subsystems and record what was inspected. |
| Recheck fixes | Original findings, the fixes and their affected invariants. This is not automatically a review of all intervening work. |

If no usable ledger baseline exists, use an explicit task base when supplied;
otherwise inspect the current codebase and record a snapshot audit. Do not guess
historical coverage from dates or create a new inferred baseline. Preserve the
existing, explicitly labeled legacy baseline in `REVIEW_LEDGER.md`.

Choose a unique ID such as `REV-20261030-01`. Record date (Europe/Zurich), reviewer
identity/model if known, independence, branch or detached state, full base/head
SHAs, scope/exclusions and `git status --short`. `base..head` excludes base and
includes head; `ROOT` includes the first commit. Check ancestry with
`git merge-base --is-ancestor <base> <head>`. For a range, inspect the net diff and
all commits reachable from head but not base, including merged work and merge
resolutions. A first-parent log alone is insufficient. Trace affected callers,
contracts and failure paths beyond the diff. Report defects present at the target,
not intermediate defects already fixed before it.

Pin the reviewed content before inspection. For a working-tree review, save
`git diff --binary HEAD` and its SHA-256 under `.cache/reviews/<review-id>/`, plus
a manifest of included untracked paths and SHA-256 hashes. For a staged-only
review use `git diff --cached --binary` instead. These patches do not include
untracked contents: retain copies of included files locally as needed for probes.
Exclude generated/cache/private files; state relevant exclusions. Distinguish
committed coverage from working-tree observations. Never claim checks against a
committed or staged target if they actually ran against different working files;
use an isolated copy when needed, without resetting or stashing the user's work.

At completion compare the target SHA and relevant file fingerprints again.
Recheck changes made during inspection, or report the original snapshot and the
remaining gap. Your own report/ledger edits do not invalidate code inspection.

## 2. Inspect behavior and gather evidence

Prioritize durability/data loss, backup and upgrade compatibility, failure and
race paths, account/authorization boundaries, and user-visible regressions.
Apply the data/storage/origin invariants in `PLAN.md`. For a broad audit, cover
storage/startup, imports/exports/recovery, Drive/auth, UI/state, offline/updates,
and build/deployment configuration; record omissions rather than implying coverage.
Read tests to understand what they actually establish and where they miss the risk.
Do not turn style preferences or hypothetical misuse into correctness findings.

Before confirming a defect, identify a reachable trigger, trace the complete path,
look for guards/recovery that disprove it, and establish concrete impact. Use the
smallest reproduction that resolves uncertainty. Runtime evidence is useful but
not mandatory: a complete static code-path proof is sufficient when clearly
labeled. Missing tests alone do not prove a bug; identify the uncovered behavior
and risk when requesting coverage. Merge duplicate symptoms of one root cause.

Honor explicit execution limits: if the user requests inspection only or no
commands/tests, do not run checks or probes. Record that limitation and continue
the permitted inspection. Otherwise use these basic checks when relevant to scope:

- `git diff --check <base> <head>` for a committed range; `git diff --check HEAD`
  for working changes, or `git diff --cached --check` for staged-only changes.
- `uv run npm run typecheck` for application/config changes or a broad code audit.
- `uv run npm run test:inventory` for test/harness changes or a broad code audit.

Record skipped checks with reasons. Reuse the existing `.venv` and dependencies;
direct Node/npm/npx commands always use `uv run`. If setup is unavailable, record
the blocker and continue static inspection rather than installing/upgrading tools.
Run a build only to investigate build/assets, and a narrowly selected test/probe
only to answer a concrete question. `--only` is not permission to run a large
matrix: check what the selection runs first. Do not run the full suite, broad
browser suites or the full-suite skill. `test:review` is a browser regression
suite, not the command for this role.

Keep temporary probes/logs under `.cache/reviews/<review-id>/`. Tracked outputs
are limited to `REVIEW.md`, `REVIEW_LEDGER.md` and `docs/reviews/` reports; do not
edit application/test code, dependencies, agent instructions, `TESTS.md` or
`PLAN.md`. Use synthetic data and disposable storage. Prefer a minimal Node probe;
if a browser is necessary, use isolated Safari and follow the test skill's
[browser permission guidance](.agents/skills/coffeeos-tests/SKILL.md#browser-execution-permissions).
Other browsers require explicit task authorization. Do not use normal browser
profiles/real accounts, commit changes or deploy. Stop processes you started.

## 3. Write the report and preserve continuity

`REVIEW.md` is the current handoff. Use these sections even if the initial template
has been replaced: **Scope**, **Confirmed findings**, **Investigations and
limitations**, **Checks and evidence**, **Implementer handoff**, and **Reviewer
recheck and sign-off**. Keep empty sections short.

Before starting a new review, archive a nonempty prior report to
`docs/reviews/<previous-review-id>.md`, preserve its evidence and fix relative
links. Do not overwrite an existing archive. Update ledger links to the archive;
the initial unstarted template needs no archive. A recheck normally appends to
its existing report instead of replacing it. Carry every unresolved finding into
the current handoff with its original ID, status and a link to its source,
including implemented fixes awaiting recheck and user-deferred risks. Archiving
is not resolution. Findings from older reports keep their original IDs.

Each new confirmed finding needs:

- Stable `<review-id>-F1` ID, priority, concise title, and path/line or symbol at
  the reviewed revision. Identify whether it is new or pre-existing when known.
- Reachable trigger, expected/actual behavior and concrete user impact.
- Minimal reproduction and observed output, or labeled **static evidence** with
  the full causal path. Include enough detail to reproduce without local artifacts.
- Fix direction and a regression acceptance criterion, not an implemented patch.
  Reference the owning plan stage when identifiable; do not invent one.

Priorities: **P0** urgent catastrophic impact; **P1** serious data loss, security
or core-workflow failure; **P2** other meaningful correctness/performance defects;
**P3** minor defects. Justify priority by impact and likelihood, not by dramatic
wording. Unproven possibilities belong in investigations, with the missing evidence
and next useful check. A failed command is not itself proof of an application bug.

State inspection completeness separately from disposition: **changes requested**,
**no confirmed findings**, or **incomplete**. “No confirmed findings” is valid even
with limited coverage if the limitations are explicit; it is not a whole-project
certificate. List actual commands/results, tested environment, blockers and gaps.
Separate desktop automation from physical-device and live-service evidence.
End the user-facing response with findings in priority order, or no confirmed
findings, plus scope, material limitations and a link to the report.

## 4. Record coverage, fixes and independent decisions

Append ledger events only after inspection. Record event ID/date/reviewer, kind
(range, snapshot audit, scoped recheck or self-check), exact target, completeness,
disposition and report link. A partial pass records its inspected subset and gaps.
Only independent, complete, contiguous **committed range** reviews extend the
covered boundary; open findings do not prevent recording inspection. An unrelated
branch, snapshot audit, dirty-tree review, self-check or scoped recheck cannot
silently cover skipped commits. Committed coverage in a dirty-tree task requires
separate inspection of that committed state. No future/unreviewed ranges belong
in the ledger. Preserve prior events; append corrections rather than rewriting
old conclusions. See `REVIEW_LEDGER.md` for the one-time legacy exception.

Implementers append fix claims and focused results under **Implementer handoff**.
Those remain **implemented; awaiting reviewer recheck**. On recheck, inspect the
actual fix, repeat the reproduction/static proof and check related regressions.
Append a dated disposition per finding: **resolved**, **still open**, or
**accepted/deferred by user** with the decision cited. If disproved, record why;
do not silently delete the original finding. Missing runtime evidence must remain
visible; an implementation claim alone does not close a finding.

Sign-off may accompany an initial independent review or a recheck. It requires
complete inspection of the declared scope at an exact committed head, no unresolved
required findings in that scope, and no evidence gap that prevents its conclusion.
Any accepted/deferred risk needs the user's explicit decision; never infer acceptance
from silence. Record reviewer, date, head, scope, limitations and accepted risks.
Uncommitted results are provisional. A scoped fix sign-off resolves only those
findings and does not approve other changes at that head or extend range coverage.
Unrelated dirty files do not prevent sign-off if the committed target was inspected
separately. Do not commit work just to obtain sign-off.

Full-suite verification belongs to a separate test-runner task using `TESTS.md`.
Review coverage, independent sign-off, test results and deployment approval are
separate facts. Do not initiate implementation, a full test run or deployment as
an automatic continuation of a review.
