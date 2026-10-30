# CoffeeOS implementer instructions

## Test findings and handoff

Before changing anything, read root `TESTS.md` if it exists.
Missing or zero-byte means no pending findings. If nonempty, address its findings
first, run focused checks for those fixes, and remove resolved findings. Delete
or empty the file once every finding is addressed; retain unresolved issues and
environment blockers with their evidence. Never clear findings just to proceed.
Run the build and only specific tests relevant to the implementation. Leave the
full suite to the test runner. Every new behavior/regression check must enter the
maintained harness before handoff: add `tests/**/*.test.mjs` for automatic Node
test discovery, extend an existing registered suite/helper, or register a new
browser/other entry point and its prerequisites in `tests/suites.mjs`. Run
`uv run npm run test:inventory` to catch omitted test files. Preserve prior
regressions; do not leave necessary checks as one-off scripts or prose only.

## Plan maintenance

Record every future project update as the next sequentially numbered stage in
`PLAN.md`. Follow the same structure as the existing stages: a descriptive stage
title, status checkbox, Goal, Tasks, Acceptance Criteria (stage gate), and dated
Verification notes. Define concrete acceptance criteria for each update and record
the checks performed, their results, and any remaining unverified items. Keep the
stage status accurate and preserve earlier stages as a record of completed work.

## Data compatibility and persistence — mandatory for future updates

Every app update, refactor, dependency upgrade, and deployment MUST preserve
existing users' beans and brew sessions. Preserve record IDs, bean/session
relationships, field meanings and units, dates, null values, comments, and numeric
precision. Existing stored records and previously exported CSV/Parquet backups
must remain readable. Prefer additive, optional fields with compatible defaults;
changes to existing formats require explicit, versioned, data-preserving migrations.

Keep storage identity stable: the OPFS database and WAL filenames, IndexedDB
database/object-store names, snapshot keys, backend-selection metadata, and database
ownership lock. Do not derive them from app versions, build hashes, or asset URLs.
Changing any identifier requires a migration that locates and preserves existing
data. Preserve the deployment origin and storage access; an origin change requires
an explicit transfer/recovery plan because browser storage does not follow it.

Never clear, delete, truncate, or recreate user storage during startup, refactoring,
deployment, or service-worker/cache updates. Never handle an open, restore,
compatibility, migration, lock, or permission failure by silently starting an empty
database, switching datasets/backends, or overwriting saved snapshots. Preserve
the original data and show a recoverable error when it cannot be opened safely.
Initialize an empty database only for a confirmed first use; any destructive reset
must be a separate, explicit user action. Migrations must be repeatable, preserve a
recoverable pre-migration copy, and leave existing data intact on failure.

For changes affecting storage, formats, startup, dependencies, service workers, or
deployment, verify an upgrade from a previous build with populated OPFS and
IndexedDB fixtures in the same isolated browser profile and origin. Confirm all
records survive the build replacement, startup, and reload; old backups still
import; and failed upgrades preserve data without presenting an empty collection.
Record the results and any unverified upgrade paths in the new `PLAN.md` stage.
Fresh-database and same-build reload checks alone do not establish upgrade safety.

## Project-local tooling

Run commands from this project directory. Use `uv` to manage the local `.venv`;
Node.js and npm are installed into that same environment with `nodeenv`.
Do not assume global `node`, `npm`, `npx`, TypeScript, or Vite exist. Do not install
them globally or use a system Node version manager for this project.

Bootstrap a fresh checkout in this order:

```sh
uv venv
uv pip install nodeenv
uv run nodeenv -p --node=lts
uv run npm ci
```

Only create `.venv` when it does not already exist. Do not recreate a working
environment during routine development. `nodeenv -p` installs Node into the
existing Python virtual environment; do not create a separate Node environment.
The LTS selector resolves the current LTS release when bootstrapping.

Always prefix direct `node`, `npm`, and `npx` commands with `uv run`:

```sh
uv run node --version
uv run node -p 'process.execPath'
uv run npm run dev
uv run npm run typecheck
uv run npm run build
uv run npm run preview
uv run npm install <package>
uv run npm install --save-dev <package>
uv run npx <tool>
```

