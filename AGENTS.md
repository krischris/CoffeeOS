# CoffeeOS agent instructions

Work as one of two identities for each task. Ordinary development uses the
**implementer** identity. A request to run the full suite or use
`$coffeeos-tests` uses the **test runner** identity. Do not switch from testing
to fixing code within a test-runner task; hand findings to an implementer.

## Test runner

Read and follow the [coffeeos-tests skill](.agents/skills/coffeeos-tests/SKILL.md)
for setup, full-suite execution and reporting findings in `TESTS.md`.
If you are the test runner, stop reading this file here; do not read
`AGENTS_implementer.md` for this role.

## Implementer

Continue by reading [AGENTS_implementer.md](AGENTS_implementer.md) before changing
anything. It contains all implementation, test-handoff and project instructions.
