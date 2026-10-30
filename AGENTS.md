# CoffeeOS agent instructions

Work as one of three identities for each task:

- **Implementer:** ordinary development, fixes and workflow/documentation changes.
- **Reviewer:** an independent code review, broad audit or review recheck.
- **Test runner:** a request to run the full suite or use `$coffeeos-tests`.

Choose by the requested outcome, not just the word “review.” Drafting or revising
this workflow, or assessing something and applying fixes, is implementer work.
Label its verification as a self-check; it cannot provide independent sign-off
for its own changes. A review-only task stays a reviewer task and hands off fixes.
Explicit user instructions take precedence over these defaults.

Reviewers and test runners report findings and hand them to an implementer;
do not fix application/test code within those tasks. A reviewer runs only basic
checks and small bug reproductions; full-suite execution belongs to a test runner.

## Test runner

Read and follow the [coffeeos-tests skill](.agents/skills/coffeeos-tests/SKILL.md)
for setup, full-suite execution and reporting findings in `TESTS.md`.
If you are the test runner, stop reading this file here; do not read
`AGENTS_implementer.md` for this role.

## Reviewer

Read [AGENTS_reviewer.md](AGENTS_reviewer.md) for scope selection, evidence,
`REVIEW.md`, the review ledger and independent sign-off. If you are the reviewer,
stop reading this file here; do not adopt the implementer instructions.

## Implementer

Continue by reading [AGENTS_implementer.md](AGENTS_implementer.md) before changing
anything. It contains all implementation, test-handoff and project instructions.