`process.execPath` must point inside this project's `.venv`. npm scripts resolve
tools from the project's `node_modules/.bin`; keep TypeScript and Vite in
`devDependencies`. Do not use `npm install -g`. Prefer installed dependencies
over downloading ad hoc tool versions through `npx`.

`uv.toml` keeps uv's cache in `.cache/uv` and disables automatic Python downloads
outside the project. Bootstrapping requires an existing Python interpreter. If
one is unavailable, install it with uv using `UV_PYTHON_INSTALL_DIR` set to an
absolute path inside this project. `.npmrc` keeps npm's cache in `.cache/npm`.
Keep `.venv/`, `.cache/`, `node_modules/`, and `dist/` out of version control.
Commit `package-lock.json` alongside dependency changes. Use `uv run npm ci` to
reproduce the locked JavaScript dependencies.

## Application approach

This is a vanilla TypeScript application built with Vite. The entry points are
`index.html` and `src/main.ts`; styles live in `src/style.css`. Keep the scaffold
free of application frameworks unless the user requests one. DuckDB-Wasm is a
local runtime dependency (`@duckdb/duckdb-wasm`). `src/db.ts` owns initialization,
OPFS persistence, and the IndexedDB Parquet snapshot fallback.

Preserve these settings in `vite.config.ts`:

- `base: './'` keeps production asset paths relative for GitHub Pages subpaths.
- `server.headers['Cross-Origin-Opener-Policy']: 'same-origin'`.
- `server.headers['Cross-Origin-Embedder-Policy']: 'require-corp'`.
- The same headers in `preview.headers` so local production previews use the
  same isolation policy.

When adding DuckDB workers and Wasm assets, use Vite-managed asset URLs that work
with a relative base. Serve them from the same origin where possible; external
assets must satisfy the embedder policy. Check the installed DuckDB-Wasm API
before implementing database lifecycle or OPFS access, and close connections and
workers when they are no longer needed.

The isolation headers support local browser capabilities needed for database
work; they do not implement persistence. Check browser OPFS support and
`window.crossOriginIsolated` when implementing persistence. Vite's headers apply
only to its dev and preview servers, not to files in `dist/`. Validate the deployed
host's response headers separately; relative asset paths alone do not establish
cross-origin isolation in production.

## Verification

Implementers run `uv run npm run build` after changes; it type-checks application
code and `vite.config.ts`, then creates `dist/`. Use `uv run npm run dev` or
`uv run npm run preview` for browser checks. Confirm the two isolation response
headers and that generated asset paths still work under a repository subpath.
Add targeted runtime checks when database behavior is introduced.

## Browser verification — Safari first for iOS

Before launching browser-backed focused checks, follow the
[browser execution permission guidance](.agents/skills/coffeeos-tests/SKILL.md#browser-execution-permissions)
to avoid starting them under CoffeeOS's known localhost-blocking sandbox. This
permission guidance applies to implementers without changing their identity.

Safari is the primary browser for development and acceptance checks because
CoffeeOS targets iOS Safari and Home Screen web apps. Run browser checks in the
installed Safari using `safaridriver` when available. Verify startup, navigation,
database writes and reload persistence, and the production repository subpath.
For a focused run with Vite and `safaridriver -p 4444` already running, use
`uv run npm run test:safari`. The full harness manages its own servers and isolated
browser sessions; see the [test-runner skill](.agents/skills/coffeeos-tests/SKILL.md).

Desktop Safari checks do not replace physical iPhone/iPad checks for touch,
keyboard/viewport behavior, Home Screen installation, and storage lifecycle.
State clearly which environment was tested and which checks remain unverified.

Firefox is a secondary browser for cross-browser regression checks and a fallback
when Safari automation is unavailable. A Firefox pass does not count as Safari
verification. Use isolated automation sessions/test profiles and localhost URLs;
disable background services/external browser traffic where supported without
changing the user's normal browsing profile. Do not launch Google Chrome unless
the user explicitly requests it.
