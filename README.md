# CoffeeOS

A vanilla TypeScript + Vite PWA with Brew Controller, Bean Manager, and IO
tabs. Brew Controller is selected on startup. Tab navigation supports touch,
click, arrow keys, Home, and End.
Node.js, npm, and development tools stay inside this project.

## Setup

Prerequisites: `uv` and an existing Python interpreter. From this directory on a
fresh checkout:

```sh
uv venv
uv pip install nodeenv
uv run nodeenv -p --node=lts
uv run npm ci
```

Skip environment creation and Node bootstrapping when `.venv` is already set up.
All direct Node, npm, and npx commands must use the `uv run` prefix. Verify the
Node executable with `uv run node -p 'process.execPath'`; it should be in `.venv`.
See [AGENTS.md](AGENTS.md) for the development rules.

## Development

```sh
uv run npm run dev
uv run npm run typecheck
uv run npm run build
uv run npm run preview
```

The production build is written to `dist/`. `base: './'` gives its assets relative
paths suitable for hosting under a GitHub Pages repository path, as described in
the [Vite base configuration](https://vite.dev/config/shared-options.html#base).

The dev and preview servers send COOP `same-origin` and COEP `require-corp` headers.
For static hosts such as GitHub Pages, `public/coi-serviceworker.js` provides those
headers on service-worker-controlled responses and reloads the first visit to
enable isolation. The vendored worker is
[coi-serviceworker v0.1.7](https://github.com/gzuidhof/coi-serviceworker), with its
MIT license in `public/coi-serviceworker.LICENSE.txt`. It requires HTTPS or
localhost and service worker support. It does not add offline caching.
The local copy retries conditional `304` responses without validators so Safari
can reload cached database worker scripts through the isolation worker.

The manifest, icons, worker, and production assets use relative URLs so they stay
inside a repository subpath. iOS Home Screen metadata and safe-area spacing are
included. Validate `window.crossOriginIsolated` and worker-controlled response
headers on the deployed host before relying on database capabilities; Vite's
headers alone are not embedded in `dist/`.

## Database (stage 2)

`src/db.ts` initializes DuckDB before displaying the tabs. It exports `initDB`,
`getBeans`, `addBean`, `getBrewSessions`, `addBrewSession`, and `closeDB`, using the
domain interfaces in `src/types.ts`.
Queries bind parameters, dates return as `YYYY-MM-DD`, and timestamps return as
UTC ISO strings. Writes are serialized, checkpointed, and flushed before resolving.
A flush failure after commit is reported separately so users are not told to
retry an insert that already exists. Measurements must be finite and dates use
years 0001–9999 so imported records remain displayable.

Storage is selected on startup:

- With cross-origin isolation and OPFS support, `opfs://coffeos.db` is stored in
  the browser's origin-private filesystem. Explicit file-handle registration
  works around empty-file registration and URI normalization issues in the
  installed runtime; DuckDB opens the registered `coffeos.db` alias.
- If OPFS is unavailable on first use, an in-memory database restores both tables from
  an atomic IndexedDB record of Parquet buffers. Every successful write updates
  that record; snapshot failures roll back the write. A damaged snapshot reports
  a startup error so existing data is not replaced with empty tables.
- The MVP compatibility bundle also uses IndexedDB, avoiding an OPFS reopen bug
  in the pinned runtime. Browsers supporting Wasm exception handling use OPFS.
- If IndexedDB is unavailable too, data lasts for the current tab only, with a
  visible warning in the app. Storage persistence permission is requested without
  blocking startup on a browser permission prompt.

A Web Lock allows one open database per origin. Additional tabs show a clear
message to close the other tab and reload; they never create a competing writable
snapshot. Closing the database or tab releases ownership. Browsers without Web
Locks show a startup error instead of permitting unsafe concurrent writes.

The selected durable backend is remembered in IndexedDB. An existing snapshot
keeps using IndexedDB even when OPFS later becomes available. If a remembered
OPFS database cannot be opened, startup fails without switching to an empty
collection. Older installations with both datasets retain both files and prefer
an existing snapshot when no backend marker exists; historical split datasets
are not automatically merged. Browser storage can still be cleared by the user
or evicted when persistence is denied. Export backups from IO regularly.

Workers, Wasm, and signed Parquet extensions are served locally through Vite;
automatic external extension downloads are disabled. The runtime is pinned to
match the [vendored extensions](src/vendor/duckdb/README.md).

## Bean Manager (stage 3)

Add beans with a required name and optional roast/freeze dates. The collection
refreshes after saving and when opening the tab, showing each bean's complete
brew history, newest first, with input/result metrics and comments. Empty
histories have a placeholder. Failed saves preserve the form for retry.

## Brew Controller (stage 4)

The default tab lists every brew session, newest first, with its bean, date/time,
input/result measurements, and comment. Choose **+ New Session** to select a bean
and fill the Input and Result tables. Measurements are optional; blank values
are stored as null. Extraction updates live as `yield × TDS / dose` when all three
values are positive, displays two decimal places, and saves the full precision.

The Result table is followed by a live brewing control chart matching the supplied
reference: extraction on X (14–26%), TDS on Y (0.95–1.75%), grid lines, and nine
labeled strength/extraction regions. Its center spans 18–22% extraction and
1.15–1.55% TDS, labeled Ideal / Optimum Balance. A result marker and dashed guides
move with dose, yield, and TDS edits. The caption gives the exact result and region;
missing/invalid inputs hide the marker, and values outside the reference scale
show an explicit message with their actual coordinates.

Saving returns to the feed and immediately refreshes Bean Manager's histories
and session counts. Cancel clears the draft; changing tabs preserves it and
refreshes the bean selector when returning. If there are no beans, the form
links to Bean Manager. Failed saves preserve entries for retry, and repeated
submissions while saving are ignored.

## Safari verification (primary)

Safari is the primary browser for this iOS app. Check startup, tab navigation,
bean/brew writes, and persistence after reload in an isolated Safari automation
session against the local Vite server. Repeat startup against a production build
served under a repository subpath. Safari WebDriver requires **Safari → Settings
→ Developer → Allow remote automation**; if Developer is hidden, enable developer
features in Advanced first. Report Safari checks as unverified when this setting
prevents a session from starting.

Run `uv run npm run dev` and `/usr/bin/safaridriver -p 4444` in separate terminals,
then run `uv run npm run test:safari`. The dependency-free smoke test uses an
isolated Safari automation session and checks startup, isolation, navigation,
bean/session creation through the forms, validation, brew summaries and ordering,
live extraction, draft/cancel behavior, immediate updates in both tabs, mobile
input sizing, reload persistence, and recovery after a failed storage write.
It also checks database joins, dates/nulls, and second-tab storage.
Override `SAFARI_WEBDRIVER_URL` or `TEST_BASE_URL` if needed. To check a built site,
set `TEST_PRODUCTION=1` and `TEST_BASE_URL` to its URL, including the repository
subpath. Production checks include bean/session creation through the forms, live
extraction, and reload persistence; run only against a local test site in the
isolated automation session.

Desktop Safari verification supplements physical iPhone/iPad checks for touch,
keyboard/viewport behavior, Home Screen installation, and storage lifecycle.

## Firefox database checks (secondary)

Use Firefox with an isolated profile. The provided preferences disable background
services and route external HTTP/HTTPS traffic to an unused local proxy while
allowing localhost. They do not change your normal browser profile.

Start `uv run npm run dev` in one terminal. On macOS, start Firefox in another:

```sh
mkdir -p .cache/firefox-tests
cp tests/firefox-user.js .cache/firefox-tests/user.js
"/Applications/Firefox.app/Contents/MacOS/firefox" --headless --no-remote \
  --profile "$PWD/.cache/firefox-tests" --remote-debugging-port 9223 about:blank
```

Then run:

```sh
uv run npm run test:db
TEST_MVP=1 uv run npm run test:db
```

These dependency-free WebDriver BiDi checks use a fresh Firefox container and
cover CRUD, ordering/filtering/joins, SQL binding, OPFS reloads, exclusive ownership,
IndexedDB Parquet restore, failed writes, damaged snapshots, permission denial,
memory fallback, cleanup, and unhandled browser errors. `TEST_MVP=1` selects the
compatibility Wasm bundle. Override `FIREFOX_BIDI_URL` or `TEST_BASE_URL` if needed.
For a built site (including a repository subpath), set `TEST_PRODUCTION=1` and
`TEST_BASE_URL` to check startup, isolation, local assets, and database ownership.

## Import and export (stage 5)

The IO tab exports **Parquet** or **CSV** using either a full backup (separate
`beans` and `brew_sessions` files) or a combined `coffeeos` file. Combined files
repeat bean details alongside each session and include beans without sessions.
Choose **Save** for each prepared file, or **Share files** when file sharing is
supported. On iOS the share sheet can save to Files. Sharing starts from a
separate tap after preparation; cancelled shares leave download links available.
Exported files remain a snapshot of the data at the time they were prepared.

To import, select a combined file or one or both table files, then choose
**Import files**. CSV and Parquet table files can be mixed. Imports merge by ID,
update matching records, and retain unrelated records. Importing sessions alone
requires their beans to be present already. All selected files merge in one
transaction and persist before the success message; both history views refresh
immediately. The displayed counts include updated records. Invalid columns,
duplicate IDs within a file, invalid values, and missing bean references reject
the batch. Failed imports keep selected files for retry.

Keep the original column headers; column order may change. CSV uses unquoted
`\N` for null, quotes literal `\N`, and preserves empty strings, Unicode,
multiline comments, and full numeric precision. Use Parquet for a typed backup.
The combined schema has `bean_id`, `bean_name`, `bean_roast_date`,
`bean_freeze_date`, `bean_created_at`, `session_id`, and all session fields except
`id` and `bean_id`. A row with no `session_id` represents a bean without sessions.

The Safari test includes actual CSV/Parquet file generation, re-import through
file inputs, primary-key merges, immediate history refreshes, rejected imports,
atomic IndexedDB snapshot failures, reloads, and mocked Share API success,
cancellation, and unsupported sharing. It also verifies empty exports and clean
restores into an empty memory-only database. Native iOS Files/Share sheet interaction
still needs physical-device verification.

## GitHub Pages deployment

[The deployment workflow](.github/workflows/deploy.yml) builds on pushes to
`main` and manual runs, installs Node LTS on the hosted runner, runs the locked
`npm ci` install and production build, and uploads `dist/` for Pages deployment.
Hosted CI uses `actions/setup-node`; local commands continue to use `uv run`.
In the repository's **Settings → Pages → Build and deployment**, select
**GitHub Actions** as the source, following the
[GitHub Pages workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
The workflow has separate build/deploy jobs and limits Pages/OIDC write
permissions to deployment. It does not publish anything until run in GitHub.
Validate the deployed URL's isolation and local database assets after deployment.
# CoffeeOS
