---
name: coffeeos-tests
description: Run CoffeeOS's complete automated tests and regressions as the test runner, then report failures or blocked coverage in TESTS.md for an implementer. Use when asked to run the full suite or verify a completed implementation, not for implementing fixes or selecting focused development checks.
---

# CoffeeOS test runner

Adopt the **test runner** identity in root `AGENTS.md`. Run tests and report;
leave fixes to an implementer. Read existing root `TESTS.md` first and preserve
unresolved findings. Do not edit application/test code, instructions, dependency
manifests/locks or `PLAN.md`, weaken checks, commit, deploy or contact real Google
services. Ignored test artifacts and `TESTS.md` are the outputs of this task.

From the repository root:

```sh
uv run npm test
```

This is the full maintained entry point. It validates coverage registration,
automatically discovers `tests/**/*.test.mjs`, builds the app, starts owned local
Vite/preview/Safari-driver processes and isolated Firefox profiles, and runs the
registered matrix sequentially. Do not replace it with a handpicked subset or
parallelize browser suites: upgrade/offline fixtures and ports are shared.

Run commands from the project root. Use the existing `.venv`; never recreate it.
Always prefix direct `node`, `npm` and `npx` commands with `uv run`; do not install
global tools or use a system Node version manager. If `.venv` is missing,
bootstrap in this order:

```sh
uv venv
uv pip install nodeenv
uv run nodeenv -p --node=lts
uv run npm ci
```

If an existing environment lacks Node or locked dependencies, run only the missing
setup steps in that environment. `uv run node -p 'process.execPath'` must point
inside the project's `.venv`. Keep the project-local caches configured in
`uv.toml` and `.npmrc`. Use an existing Python interpreter; if none is available,
set `UV_PYTHON_INSTALL_DIR` to an absolute path inside the project before installing
Python with uv. Install the independent verifier into the same environment with
`uv pip install -r tests/requirements.txt` if needed. Do not read
`AGENTS_implementer.md` for test-runner setup. Installed Safari with Remote
Automation enabled and Firefox are required for the complete browser matrix.
`SAFARIDRIVER_BIN` and `FIREFOX_BIN` can select installed executables. The harness
uses its own endpoints and profiles, never the user's normal browser profile.
Do not launch Chrome or change system browser settings to make a run pass.

Allow the command to finish and keep the user informed while polling. Each suite
has a 20-minute deadline. The harness continues independent suites after a
failure, records dependent/unavailable coverage as blocked, exits nonzero if
anything fails or is blocked, and cleans up its owned processes. Do not restart
or retry failed application checks merely to obtain a passing result. A retry
for a corrected environment must retain the original evidence.

Read the run's `.cache/test-runs/<run>/summary.json` and relevant logs. Full runs
automatically write issues to root `TESTS.md`; clean runs leave it zero-byte unless
prior findings remain. Preserve previous unresolved findings. If the command
cannot start or is killed before reporting, write that blocker/interruption to
`TESTS.md` yourself, including any unfinished suites from the saved summary.
Never infer success from a partial run or an old summary. A leftover
`.cache/test-harness.lock` records the owner PID; remove it only after confirming
that process has exited. Do not stop another agent's active run.

Keep the handoff short. For each issue give suite/browser, reproduction command,
expected/actual result or assertion, and log/summary path. Group repeated setup
blockers where useful. Add a brief explanation from log evidence when it helps
an implementer; do not speculate about code fixes. For example:

```markdown
- FAILED upgrade-recent-firefox: expected all seeded records after reload;
  actual: assertion at tests/bean-upgrade.mjs:123.
  Reproduce: uv run npm test -- --only upgrade-recent-firefox
  Evidence: .cache/test-runs/<run>/upgrade-recent-firefox.log
```

Report pass/fail/blocked totals and artifacts to the user. State that physical
Safari/iOS touch, native keyboard/viewport, Home Screen/storage lifecycle, real
Google authorization/transfers and deployed-host headers remain unverified
unless explicitly tested. Automated Drive traffic is mocked. Desktop Safari is
Safari verification; Firefox alone is not. These standing manual gates are
recorded in each summary, not recurring defects in `TESTS.md`.

See [the harness guide](../../../tests/README.md) for coverage and registration.
`--list` inspects the inventory without running it. `--only` is for reproduction
and focused implementer checks; it never claims a full run or rewrites `TESTS.md`.
