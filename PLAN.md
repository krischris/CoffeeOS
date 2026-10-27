# Project Specification & Staged Execution Plan: `coffeos`

## 0. Global Rules for All Agent Sessions (READ FIRST)
1. **Strict Stage Scoping:** You will be asked to execute ONE numbered stage at a time. Complete ONLY the requested stage, verify the Acceptance Criteria, update the status checkbox in this file, and STOP.
2. **Scoped Toolchain via `uv`:** Do NOT assume global `node` or `npm` exist on the host machine. Node.js is installed inside `./.venv` via `nodeenv`. **Every single `node`, `npm`, or `npx` command MUST be prefixed with `uv run`** (e.g., `uv run npm install`, `uv run npx tsc --noEmit`, `uv run npm run build`).
3. **Tech Stack:**
   - Vanilla TypeScript + Vite (no heavy UI frameworks; clean modular DOM rendering).
   - `@duckdb/duckdb-wasm` for in-browser SQL storage, backed by OPFS (`opfs://coffeos.db`) or the existing IndexedDB snapshot backend. Preserve the selected durable backend; lock/open/restore failures must preserve saved data and show a recoverable error. Initial fallback is permitted only when it cannot hide or overwrite existing data.
   - Mobile-first iOS Web App (PWA) design: all `<input>` and `<select>` elements MUST have `font-size: 16px` (prevents iOS Safari auto-zoom) and touch targets `min-height: 44px`.
4. **Domain Formula:**
   $$\text{Extraction (\%)} = \frac{\text{Yield (g)} \times \text{TDS (\%)}}{\text{Dose (g)}}$$
5. **Mandatory Upgrade Compatibility:** Every future update must preserve existing bean/session records and readable historical backups. Keep storage identity stable; use explicit, versioned, data-preserving migrations for format/storage changes. Startup, deployment, service-worker updates, and refactors must never silently replace inaccessible data with an empty database. Follow `AGENTS.md` and the Stage 6 upgrade acceptance criteria for every relevant future stage. This rule supersedes historical fallback instructions below.

---

## Stage 1: Toolchain, Vite Scaffold & PWA 3-Tab Shell
- [x] **Status:** Completed

### Goal
Bootstrap the local `uv` + `nodeenv` environment, scaffold the TypeScript + Vite app, configure PWA manifests/headers for GitHub Pages + iOS Home Screen, and build the 3-tab navigation shell.

### Tasks
1. **Environment Setup:**
   - If `.venv` does not exist: run `uv venv`, `uv pip install nodeenv`, and `uv run nodeenv -p --node=lts`.
   - Initialize `package.json`, install `typescript` and `vite` as devDependencies via `uv run npm install -D typescript vite`.
2. **Vite & GitHub Pages Config:**
   - Create `tsconfig.json` (strict mode, `ES2022` target, bundler module resolution).
   - Create `vite.config.ts` with `base: './'` and `server.headers`:
     - `'Cross-Origin-Opener-Policy': 'same-origin'`
     - `'Cross-Origin-Embedder-Policy': 'require-corp'`
   - Add `coi-serviceworker.js` to `public/` and load it in `index.html` so GitHub Pages serves COOP/COEP headers in production.
3. **iOS PWA Configuration:**
   - Create `public/manifest.json` (`"name": "coffeos"`, `"short_name": "coffeos"`, `"display": "standalone"`, `"start_url": "./"`).
   - Add iOS standalone meta tags to `index.html` (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `viewport` with `viewport-fit=cover`).
4. **UI Shell (`src/main.ts`, `src/style.css`):**
   - Build a clean mobile layout with a top header (`coffeos`), a scrollable main content container, and a fixed bottom tab bar with 3 tabs:
     1. **Brew Controller** (Default active view on load)
     2. **Bean Manager**
     3. **IO**
   - Clicking tabs switches the active view container cleanly.
5. **Shared Dark Theme (`src/style.css`, `index.html`, `public/manifest.json`):**
   - Match the Stage 4 extraction graph across all three tabs using shared color variables: deep navy backgrounds, layered dark cards, light text, and warm peach accents.
   - Theme forms, buttons, navigation, empty/loading/error states, and storage warnings, with readable text, visible input boundaries, and keyboard focus indicators.
   - Set the native control color scheme to dark and align browser theme color, PWA background/theme colors, and iOS standalone status-bar styling with the dark shell.

### Acceptance Criteria (Stage 1 Gate)
- `uv run npx tsc --noEmit` passes with zero errors.
- `uv run npm run build` succeeds and outputs `./dist`.
- Opening the app renders the 3-tab shell defaulting to **Brew Controller**.
- Brew Controller, Bean Manager, and IO consistently use the extraction graph's dark palette, including cards, inputs/selects, buttons, navigation, and feedback states; text, control boundaries, and keyboard focus remain visible.
- Native controls use a dark color scheme. Browser/PWA theme and background colors match the navy app background (`#0e1222`), with dark-compatible iOS standalone status-bar styling.
- Desktop Safari confirms the dark theme and navigation at a 390px window width without horizontal overflow, including the production build under a repository subpath; physical iPhone/iPad and Home Screen checks are tracked separately until verified.
- **STOP HERE.** Do not install or write DuckDB logic yet.

### Verification — 2026-10-25
- `uv run npx tsc --noEmit` and `uv run npm run build` both passed.
- Headless Chrome confirmed Brew Controller is the default, all three tabs switch
  correctly, keyboard navigation works, and the main content scrolls above the
  fixed tab bar at mobile and desktop widths.
- Final Safari IndexedDB and Firefox OPFS upgrade runs also confirmed that an
  unchanged edit preserves sub-millisecond timestamps byte-for-byte in CSV
  exports, including native date-input normalization.
- Dev and preview responses include COOP `same-origin` and COEP `require-corp`.
- Served `dist/` under `/coffeeos/` without server isolation headers: all relative
  assets, manifest, and icons loaded, and the service worker enabled
  `window.crossOriginIsolated` with the expected headers in two fresh browser
  profiles. No unhandled browser exceptions or missing resources were observed.
- Actual GitHub Pages deployment and physical iOS checks remain deployment
  validation; no database initialization or persistence logic was added.

### Dark theme follow-up — 2026-10-26

- Completed the shared dark theme across the shell and all three tabs, matching
  the extraction graph's navy surfaces and peach accents. Updated native control
  styling, browser/PWA colors, and iOS standalone status-bar metadata.
- Verification performed on 2026-10-25: `uv run npm run build` and Safari 27.0
  on macOS checks passed on Vite dev and the production build under `/CoffeeOS/`.
  Checks covered computed theme colors, native dark color scheme, navigation,
  narrow layout, chart behavior, form writes, and reload persistence. Dev and
  preview isolation response headers were confirmed; the chart/form screenshot
  was visually reviewed.
- Physical iPhone/iPad, Home Screen appearance, and actual deployed-host checks
  remain unverified.

---

## Stage 2: Database Layer & Schema (`src/db.ts`)
- [x] **Status:** Completed

### Goal
Create a standalone, strongly-typed database module using `@duckdb/duckdb-wasm` that persists data locally and exposes clean async CRUD methods.

### Tasks
1. **Install Dependency:**
   - Run `uv run npm install @duckdb/duckdb-wasm`.
2. **Create `src/types.ts`:**
   ```ts
   export interface Bean {
     id: string;
     name: string;
     roast_date: string | null;  // YYYY-MM-DD
     freeze_date: string | null; // YYYY-MM-DD
     created_at: string;
   }

   export interface BrewSession {
     id: string;
     bean_id: string;
     bean_name?: string;         // Joined from beans table
     brewed_at: string;          // ISO timestamp
     dose_g: number | null;
     water_g: number | null;
     time_str: string | null;    // e.g. "02:30" or seconds
     temp_c: number | null;
     grind_um: number | null;
     comment: string | null;
     yield_g: number | null;
     tds_pct: number | null;
     extraction_pct: number | null;
   }

```

3. **Implement `src/db.ts`:**
* Request persistent storage via `navigator.storage?.persist?.()`.
* Initialize `@duckdb/duckdb-wasm` using the local Vite worker/wasm bundle imports.
* Open persistent storage at `opfs://coffeos.db`. Implement a clean fallback: if OPFS registration fails (e.g., restricted browser tab context), fall back to an in-memory DuckDB instance that automatically snapshots tables as Parquet buffers into IndexedDB on every write and restores on boot.
* Run idempotent schema setup (`CREATE TABLE IF NOT EXISTS beans ...`, `CREATE TABLE IF NOT EXISTS brew_sessions ...`).
* Implement and export async functions:
* `initDB(): Promise<void>`
* `getBeans(): Promise<Bean[]>` (ordered by `created_at DESC`)
* `addBean(input: { name: string; roast_date?: string | null; freeze_date?: string | null }): Promise<Bean>`
* `getBrewSessions(beanId?: string): Promise<BrewSession[]>` (joins `beans` to include `bean_name`, ordered by `brewed_at DESC`; filters by `bean_id` if provided)
* `addBrewSession(input: Omit<BrewSession, 'id' | 'brewed_at' | 'bean_name'>): Promise<BrewSession>`


* Ensure writes flush to persistent storage immediately (`CHECKPOINT`).


4. **Boot Wire-Up:**
* Call `await initDB()` in `src/main.ts` during startup and show a minimal loading indicator until ready.



### Acceptance Criteria (Stage 2 Gate)

* `uv run npx tsc --noEmit` and `uv run npm run build` pass.
* Database initializes cleanly in the browser console with zero unhandled promise rejections.
* **STOP HERE.** Do not build the forms yet.

### Verification — 2026-10-25

- `uv run npx tsc --noEmit` and `uv run npm run build` passed.
- Firefox verified typed CRUD, parameter binding, nullable dates/metrics, UTC
  timestamps, bean-name joins, filtering, ordering, constraints, and concurrent
  initialization/writes, with zero unhandled browser exceptions or rejections.
- OPFS writes survived reload. A second tab holding an exclusive OPFS lock
  triggered IndexedDB fallback; both tables restored from atomic Parquet buffers
  on reload. Failed snapshot writes rolled back, corrupt snapshots were preserved
  behind a recoverable initialization error, and memory-only fallback worked.
- The pinned runtime needs explicit file-handle registration and a plain
  `coffeos.db` DuckDB alias for the physical `opfs://coffeos.db` file. Its MVP
  compatibility bundle uses IndexedDB to avoid an OPFS reopen bug; the complete
  persistence/recovery suite also passed with that bundle forced.
- Workers, Wasm, and signed Parquet extensions are local Vite assets. Automatic
  external extension downloads are disabled; the runtime and extension versions
  are pinned together, and the extension license is included in `dist/`.
- Dev/preview COOP `same-origin` and COEP `require-corp` headers were confirmed.
  Firefox loaded `dist/` under `/coffeeos/` on a plain static server, with the
  service worker establishing isolation; both Wasm bundles initialized, including
  local Parquet loading in IndexedDB mode. Actual hosting and physical iOS
  verification remain deployment checks.
- Startup loading/error states are wired up. No forms or later-stage views were
  implemented. Firefox was used for this verification; Safari is now the primary
  browser for iOS acceptance checks, as specified in `AGENTS.md`.

### Safari follow-up — 2026-10-25

- Safari 27.0 on macOS passed an isolated WebDriver smoke check after the user
  enabled remote automation: database startup, cross-origin isolation, default
  Brew Controller view, and all three tabs.
- Bean/brew writes, bean-name joins, dates/nulls, reload persistence, and
  second-tab database writes/reloads passed. No unhandled errors were observed
  during the instrumented write operations.
- Safari also loaded `dist/` from `/coffeeos/` on a plain static server; the
  service worker established isolation, local database assets initialized, and
  tab navigation worked.
- `uv run npm run test:safari` is the reusable primary-browser smoke test.
  Physical iPhone/iPad touch, viewport, Home Screen, and storage lifecycle checks
  remain unverified; desktop Safari results do not replace them.

---

## Stage 3: Bean Manager Tab (`src/views/beanManager.ts`)

* [x] **Status:** Completed

### Goal

Implement the **Bean Manager** tab so beans can be added and inspected along with all brew sessions logged for each bean.

### Tasks

1. **Add Bean Form:**
* At the top of the **Bean Manager** view, render a clean card/form to add a Bean:
* `Name` (text input, **required**)
* `Roast Date` (`<input type="date">`, optional)
* `Freeze Date` (`<input type="date">`, optional)
* `Add Bean` submit button.


* Submitting calls `addBean()`, resets the form, and refreshes the bean list.


2. **Bean List & Per-Bean Brew Sessions:**
* Render all beans below the form showing `name`, `roast_date` (if present), and `freeze_date` (if present).
* Under each Bean entry (or when tapped to expand), query/filter and display **all Brew Sessions registered for this Bean**, sorted by date descending (`brewed_at DESC`).
* For each session under a bean, display a compact summary row/card showing: Date/Time, `Dose (g)`, `Water (g)`, `Grind (um)`, `Temp (°C)`, `Time`, `Yield (g)`, `TDS%`, `Extraction%`, and `Comment`.



### Acceptance Criteria (Stage 3 Gate)

* User can create a Bean with only `Name`, or with optional `Roast Date` / `Freeze Date`.
* Reloading the page retains added Beans.
* Each Bean displays its associated Brew Sessions (or an empty state message like `"No brew sessions yet"`).
* `uv run npm run build` succeeds.
* **STOP HERE.**

### Verification — 2026-10-25

- `uv run npm run build` passed, including the application and Vite configuration
  type checks.
- Safari 27.0 on macOS passed `uv run npm run test:safari` in an isolated
  automation session: required/whitespace name validation, name-only and dated
  bean creation, form reset, duplicate submission prevention, list refresh, and
  reload persistence.
- Each bean displays its complete brew history in descending date order, with
  all requested metrics, timestamps, and comments. Safari verified bean filtering,
  empty histories, zero/null values, safe rendering of text containing markup,
  multiline comments, tab-entry refresh, and persisted histories after reload.
- A simulated IndexedDB storage failure preserved the entered form and existing
  list; retry succeeded with exactly one new bean.
- Safari at a 390px window width confirmed no horizontal overflow, 16px input
  fonts, and 44px input/button heights. Dev and preview responses include COOP
  `same-origin` and COEP `require-corp`.
- Safari also passed form creation and reload persistence on the production build
  served under `/coffeeos/` without host isolation headers. The service worker
  established isolation and local database assets loaded. A local compatibility
  patch retries bodyless conditional `304` responses without cache validators,
  fixing Safari's cached-worker startup stall on this static host after reload.
- Physical iPhone/iPad touch, keyboard/viewport, Home Screen, and storage lifecycle
  checks, plus actual deployed-host verification, remain unverified. Stages 4 and
  5 remain pending.

---

## Stage 4: Brew Controller Tab (`src/views/brewController.ts`)

* [x] **Status:** Completed

### Goal

Implement the default **Brew Controller** tab featuring the global chronological list of Brew Sessions and the `"New Session"` workflow with the two specification tables (`Input` and `Result`) and live Extraction calculation.

### Tasks

1. **Brew Sessions List View:**
* Display a prominent **`+ New Session`** button at the top of the **Brew Controller** tab.
* Below it, render all Brew Sessions sorted by date (`brewed_at DESC`).
* Each session card MUST prominently show the **Date/Time** and **Bean Name**, followed by the session's Input and Result metrics and any comment.


2. **"New Session" Creation Workflow:**
* Tapping **`+ New Session`** opens the New Session form (either inline panel or modal view) with a `Cancel` and `Save Session` button.
* **Bean Selector:** Dropdown (`<select required>`) populated with existing Beans from `getBeans()`. (If no beans exist yet, show a helpful prompt to add a bean in Bean Manager first).
* **Table 1 — Input Table:** Render a clean 2-column HTML `<table>` (Field | Value) containing inputs:
* `Dose (g)` — `<input type="number" step="0.1" inputmode="decimal">`
* `Water (g)` — `<input type="number" step="0.1" inputmode="decimal">`
* `Time` — `<input type="text" placeholder="e.g. 02:30">`
* `Temp (°C)` — `<input type="number" step="0.1" inputmode="decimal">`
* `Grind size (um)` — `<input type="number" step="1" inputmode="decimal">`
* `Comment` — `<input type="text">`


* **Table 2 — Result Table:** Render a clean 2-column HTML `<table>` (Field | Value) containing:
* `Yield (g)` — `<input type="number" step="0.1" inputmode="decimal">`
* `TDS%` — `<input type="number" step="0.01" inputmode="decimal">`
* `Extraction (%)` — **Read-only calculated field** (`<output>` or disabled input).




3. **Live Extraction Calculation:**
* On every `input` event on `Dose (g)`, `Yield (g)`, or `TDS%`, recompute:
`extraction_pct = (yield_g * tds_pct) / dose_g`
* If `dose_g > 0`, `yield_g > 0`, and `tds_pct > 0`, format to 2 decimal places (e.g., `20.45%`); otherwise display `—`.


4. **Save & Refresh:**
* Submitting calls `addBrewSession()`, returns to the Brew Controller list, and refreshes both the Brew Controller feed and Bean Manager session counts.



### Acceptance Criteria (Stage 4 Gate)

* Opening the app lands on **Brew Controller** showing sessions sorted by date with Bean names.
* Tapping **New Session** lets the user select a Bean, fill the Input Table and Result Table, see `Extraction (%)` calculate live, and save.
* Saved sessions immediately appear in both **Brew Controller** and under the corresponding bean in **Bean Manager**.
* `uv run npm run build` succeeds.
* **STOP HERE.**

### Additional requirement: Brewing control chart

- [x] Add a live chart below the Brew Session Result table, matching the supplied
  photo's extraction X axis (14–26%) and TDS Y axis (0.95–1.75%), grid, shaded
  regions, and quality labels: Strong Under-Developed, Strong, Strong Bitter,
  Under-Developed, Ideal / Optimum Balance, Bitter, Weak Under-Developed, Weak,
  and Weak Bitter.
- [x] Plot the current calculated EY and measured TDS with a result marker and
  dashed axis guides; update on dose, yield, and TDS edits and clear on cancel.
- [x] Provide readable result/region text, an empty state for invalid operands,
  and explicit feedback when the result is outside the photo's chart scales.
- [x] Keep the chart responsive within the mobile session form.

Chart verification — 2026-10-25: `uv run npm run build` passed. Safari 27.0 on
macOS passed the chart checks and existing session/save/persistence/IO suite on
both Vite dev and the production build at `/coffeeos/`. Chart checks cover live
coordinates and guides, all nine quality regions, invalid inputs, scale endpoints,
out-of-range feedback, accessible result text, cancel/reset, and no overflow at a
390px window width. Dev and preview isolation headers were confirmed. Physical
iPhone/iPad and actual deployed-host checks remain unverified.

### Verification — 2026-10-25

- `uv run npm run build` passed, including application and Vite configuration
  type checks. Both browser test scripts also passed Node's syntax check.
- Safari 27.0 on macOS passed `uv run npm run test:safari` in an isolated
  automation session: default Brew Controller feed, chronological ordering,
  bean names, both specification tables, required bean selection, optional
  measurements, and safe rendering of bean names and comments.
- Dose, yield, and TDS edits calculate extraction live; missing, zero, or
  negative operands display `—`. Two-decimal display and full-precision saved
  values were verified, along with zero/null metrics and reload persistence.
- Saving refreshes the feed and the hidden Bean Manager's histories/counts
  immediately. Repeated submissions save once; a simulated IndexedDB failure
  preserves the draft and both histories, and retry creates exactly one session.
- No-beans navigation, cancel/reset and focus return, and refreshing bean choices
  after tab navigation while preserving a draft all passed. At a 390px window
  width, the form has no horizontal overflow, 16px inputs/selects, and controls
  at least 44px high. Safari's native select sizing required custom appearance
  styling to honor the minimum height.
- Dev and preview COOP `same-origin` and COEP `require-corp` headers were
  confirmed. Safari also passed the form workflow, immediate history updates,
  and reload persistence on the production build served under `/coffeeos/`
  without host isolation headers; the service worker established isolation and
  local database assets loaded. No unhandled browser errors were observed.
- Physical iPhone/iPad touch, keyboard/viewport, Home Screen, and storage
  lifecycle checks, plus actual deployed-host verification, remain unverified.
  Stage 5 remains pending.

---

## Stage 5: IO Tab (Parquet & CSV Import/Export) + Deployment Polish

* [x] **Status:** Completed

### Goal

Build the **IO** tab so the user can export and import the entire database state as `.parquet` or `.csv` files (compatible with the iOS Files app / Share sheet) and add the GitHub Pages deployment workflow.

### Tasks

1. **Export Functionality (`src/db.ts` & `src/views/ioView.ts`):**
* Add buttons in the **IO** tab to **Export Parquet** and **Export CSV** (for `beans` and `brew_sessions`, or a combined/zipped export, plus a single-file denormalized export option).
* Use DuckDB's native `COPY beans TO 'beans.parquet' (FORMAT PARQUET)` and `COPY brew_sessions TO 'brew_sessions.parquet' (FORMAT PARQUET)` (and `(FORMAT CSV, HEADER)` for CSV).
* Extract file buffers via `db.copyFileToBuffer()` and trigger download/share (`navigator.share` with `File` on iOS if supported, falling back to `<a download>`).


2. **Import Functionality (`src/db.ts` & `src/views/ioView.ts`):**
* Provide file inputs accepting `.parquet` and `.csv` for restoring/merging `beans` and `brew_sessions`.
* Register the uploaded `Uint8Array` buffer into DuckDB via `db.registerFileBuffer()` and upsert rows (`INSERT OR REPLACE INTO ... SELECT * FROM read_parquet(...)` or `read_csv_auto(...)`), then flush to storage.
* Display a clear status toast showing how many Beans and Brew Sessions were imported.


3. **GitHub Actions Deployment (`.github/workflows/deploy.yml`):**
* Add a standard GitHub Pages workflow that installs Node LTS, runs `npm ci && npm run build`, and deploys `./dist` to GitHub Pages on push to `main`.



### Acceptance Criteria (Stage 5 Gate)

* User can export data to `.parquet` and `.csv` and re-import it cleanly without duplicating existing primary keys.
* `uv run npx tsc --noEmit` and `uv run npm run build` pass with zero errors.
* All 5 status checkboxes in `PLAN.md` are marked `[x]`.

### Verification — 2026-10-25

- `uv run npx tsc --noEmit` and `uv run npm run build` passed. Both existing
  browser scripts and the new IO checks passed Node's syntax check; the Pages
  workflow parsed as valid YAML with the expected build/deploy dependency.
- Safari 27.0 on macOS passed `uv run npm run test:safari`, including the
  existing bean/session workflows and two-file and combined CSV/Parquet exports.
  Both layouts preserve beans without sessions. All four backup variants also
  restored into an empty memory-only database, including empty backup round trips.
- File-input imports insert and update by primary key without duplicates,
  accept reordered columns, refresh both history views immediately, and persist
  after reload. Exact round trips preserved dates, timestamps, nulls, zeroes,
  full numeric precision, Unicode, quoted/multiline text, empty strings, and
  literal CSV null markers. Updating a referenced bean and moving a session to
  another bean both passed.
- Invalid schemas, duplicate IDs, invalid/nonfinite measurements and dates,
  corrupt Parquet, missing beans, and combined rows missing a session ID were
  rejected. Invalid batches and simulated IndexedDB snapshot failures left
  both tables unchanged; selected files remained available and retry succeeded.
- Prepared files have download links and a separate Share action to preserve
  user activation. Mocked sharing success, cancellation, and unsupported/error
  fallback passed. The IO view has no horizontal overflow at a 390px Safari
  window width, with 16px fields and controls at least 44px high.
- Dev and preview COOP `same-origin` and COEP `require-corp` headers were
  confirmed. The final production build passed Safari form/IO workflows and
  reload persistence under `/coffeeos/` on a plain static server without host
  isolation headers; the service worker established isolation and local
  database assets loaded. No unhandled browser errors were observed.
- `.github/workflows/deploy.yml` builds and deploys `dist/` on pushes to `main`
  or manual runs, using Node LTS and separate build/deploy jobs. Repository Pages
  must use the GitHub Actions source. The workflow has not run on GitHub and no
  deployment was published during this stage.
- Physical iPhone/iPad Files/Share sheet, touch, keyboard/viewport, Home Screen,
  and storage lifecycle checks, plus actual deployed-host verification, remain
  unverified. Desktop Safari and mocked sharing do not replace these checks.


---

## Cross-stage bug review — 2026-10-25

Reviewed the completed stages together, including database lifecycle, forms,
backup handling, the service worker, and deployment configuration. This review
supersedes the earlier acceptance of independent writable second-tab databases.

### Fixed

- **High — competing databases and lost snapshot updates:** a lifetime Web Lock
  now permits one database engine per origin. A competing tab shows a recoverable
  startup message rather than opening a separate dataset or overwriting another
  tab's snapshot. Closing the engine releases ownership.
- **High — backend changes hiding saved records:** startup remembers its durable
  backend. Existing fallback snapshots stay on IndexedDB when OPFS becomes
  available; an unavailable remembered OPFS database produces an error instead
  of an empty collection. Existing OPFS files are not silently bypassed after an
  open failure. Historical split datasets remain intact and are not auto-merged.
- **Medium — misleading retry after commit:** checkpoint/flush failures after a
  successful commit now tell the user the change already exists and to export a
  backup. Forms clear committed drafts and refresh histories; rolled-back writes
  still preserve drafts for retry. Import-buffer cleanup cannot mask a successful
  commit or the original import error.
- **Medium — invalid display values:** imports reject dates/timestamps outside
  years 0001–9999; direct CRUD rejects unsupported date strings and nonfinite
  measurements. This prevents accepted data from breaking date rendering.
- **Medium — invisible memory-only storage:** startup displays a warning and
  backup instructions when records will only last for the current tab.

### Verification

- Production build and TypeScript checks passed with the project-local toolchain.
- Safari 27.0 on macOS passed forms, navigation, chart, storage/reload, CSV/Parquet,
  rollback, second-tab exclusion, sticky fallback, and simulated post-commit
  flush-failure regressions in an isolated automation session.
- Safari also passed the production workflows under `/coffeeos/` on a plain
  static server without isolation headers. The service worker established
  isolation, and relative assets, forms, backup imports, and reload persistence
  worked. Dev and preview response headers were verified separately.
- Isolated Firefox passed both the EH/OPFS and forced MVP/IndexedDB suites,
  including backend capability loss, ownership release, corrupt snapshots,
  failed writes, invalid CRUD values, memory fallback, and teardown, with no
  unhandled browser exceptions/rejections.
- Physical iPhone/iPad touch, keyboard, Home Screen/storage lifecycle and native
  Files/Share interactions remain unverified. Actual GitHub Pages deployment
  remains unverified. The isolation service worker does not provide offline
  caching; that remains outside the implemented plan.

---

## Stage 6: Upgrade Compatibility & Persistent Data Protection

- [x] **Status:** Implemented and automated upgrade checks passed; platform/deployment limitations recorded in Stage 8

### Goal

Ensure future releases and refactors preserve existing beans, brew sessions, and
backups, and never make an existing user's database appear empty because storage
could not be opened or its identity changed.

### Tasks

1. **Preserve the data contract:**
   - Maintain existing IDs, bean/session relationships, field meanings and units,
     dates/timestamps, null/empty values, comments, and full numeric precision.
   - Keep prior stored formats and CSV/Parquet backups readable. Prefer additive,
     optional fields with defaults; introduce explicit schema/format versions and
     migrations when a change requires them.
2. **Preserve storage identity and safe startup:**
   - Keep `coffeos.db` / `coffeos.db.wal`, IndexedDB `coffeos-snapshots`, its
     `snapshots` store, `tables-v1`, `backend-v1`, and the `coffeos-database` lock
     stable. Any rename/backend move must locate and migrate existing records.
   - Preserve the deployment origin and storage access across releases. Document
     a transfer/recovery path before changing origin or deployment settings that
     could make saved data inaccessible.
   - Preserve existing lock, remembered-backend, and corrupt-snapshot guards.
     Open/restore/migration failures must retain original storage and show a
     recoverable error. New empty storage is for confirmed first use only.
   - Ensure startup, build/deploy, and service-worker/cache update paths never
     clear user databases, overwrite snapshots with empty tables, or silently
     switch to a different dataset. Destructive reset requires an explicit,
     separate user action.
3. **Make necessary migrations recoverable:**
   - Preserve a recoverable pre-migration copy, apply changes atomically where
     supported, and make retries idempotent. Interrupted/failed migrations must
     preserve existing records and prevent partially migrated data being used.
   - Detect unsupported/newer formats and preserve them behind a recoverable
     error; document rollback compatibility before changing the storage format.
4. **Add upgrade regression checks:**
   - Seed a previous build with representative beans and linked sessions, then
     replace it with the candidate build using the same isolated browser profile,
     origin, and repository subpath. Retain fixtures from supported prior formats.
   - Exercise OPFS and IndexedDB separately, repeated startup/reload, old backup
     imports, backend capability loss, lock contention, corrupt snapshots, and
     migration interruption/failure. Never use the user's normal browser profile.
   - Run Safari first and record results for affected future releases, including
     DuckDB upgrades, startup refactors, and service-worker/deployment changes.

### Acceptance Criteria (Stage 6 Gate)

- Replacing a previous build with the candidate build preserves every seeded bean
  and session, their IDs/relationships, and exact field values after startup and
  repeated reloads on both OPFS and IndexedDB. Verify values as well as counts.
- Existing records still render correctly; users can add a bean/session after
  upgrading and see both old and new records after reload.
- Historical CSV and Parquet fixtures import without data loss or duplicate IDs.
- Any required migration succeeds once, is safe to retry, and preserves the
  original data on interruption/failure; unsupported formats fail without mutation.
- Lock conflicts, lost storage access/isolation, restore failures, and corrupt
  snapshots preserve saved data and display a recoverable error. Restoring access
  exposes the original records; no empty replacement dataset is presented or saved.
- Build hashes, code refactors, and service-worker/cache updates leave storage
  identity and records intact. Any intentional identity/origin change has a tested
  migration or transfer path before release.
- `uv run npm run build` passes. Safari upgrade checks pass on the production
  repository subpath; physical iPhone/iPad Home Screen and storage lifecycle checks
  and actual deployed-host checks are recorded separately until verified.
- Every future stage affecting these paths includes the applicable upgrade checks
  in its acceptance criteria and verification notes.

### Verification — 2026-10-26

- Added mandatory compatibility/persistence rules to `AGENTS.md` and the global
  plan rules; corrected the conflicting global instruction allowing fallback on
  OPFS locks. Existing database guards and regression checks were inspected.
- `uv run npm run build` and `git diff --check` passed for this documentation
  update; no runtime behavior was changed.
- This update documents requirements only. Previous same-build persistence checks
  do not prove compatibility across releases. Previous-build upgrade fixtures,
  migration failure coverage, and physical iPhone/iPad/deployed-host upgrade checks
  remain pending; Stage 6 is not marked complete.

---

## Stage 7: Collapsible Bean Entries & Swipe-to-Delete

- [x] **Status:** Implemented; automated checks passed; physical-device checks pending

### Goal

Keep the mobile Bean Manager compact and let users explicitly delete a bean and
its attached brew sessions through a swipe-revealed action.

### Tasks

1. Show bean name, defined dates, and session count by default; toggle history on tap.
2. Reveal Delete on a left swipe, support closing it, and provide keyboard and
   assistive-technology access without interfering with vertical scrolling.
3. Add a transactional database deletion operation to remove the selected bean
   and all its sessions; surface failures and prevent duplicate submissions.
4. Build and verify collapse, gestures, deletion scope, persistence, and responsive
   layout in Safari; record unavailable device and upgrade checks explicitly.

### Acceptance Criteria (Stage 7 Gate)

- All entries initially hide history, including the empty-history message; summary
  tap and keyboard activation toggle only that entry and expose expanded state.
- Left swipe reveals a touch-sized Delete action without expanding history;
  right swipe closes it, and vertical gestures remain usable for scrolling.
- Explicit Delete removes the bean and every linked session, preserves unrelated
  records, and remains deleted after reload. Failures are visible and retryable.
- Storage identities, schema, backup formats, and startup behavior remain stable.
  Any storage implementation changes require populated previous-build OPFS and
  IndexedDB upgrade checks, old backup imports, and failed-upgrade preservation.
- Build and applicable Safari checks pass; production subpath/isolation checks
  and physical iOS/Android verification are recorded with their limitations.

### Verification — 2026-10-26

- Plan recorded before implementation. Cards now use native details/summary for
  collapsed history and keyboard activation. Left/right pointer gestures reveal/
  close Delete; vertical gestures are reserved for scrolling. An accessible actions
  button also reveals Delete, with focus support and Escape to close it.
- Added transactional cascade deletion with existing snapshot/flush semantics and
  duplicate-submission protection. DuckDB's eager foreign-key index prevents a
  simple child-then-parent DELETE in one transaction, so explicit deletion builds
  a retained-session table with identical constraints and swaps it transactionally.
  Failures roll back the original tables. No storage identity, field, backup format,
  dependency, deployment origin, or startup recovery policy changed.
- `uv run npm run build` and `git diff --check` passed. Node resolves inside the
  project `.venv`. Local Vite response headers include COOP `same-origin` and COEP
  `require-corp`; production assets loaded successfully at `/CoffeeOS/` in upgrade
  checks using the same headers.
- Added repeatable `uv run node tests/bean-upgrade.mjs` (Safari) and
  `TEST_FIREFOX=1 uv run node tests/bean-upgrade.mjs` (isolated Firefox) checks.
  The harness builds revision `2ccf66c` and current source with test-only DB access
  hooks, then replaces the served build within the same browser session and origin.
  Hooks are confined to `.cache` fixtures and are not shipped in the app build.
- Safari 27/macOS IndexedDB and isolated Firefox OPFS upgrade checks passed:
  exact records after replacement and reload, previous-build CSV/Parquet imports,
  failed-open preservation, collapse/toggle, synthetic left/right/vertical pointer
  gestures, duplicate-delete protection, deletion scope, reload durability, and
  subsequent session creation. Safari selects the IndexedDB runtime on this machine;
  Firefox OPFS results are not Safari OPFS verification.
- Injected failure during the table swap and IndexedDB snapshot-write failure
  preserve original beans/sessions after retry/reload; failures remain visible.
- `uv run npm run test:safari` passed the complete existing suite, including
  navigation, narrow layout, writes/reload, failure recovery, and all IO round trips.
  An earlier run lost its automation window during the final IO check; the full
  rerun completed successfully.
- Physical iPhone/iPad/Android swipe and scroll behavior, screen-reader operation,
  Home Screen lifecycle, Safari OPFS, and actual deployed-host headers remain
  unverified. Synthetic pointer checks do not establish native touch behavior.
  No deployment was performed; Stage 6's broader upgrade matrix remains pending.

---

## Stage 8: Complete Upgrade Resilience Guards & Regression Coverage

- [x] **Status:** Completed; automated gates passed, physical/deployed checks pending

### Goal

Finish Stage 6's startup protections and previous-build upgrade regression checks.

### Tasks

1. Reject inaccessible metadata, unknown backend markers, missing remembered data,
   and ambiguous legacy OPFS access instead of selecting an empty dataset.
2. Extend production-subpath previous-build checks with failure/recovery cases,
   exact data comparisons, historical backups, and post-upgrade writes.
3. Run Safari first, then isolated Firefox OPFS; document remaining platform gaps.

### Acceptance Criteria (Stage 8 Gate)

- Previous-build beans and sessions retain exact values across replacement/reloads
  on IndexedDB and OPFS; historical CSV/Parquet imports remain idempotent.
- Metadata/open/restore failures and unsupported markers preserve durable bytes,
  reject startup, and allow recovery after access is restored.
- No storage identifier, schema, backup format, or deployment origin changes.
- Build and applicable browser checks pass; unavailable migration, physical-device,
  and deployed-host checks are recorded explicitly.

### Verification — 2026-10-26

- Initial review: Stage 6 remains incomplete; Stage 7 supplies partial upgrade
  coverage. Existing uncommitted Stage 7 work is retained.

- Closed startup gaps in `src/db.ts`: metadata-open failures, unknown backend
  markers, missing remembered OPFS/snapshots, inaccessible legacy OPFS, unsupported
  stored column schemas, and invalid snapshot envelopes now reject startup.
  Existing files are inspected before creation; restore failures preserve original
  snapshots. New IndexedDB installs persist an empty snapshot before the marker.
- No storage identifiers, schema, dependency versions, units, backup formats,
  origin, or deployment settings changed. No migration is needed. Existing empty
  IndexedDB installs with a marker but no snapshot conservatively show a recovery
  error because missing records cannot safely be distinguished from first use.
  Automatic memory-only fallback is intentionally removed; older test assumptions
  were updated to use explicitly isolated test storage for empty backup imports.
- Added `test:upgrade` and `test:upgrade:firefox` npm commands. The fixture builder
  retains immutable prior revision `2ccf66c` as its source, includes each build's
  public assets/config, and refuses shared dependencies when lockfiles differ.
  Instructions and future migration/dependency/origin requirements are documented
  in `tests/UPGRADES.md`. No test hook is included in `dist/`.
- `uv run npm run test:upgrade` passed in Safari 27/macOS using IndexedDB, and
  `uv run npm run test:upgrade:firefox` passed in isolated Firefox using OPFS.
  Both replace the previous production build in the same profile/origin under
  `/CoffeeOS/`, update a service worker with changed bytes, compare every field
  after repeated reloads, import old CSV/Parquet without duplicates, and add new
  beans/sessions that survive reload. Existing collapse/delete regressions pass.
- Injected metadata-open and unsupported-backend/schema failures preserve exact
  durable byte digests and recover original records. IndexedDB additionally covers
  missing snapshots, invalid snapshot envelopes, corrupt Parquet, and interrupted
  restore. OPFS covers lost isolation, denied directory access, and missing-file
  access. Lock contention rejects opening; page-level metadata failure shows the
  startup recovery alert with no active database, then recovers on reload.
- `uv run npm run test:safari` passed all existing navigation, forms, narrow-layout,
  chart, writes/reloads, rollback, and CSV/Parquet tests. `uv run npm run test:db`
  passed Firefox database regressions, including corrupt snapshots and metadata
  denial. `uv run npm run build`, changed-script syntax checks, and
  `git diff --check` passed; Node resolves inside this project's `.venv`.
- Dev and preview responses both have COOP `same-origin` and COEP `require-corp`.
  Production subpath assets loaded in both upgrade suites. Worker replacement
  was checked with host isolation headers, not on a live GitHub Pages host.
- Safari OPFS, physical iPhone/iPad Home Screen/storage lifecycle, actual hosted
  upgrades/headers, and dependency-version upgrade fixtures remain unverified.
  No schema migration was introduced: restore interruption is covered, but future
  migrations still require their own versioned recovery-copy, interruption, retry,
  and rollback tests. No deployment was performed. Stage 6's current implementation
  and applicable automated gates are complete with these explicit limitations.

---

## Stage 9: Optional Compressed Bean Photos

- [x] **Status:** Completed; automated gates passed, physical-device checks pending

### Goal

Attach an optional photo when adding a bean and display it in the expanded bean
view, while preserving all existing records and historical backups.

### Tasks

1. Add a native image picker, compressed JPEG preview, and remove action.
2. Resize to a maximum 1600-pixel edge, encode at 80% JPEG quality (65%/50%
   fallback), and bound stored data URLs to 2 MB; reject unreadable images.
3. Add nullable `photo_jpeg` via schema v2, preserving the v1 Parquet recovery
   copy at `schema-v1-before-photos` before migration/first subsequent writes.
4. Preserve existing storage identities; include photos in CSV/Parquet exports,
   accept historical headers, and retain existing photos when merging old backups.
5. Verify Safari IndexedDB and Firefox OPFS upgrade paths and photo workflows.

### Acceptance Criteria (Stage 9 Gate)

- Beans may be saved with or without photos; preparation blocks submission,
  preview/removal work, failed saves retain entries, successful saves reset them.
- Expanded beans show their compressed JPEG; reload and all four CSV/Parquet
  export/import combinations preserve photos and all bean/session values.
- Previous populated builds upgrade at the same origin/profile without record
  loss; older CSV/Parquet imports work. Migration recovery copies are retained,
  and failed upgrades reject startup without presenting an empty collection.
- Build and targeted browser checks pass; physical-device and deployed-host gaps
  are explicitly recorded.

### Verification — 2026-10-26

- Preserved the pre-existing uncommitted Stage 7/8 work. No dependency, deployment
  origin, existing storage identifier, date/unit, or numeric field changed.
- Initial build passed. Safari upgrade testing found transferred snapshot buffers
  were detached before writing the recovery copy; restore now transfers a copy,
  retaining the original bytes. Verification continues below.
- `uv run npm run build` and `git diff --check` passed. Safari 27/macOS
  `test:safari` passed navigation, narrow layout, optional forms, write failures,
  reload persistence, and all existing CSV/Parquet regressions. Updated expected
  records and input counts for the new optional field/control.
- Safari IndexedDB and isolated headless Firefox OPFS previous-build suites
  passed at `/CoffeeOS/`: exact old bean/session values after replacement and
  reload, historical CSV/Parquet imports, and storage failure recovery. The
  original build reopened exact records after injected recovery-copy failures;
  candidate startup showed a recovery error rather than an empty collection.
- Photo checks passed: synthetic 2400×1800 PNG becomes 1600×1200 JPEG, form
  save/reset, expanded image, all four CSV/Parquet round trips, and reload.
  Firefox additionally verified removal and that legacy imports retain photos.
  Invalid-image decoding leaves stored records untouched.
- Local Vite response headers include COOP `same-origin` and COEP `require-corp`;
  production repository-subpath assets load in both upgrade suites. No dependency
  or hosting change was made, and no deployment was performed.
- Physical iPhone/iPad camera/library selection, HEIC decoding/orientation,
  Home Screen storage lifecycle, Safari OPFS, and actual deployed-host checks
  remain unverified. The native `accept="image/*"` picker allows the platform to
  offer camera/library choices; unsupported formats report a recoverable error.
- Final Firefox OPFS check passed with failure injected after `ALTER TABLE` but
  before commit: rollback allowed the original build to reopen every old record,
  and retry/reload succeeded. The retained recovery copy was not overwritten.

---

## Stage 10: Home Screen Bottom Navigation Layout

- [x] **Status:** Implemented; desktop Safari checks passed, physical iOS confirmation pending

### Goal

Remove the apparent unused browser-toolbar space beneath navigation in installed
Home Screen mode while retaining clearance for the iOS home indicator.

### Tasks

1. Use `100vh` in standalone display mode to avoid installed WebKit dynamic
   viewport under-sizing (https://bugs.webkit.org/show_bug.cgi?id=254868).
2. Place navigation in the shell's final flex row in that mode, prevent header
   and navigation shrinking, and remove the content's redundant overlay padding.
3. Preserve navigation safe-area padding and normal browser layout; verify the
   build, Safari regressions, and production repository-subpath layout.

### Acceptance Criteria (Stage 10 Gate)

- Standalone layout puts navigation at the shell bottom, with scrollable content
  ending above it and home-indicator padding retained.
- Desktop Safari startup, navigation, writes/reloads, and existing regressions pass.
- Production assets load under `/CoffeeOS/`; local dev/preview retain both isolation
  headers. Physical-device limitations are explicitly recorded.

### Verification — 2026-10-26

- `uv run npm run build` passed; Node resolves inside this project's `.venv`.
- `uv run npm run test:safari` passed on Safari 27/macOS, including navigation,
  narrow layout, bean/session writes and reloads, failure recovery, and CSV/Parquet
  round trips. This is desktop Safari verification, not iOS verification.
- A temporary Safari WebDriver check loaded the production `/CoffeeOS/` preview
  and explicitly applied the standalone media rule's CSS. At 390×844 and 844×500
  window sizes, with 0px and simulated 34px bottom padding, navigation ended at
  the viewport bottom, content ended at navigation's top, and no horizontal
  overflow occurred. This exercises layout geometry, not native standalone mode
  or actual device safe-area reporting.
- Dev and production preview returned COOP `same-origin` and COEP `require-corp`.
  `git diff --check` passed.
- Only CSS and this stage were changed for this refinement. Existing uncommitted
  work was preserved. Storage, startup, backups, dependencies, service workers,
  and deployment configuration were untouched; no migration or deployment occurred.
- Physical iPhone/iPad Home Screen gap resolution, rotation, keyboard dismissal,
  and actual hosted behavior remain unverified. Safe-area padding is intentionally
  retained so controls do not overlap the home indicator.

---

## Stage 11: Compact Mobile Brew Cards and Expandable EY Charts

- [x] **Status:** Implemented; Firefox and desktop Safari checks passed (Stage 12), physical iOS verification pending

### Goal

Make the Brew Controller easier to scan on an iPhone 15 Pro, with compact
summaries and full brew details available on tap.

### Tasks

1. Show date, bean name, and EY percentage in collapsed native disclosure cards.
2. Reveal the complete timestamp, measurements, comment, and existing brewing
   chart on expansion; create charts only when a card is first opened.
3. Reduce phone layout spacing, headings, card padding, and navigation height
   while preserving safe areas, 44px controls, and 16px form inputs.
4. Verify build, disclosure behavior, chart values, narrow layout, and regressions.

### Acceptance Criteria (Stage 11 Gate)

- Sessions start collapsed; tapping toggles full details and the saved EY/TDS chart.
- Missing EY displays a dash; missing chart measurements explain why no point is
  plotted; existing chart range feedback remains available.
- Long bean names wrap without horizontal overflow at 393px viewport width.
- Existing records and precision remain unchanged; local headers and production
  subpath assets remain valid. Browser/platform limitations are documented.

### Verification — 2026-10-26

- `uv run npm run build` passed; Node resolves inside the project's `.venv`.
- Dev and production preview return COOP `same-origin` and COEP `require-corp`.
- Safari was attempted first with `safaridriver`; session creation timed out
  connecting to Safari before any assertions ran. Safari verification is pending.
- Storage, startup, formats, dependencies, service workers, and deployment settings
  are unchanged. This presentation-only update requires no data migration.
- Physical iPhone/iPad touch, keyboard, Home Screen layout/storage lifecycle,
  hosted behavior, and previous-build upgrade paths were not tested for this stage.
- Isolated headless Firefox 158/macOS passed the production UI suite under
  `/CoffeeOS/` using a temporary adapter for the existing Safari assertions:
  startup/navigation, forms, chart coordinates/range feedback, compact summary,
  tap expansion/collapse, saved EY/TDS chart, long-name wrapping without overflow
  at 393×852, writes/reloads, and CSV/Parquet export/import regressions.
- Dev Firefox additionally passed summary fields, dates/nulls, bean filtering,
  safe comments, and history persistence before the temporary adapter stopped at
  an unsupported multi-window command. The full dev suite did not complete;
  production checks completed successfully. Temporary adapter files were removed.
- `git diff --check` passed. Touch targets remain at least 44px and form input
  text remains 16px in the narrow-window checks. Firefox results do not establish
  Safari or physical iPhone verification. No deployment was performed.

---

## Stage 12: Safari Automation Retry for Compact Brew Cards

- [x] **Status:** Completed; desktop Safari dev/production checks passed, intermittent fixture failure recorded

### Goal

Retry desktop Safari automation for Stage 11 and establish the current build's
navigation, compact-card, chart, and persistence regression results.

### Tasks

1. Reuse the project-local environment and available localhost Safari/Vite servers.
2. Build and run Safari checks against development and production `/CoffeeOS/`.
3. Investigate failures, preserve application storage behavior, and record results.

### Acceptance Criteria (Stage 12 Gate)

- Safari starts an isolated automation session and exercises startup/navigation,
  compact disclosure cards, charts, narrow layout, and bean/session writes/reloads.
- The production suite passes under `/CoffeeOS/`; development checks either pass
  or have a concrete failure and remaining verification gap documented.
- Build and local isolation-header checks pass; existing application data/storage
  behavior remains unchanged, with physical-device and upgrade limitations stated.

### Verification — 2026-10-26

- Node resolves inside this project's `.venv`; `uv run npm run build` passed.
- Safari 27.0/macOS automation connected successfully through the existing driver.
  Existing dev/preview servers were reused; localhost requests required sandbox
  escalation. Both responses include COOP `same-origin` and COEP `require-corp`.
- `TEST_PRODUCTION=1 TEST_BASE_URL=http://127.0.0.1:4173/CoffeeOS/ uv run npm run
  test:safari` passed: startup/navigation, validation, writes/reloads, live and saved
  charts, collapsed-card expansion/collapse, narrow layouts, CSV/Parquet UI exports
  and imports, atomic invalid-import rejection, and import reload persistence.
- Initial development run passed UI/chart/disclosure checks, database writes/joins,
  dates/nulls, histories, tab ownership, save rollback/retry, post-commit warnings,
  and exact CSV/Parquet round trips. It failed in the empty-engine backup fixture
  with an OPFS/cross-origin-isolation recovery error. A temporary diagnostic
  run passed, and a final unchanged `uv run npm run test:safari` rerun passed
  completely, including all four empty-engine backup restores. The initial
  failure did not reproduce; its cause remains unconfirmed. No fix is claimed.
- Physical iPhone/iPad touch, keyboard/viewport, Home Screen/storage lifecycle,
  Safari OPFS upgrades, previous-build upgrades, and hosted behavior are not
  established by this rerun. No application, dependency, or deployment change.
- `git diff --check` passed. Temporary diagnostic scripts were removed; only
  this plan was edited during the retry. Pre-existing application/test edits were
  preserved. No normal browsing profile was used or server process stopped.

---

## Stage 13: Contain Bean Date Fields on Narrow iPhone Layouts

- [x] **Status:** Implemented; desktop Safari checks passed, physical iOS confirmation pending

### Goal

Keep the Bean Manager's roast and freeze date inputs within their form card and
aligned with the name input on narrow screens, including iPhone 15 Pro width.

### Tasks

1. Check actual date-field bounds at exact phone widths, with empty and filled dates.
2. Remove native date-control appearance that can override iOS sizing; retain
   native date inputs, existing border-box sizing, padding, and minimum touch size.
3. Build, verify Safari layout and application regressions, and check production
   repository-subpath assets and local isolation headers.

### Acceptance Criteria (Stage 13 Gate)

- At 320–420px viewport widths, both date fields match the name field's width
  and remain within the card, empty or populated, without horizontal overflow.
- Above the existing mobile breakpoint, dates fit their two grid columns.
- Date values retain their meaning and native input type; inputs remain at least
  44px high with 16px text. Bean/session writes and reload persistence still pass.
- Build, desktop Safari checks, production `/CoffeeOS/` assets, and local isolation
  headers pass; physical iOS and other unverified paths are explicitly recorded.

### Verification — 2026-10-26

- Before the change, Safari 27/macOS passed exact-width layout checks at 320,
  375, 390, 393, 420, 430, and 852px, with empty and populated dates. This does
  not reproduce or rule out the iOS-specific issue: WebKit bug 301648 documents
  date/time inputs calculating padded 100% widths incorrectly on iOS while
  macOS works (https://bugs.webkit.org/show_bug.cgi?id=301648).
- Added scoped date appearance/width constraints and an internal value minimum
  height/alignment rule. No storage, schema, startup, backup, dependency,
  service-worker, or deployment changes; no data migration is needed.
- `uv run npm run build` passed; Node resolves inside this project's `.venv`.
- Post-change exact-width checks passed on Safari 27/macOS against development
  and production `/CoffeeOS/`, using same-origin iframe fixtures with the actual
  form markup and stylesheet to control the CSS viewport precisely. At 393×852,
  the name and both date fields were each 327px wide, within the 361px card.
  All seven widths above passed empty/populated date checks without overflow;
  two-column dates fitted their grid cells at 430 and 852px. Production computed
  styles confirmed `appearance: none` and `border-box`; native `type="date"`,
  values, 16px text, and at least 44px input height were preserved.
- `uv run npm run test:safari` passed fully: startup/navigation, bean/session
  saves and reloads, chart/disclosure regressions, failure recovery, exact
  CSV/Parquet round trips, and all empty-engine backup fixtures.
- `TEST_PRODUCTION=1 TEST_BASE_URL=http://127.0.0.1:4173/CoffeeOS/ uv run npm run
  test:safari` passed, including production UI imports and reload persistence.
  The preview served the newly built stylesheet under `/CoffeeOS/assets/`.
- Dev and production preview returned COOP `same-origin` and COEP `require-corp`.
  `git diff --check` passed. Isolated Safari automation sessions were used;
  temporary layout-check files were removed and existing servers left running.
- Physical iPhone/iPad date-picker interaction, keyboard/viewport behavior, Home
  Screen mode, hosted behavior, and previous-build storage upgrades remain
  unverified. Existing uncommitted project changes were preserved.

---

## Stage 14: Single-Page iPhone Brew Editor

- [x] **Status:** Implemented; Firefox layout/production checks passed, Safari automation unavailable, physical iOS pending

### Goal

Fit brew entry into an iPhone 15 Pro portrait viewport, with the live extraction
chart above compact input/output columns and field labels that focus their inputs.

### Tasks

1. Hide shell branding, Brew Controller introduction, and bottom navigation while
   the brew editor is visible; restore them on cancel, save, or another view.
2. Move the existing live chart above the bean selector and two measurement
   groups, with inputs on the left, outputs and comment on the right.
3. Retain native labeled inputs, decimal precision, optional fields, safe-area
   padding, 16px input text, 44px controls, and recoverable save failures.
4. Build, verify Safari regressions and exact 393×852 CSS-pixel layout, capture
   a screenshot, and check local isolation headers and production subpath assets.

### Acceptance Criteria (Stage 14 Gate)

- The normal populated editor fits at 393×852 without scrolling or horizontal
  overflow; all fields and Save/Cancel are visible with the keyboard closed.
- The chart precedes the fields, input/output groups sit side by side, and
  tapping an editable field label focuses its associated input.
- Navigation and introductory headings are hidden only during visible brew
  editing, then return on exit; the chart, save/cancel, and persistence still work.
- Build and browser regressions pass, with Safari attempted first and a documented
  Firefox fallback when unavailable. An exact-viewport screenshot is available;
  physical-device and other unverified checks are stated.

### Verification — 2026-10-26

- Final `uv run npm run build` passed; Node resolves inside this project's
  `.venv`. `git diff --check` passed.
- Safari was attempted first, then retried with `uv run npm run test:safari`.
  Both attempts failed to create an automation session: safaridriver timed out
  connecting to Safari before any assertions ran. No Safari pass is claimed.
- An initial isolated headless Firefox 158.0.1/macOS run passed the production UI suite under
  `/CoffeeOS/`, using a temporary BiDi adapter for the Safari assertions:
  startup/navigation, bean/session saves and reloads, live and saved charts,
  cancel/reset and shell restoration, disclosure cards, CSV/Parquet UI exports
  and re-imports, atomic invalid-import rejection, and import reload persistence.
- After the final touch-target/number-input refinements, a production repeat
  passed the editor, chart, save/reload, and IO export/import assertions but
  Firefox exited during the final IO reload; adapter cleanup then timed out on
  `browsingContext.close`. That repeat did not complete. The final-build targeted
  editor capture/save-failure/retry/reload check passed separately. No browser
  crash fix is claimed; the full final-build production rerun remains incomplete.
- Added exact-width frame checks using the app's actual DOM and stylesheet.
  At 320, 375, 393, and 430px, fields stayed in their columns without horizontal
  overflow. At 393×852 the populated editor fitted without vertical scrolling,
  both with no safe areas and simulated 59px top/34px bottom safe areas. All
  nine editable labels focused their native controls; inputs retained 16px text
  and at least 44px height. These are desktop layout checks, not native iOS tests.
- Captured `.cache/brew-editor-iphone-15-pro.png` at 393×852 CSS pixels and 3×
  device scale; its PNG dimensions are exactly 1179×2556, verified with `sips`.
  The Firefox-rendered preview reserves simulated safe areas, contains sample
  data, and excludes native system/browser chrome. It is not a device screenshot.
- A targeted injected brew-insert failure passed: the draft and live extraction
  remained visible, buttons re-enabled, navigation stayed hidden, retry saved
  exactly once, shell navigation returned, and the saved session survived reload.
- The development Firefox suite passed UI/chart checks, OPFS writes/reloads,
  dates/nulls, histories, and tab ownership, then stopped in the pre-existing
  capability-loss/fallback fixture with `Cannot inspect saved OPFS storage`.
  A temporary assertion adaptation accepted that recovery error instead of the
  expected `needs OPFS` wording, but fallback initialization still failed with
  access deliberately removed. The full development storage suite did not pass;
  no application storage change or fix is claimed. The targeted save-error check
  above was run separately. Temporary Firefox adapters were not committed.
- Dev and production preview returned COOP `same-origin` and COEP `require-corp`.
  Production was served using `vite preview --base /CoffeeOS/` on port 4174;
  compiled stylesheet and application assets resolved under the repository path.
- Presentation and save-button disabled-state changes only. Storage identity,
  database schema, startup, import/export formats, dependencies, service workers,
  deployment origin, and hosting configuration are unchanged; no migration.
- Physical iPhone/iPad touch, software keyboard, Home Screen safe-area/storage
  lifecycle, previous-build storage upgrades, and actual host remain unverified.

---

## Stage 15: Direct Brew Session Editing and Fixed Save/Cancel

- [x] **Status:** Implemented; Safari UI/layout and both storage upgrade checks passed; physical iOS pending

### Goal

Open existing brew sessions directly in the full editor and keep Save/Cancel
attached to the bottom of the viewport for a fast iPhone workflow.

### Tasks

1. Replace session disclosures with accessible edit buttons and populate the
   editor with the selected brew, including an editable local brew date/time.
2. Save changes through a transactional update of the original record; preserve
   IDs, unchanged dates, precision, nulls, whitespace, and imported EY values.
   Recalculate EY when dose, yield, or TDS changes; keep cancel non-mutating.
3. Fix the action bar to the viewport bottom, account for safe areas and reserve
   content space; retain scroll access on shorter screens and with larger text.
4. Verify Safari behavior, 393×852 geometry, failures/retry, reload persistence,
   previous-build OPFS/IndexedDB upgrades, old backups, and production subpaths.

### Acceptance Criteria (Stage 15 Gate)

- Each brew-feed session opens a populated editor directly; all user-entered
  values and bean association/date can be updated and saved without duplication.
- Cancel discards changes; opening again restores saved values. Unchanged saves
  retain exact data, including imported values and multiline/empty comments.
- Save/Cancel stay at the screen bottom independently of scroll, with safe-area
  padding. Normal 393×852 editing fits with the keyboard closed.
- Failed edits retain the draft and existing stored record; retry and reload
  preserve the edited record with its original ID.
- Build and Safari checks pass; populated prior-build data and old CSV/Parquet
  remain readable. Physical-device and other unverified paths are documented.

### Verification — 2026-10-26

- `uv run npm run build` and `git diff --check` passed. Node resolves to
  `/Users/kkrol/Projects/CoffeeOS/.venv/bin/node`.
- Desktop Safari 27.2 production UI suite passed at
  `http://127.0.0.1:4176/CoffeeOS/`: startup/navigation, new-session saves,
  direct edit opening, populated charts, cancel/reset, reloads, CSV/Parquet
  exports/imports, duplicate prevention, and invalid-import rollback.
- Safari exact-width frame checks passed at 320, 375, 393, and 430px without
  horizontal overflow. New and existing editors fit 393×852 without scrolling,
  including simulated 59px top/34px bottom safe areas. Controls retain 16px text
  and 44px minimum height. Forced content scrolling leaves the action bar fixed
  at the viewport bottom; field labels focus their inputs.
- Populated upgrades from `2ccf66cbf840e9455d54f8b31d57b4df944e3bf6` passed in
  isolated Safari (IndexedDB) and Firefox (OPFS), each replacing builds at the
  same origin and profile. Exact records, old CSV/Parquet imports, reloads,
  failed startup/migration recovery, and existing photo/deletion checks passed.
  Safari selected IndexedDB when OPFS was requested; Firefox supplies the OPFS
  verification, not a Safari OPFS pass.
- Targeted edit checks passed on both backends: unchanged numeric precision,
  dates, nulls, empty strings, multiline/whitespace comments and imported EY;
  cancel/reopen; editing every field and bean relationship; original ID retained;
  failure rollback and database reopen; retry, double-submit prevention and reload.
- Final Safari IndexedDB and Firefox OPFS upgrade runs also confirmed that an
  unchanged edit preserves sub-millisecond timestamps byte-for-byte in CSV
  exports, including native date-input normalization.
- Dev and preview responses include COOP `same-origin` and COEP `require-corp`;
  production assets load under `/CoffeeOS/`.
- No schema, storage identifiers, import/export formats, dependencies, service
  worker, deployment origin, or hosting settings changed.
- Physical iPhone/iPad touch, native date picker, software keyboard, browser
  chrome, enlarged text, Home Screen safe areas/storage lifecycle, and deployed
  host remain unverified. Desktop frame geometry is not a physical-device test.
- Existing uncommitted Stage 14 changes were preserved and extended.

---

## Stage 16: Swipe to Delete Brew Sessions

- [x] **Status:** Implemented; Safari UI/IndexedDB and Firefox OPFS checks passed; physical iOS pending

### Goal

Match Bean Manager's swipe-left delete interaction in the all-sessions feed,
while retaining normal tap access to the full brew editor.

### Tasks

1. Reveal a separate Delete button on a deliberate left swipe; dismiss with a
   right swipe or Escape, preserve vertical scrolling, and suppress swipe clicks.
2. Provide the analogous keyboard-accessible actions button and delete only the
   selected session through the existing transactional persistence path.
3. Refresh session counts and bean histories, prevent repeated submissions, and
   keep failed deletions recoverable with accurate post-commit warnings.
4. Build and check Safari interactions, production subpath assets/isolation,
   populated previous-build upgrades on both storage backends, and old backups.

### Acceptance Criteria (Stage 16 Gate)

- Left swipe reveals Delete without opening the editor or deleting anything;
  normal tap opens the full editor. Right swipe/Escape dismiss; vertical scroll,
  short gestures and cancelled gestures do not reveal deletion.
- Actions/Delete are accessible buttons with at least 44px touch targets;
  session cards fit phone widths without horizontal overflow.
- Explicit Delete removes exactly the selected session, preserves all beans and
  sibling records exactly, updates counts/histories, and survives reload.
- Failed deletion preserves original durable records and permits retry; a
  post-commit failure refreshes the collection and requests a backup.
- Build and Safari checks pass; populated previous-build OPFS/IndexedDB fixtures
  and old CSV/Parquet remain readable. Unverified device/host checks are recorded.

### Verification — 2026-10-26

- `uv run npm run build` passed; Node resolves inside the project's `.venv`.
  Existing uncommitted Stage 14/15 work is preserved.
- Desktop Safari 27.2/macOS passed the production `/CoffeeOS/` workflow suite:
  startup/navigation, bean/session writes and reloads, direct edit/cancel,
  charts, fixed editor actions, and CSV/Parquet UI import/export regressions.
- Safari IndexedDB populated upgrade checks from
  `2ccf66cbf840e9455d54f8b31d57b4df944e3bf6` passed at the same origin/profile:
  exact records, old CSV/Parquet, reloads, failed startup/migration preservation,
  and existing photo/bean deletion regressions.
- Safari targeted session checks passed: swipe-click suppression, normal tap
  editing, right swipe/Escape dismissal, keyboard actions, vertical/short/cancelled
  gestures, one-session deletion, unchanged beans/siblings, count/history refresh,
  rollback and retry, duplicate-click protection, and successful-delete reload.
  Actual app DOM/CSS in exact-width frames fitted 320, 375, 393 and 430px without
  horizontal overflow; Edit/Actions/Delete targets were at least 44×44px.
- Post-commit CHECKPOINT failure shows the backup warning and refreshes the live
  collection. The check deliberately does not promise durability after a failed
  checkpoint; the committed collection remains available for backup. An initial
  test assumed reload durability despite that injected failure; its expectation
  was corrected. A separate initial test hook was also corrected across reloads.
- Isolated headless Firefox OPFS populated upgrade checks passed from the same
  previous revision and origin/profile: exact records, old backups, failed
  startup/migration recovery, edits, all targeted session gesture/deletion
  checks above, backup export after post-commit failure, and photo regressions.
  Safari supplies IndexedDB verification; no Safari OPFS pass is claimed.
- Development and production preview responses returned COOP `same-origin` and
  COEP `require-corp`. Newly built JS/CSS resolved with HTTP 200 beneath
  `/CoffeeOS/assets/`. `git diff --check` passed.
- No schema, storage identifiers, field meanings, import/export formats,
  dependencies, service workers, origin, or hosting settings changed.
- Browser checks use isolated automation sessions and synthetic pointer gestures.
  Physical iPhone/iPad touch/scroll arbitration, native keyboard, Home Screen
  storage lifecycle and deployed-host behavior remain unverified.

---

## Stage 17: Compact Brew Editor Header and Larger Chart

- [x] **Status:** Implemented; desktop Safari checks passed; physical iOS pending

### Goal

Give the brew chart more space on phones, with optional timestamp editing in
the session header and consistently aligned Cancel/Save actions.

### Tasks

1. Show the existing brewed timestamp beside Edit Session as a tap target that
   reveals and focuses the native date/time input; collapse it on each opening.
2. Remove the visible Your brew caption while retaining accessible chart feedback,
   and increase the phone chart from 160px to 240px (220px on shorter viewports).
3. Normalize action-button margins and grid sizing to keep both buttons aligned.
4. Build and verify Safari layout, timestamp disclosure, persistence regressions,
   isolation headers, and production repository-subpath assets.

### Acceptance Criteria (Stage 17 Gate)

- Editing opens with the date input collapsed; tapping the header timestamp
  reveals/focuses it, and toggling visibility preserves its value.
- Existing timestamp precision is preserved when unchanged through the existing
  save comparison; only an explicit timestamp change updates it.
- The chart is larger at phone widths, with no visible Your brew caption;
  screen-reader chart descriptions remain available.
- Cancel and Save occupy the same row with matching vertical bounds. At 393×852
  the collapsed editor fits with simulated 59px top/34px bottom safe areas;
  320, 375, 393, and 430px layouts have no horizontal overflow.
- Build and Safari checks pass; existing data formats and storage identity remain
  unchanged, and physical-device limitations are documented.

### Verification — 2026-10-26

- `uv run npm run build` passed after correcting an input-helper declaration
  ordering error caught by TypeScript. `git diff --check` passed.
- Desktop Safari 27.2/macOS development and production `/CoffeeOS/` suites passed:
  startup/navigation, bean/session writes and reload persistence, chart behavior,
  editor cancel/reset, and CSV/Parquet import/export regressions.
- Production checks confirmed collapsed timestamp editing, tap-to-focus,
  expanded-state accessibility, and unchanged input value after toggling.
  The existing unchanged-date save comparison remains intact; no database write
  or timestamp conversion semantics were changed.
- Exact-width Safari frame checks passed at 320, 375, 393, and 430px:
  aligned Cancel/Save bounds, chart height at least 220px (240px at 393×852),
  visually hidden caption, no horizontal overflow, and 44px/16px form controls.
  The 393×852 editor fits with simulated 59/34px safe areas.
- Development and production preview returned COOP `same-origin` and COEP
  `require-corp`; generated JS/CSS returned HTTP 200 under `/CoffeeOS/assets/`.
- UI-only changes: no schema, persistence/startup code, storage identifiers,
  backup formats, dependencies, service workers, deployment origin, or hosting
  settings changed. Previous-build OPFS/IndexedDB upgrade checks were not rerun;
  this stage does not claim new upgrade-path verification.
- Physical iPhone/iPad native picker, software keyboard, Safari browser chrome,
  actual reported button gap, Home Screen behavior, and deployed-host checks
  remain unverified. Desktop Safari geometry does not replace device testing.

---

## Stage 18: Direct Header Date Picker and Aligned Tasting Notes

- [x] **Status:** Implemented; desktop Safari development/production checks passed; physical iOS pending

### Goal

Open the native date/time picker directly from the Edit Session header without
adding a Brewed field, and align Tasting notes with the Grind input beside it.

### Tasks

1. Place the native date/time input over its visible header timestamp, retaining
   an accessible name, keyboard focus indicator, and existing save semantics.
2. Remove the timestamp disclosure row and place Comment/Tasting notes in the
   output table's matching rows so its input aligns with Grind.
3. Build and verify Safari editing, phone-width geometry, persistence regressions,
   isolation headers, and production repository-subpath assets.

### Acceptance Criteria (Stage 18 Gate)

- The header timestamp is the native date/time control's tap target; editing it
  never reveals an additional Brewed row or shifts the chart/form layout.
- Timestamp changes update the visible header; unchanged timestamps retain the
  existing precision-preserving save comparison and cancel remains non-mutating.
- Tasting notes and Grind have matching top/bottom bounds within 1px at 320, 375,
  393, and 430px, including simulated safe areas, without horizontal overflow.
- Build and Safari development/production checks pass; storage identity and
  backup formats stay compatible. Physical-device limitations are documented.

### Verification — 2026-10-26

- `uv run npm run build` and `git diff --check` passed. Node resolves to
  `/Users/kkrol/Projects/CoffeeOS/.venv/bin/node`.
- Desktop Safari 27.2/macOS development suite passed: startup/navigation,
  bean/session writes and reloads, editor opening/cancel, chart behavior, failed
  save/retry, storage recovery guards, and CSV/Parquet import/export regressions.
- Exact-width Safari checks passed at 320, 375, 393, and 430px with and without
  simulated safe areas: Grind/Tasting notes bounds align within 1px, controls
  retain 44px/16px sizing, and no horizontal overflow. The 393×852 editor fits
  with simulated 59px top/34px bottom safe areas; actions remain fixed.
- Safari confirmed the extra date row is absent, the header label focuses the
  native date/time input, and hit testing over the timestamp targets that input.
- Desktop Safari production suite passed at `http://127.0.0.1:4173/CoffeeOS/`:
  startup/navigation, writes/reloads, both editor layouts, header date targeting,
  chart checks, and CSV/Parquet UI import/export with reload persistence.
- Dev and production preview responses returned COOP `same-origin` and COEP
  `require-corp`; compiled application/style assets loaded under `/CoffeeOS/`.
- UI-only changes: no schema, persistence/startup code, storage identifiers,
  backup formats, dependencies, service workers, origin, or hosting changes.
  The precision-preserving timestamp comparison is unchanged. Previous-build
  OPFS/IndexedDB upgrades were not rerun; no new upgrade verification is claimed.
- Physical iPhone/iPad native-picker interaction, software keyboard, Home Screen
  behavior/storage lifecycle, and deployed-host checks remain unverified.

---

## Stage 19: Larger Brew Graph with Tighter Measurement Spacing

- [x] **Status:** Implemented; desktop Safari checks passed; physical iOS pending

### Goal

Enlarge the session editor's brew graph by 20% while keeping the measurements
and fixed Cancel/Save actions usable on an iPhone 15 Pro sized screen.

### Tasks

1. Increase the editor chart height limit from 240px to 288px, and from 220px
   to 264px on shorter viewports, preserving the graph's proportions.
2. Tighten chart/bean gaps, table captions, and measurement-row padding while
   retaining 16px input text, 44px touch targets, and aligned Grind/Tasting notes.
3. Build and verify Safari phone geometry, editing and reload regressions,
   isolation headers, and production repository-subpath assets.

### Acceptance Criteria (Stage 19 Gate)

- The chart renders at 288px high at 393×852, 20% taller than the previous
  editor; the shorter-viewport limit increases by the same proportion.
- At 393×852 with simulated 59px top/34px bottom safe areas, all measurements
  fit without scrolling or overlap with the fixed actions. Grind/Tasting notes
  remain aligned within 1px; controls retain 16px text and at least 44px height.
- Phone layouts at 320, 375, 393, and 430px have no horizontal overflow;
  smaller heights retain scroll access and fixed Cancel/Save buttons.
- Build and Safari checks pass; storage identity and backup formats remain
  unchanged. Physical-device and other unverified paths are recorded.

### Verification — 2026-10-27

- `uv run npm run build` passed; Node resolves inside the project's `.venv`.
  `git diff --check` passed.
- Desktop Safari 27.2/macOS measured the chart at 288px versus the previous
  240px at 393×852. With simulated 59px top/34px bottom safe areas, content
  fits without scrolling; the measurement tables end at 711px and the fixed
  action bar starts at 749px. Grind/Tasting notes align within 1px.
- Exact-width Safari checks passed at 320, 375, 393, and 430px without horizontal
  overflow. Fields retain 16px text and at least 44px height; Cancel/Save remain
  aligned and fixed during content scrolling. Shorter 393×759 and 393×680
  frames use the 264px chart limit and retain vertical scrolling.
- The development Safari suite passed startup/navigation, bean/session writes
  and reloads, chart/editor behavior, failed-save retry, storage recovery guards,
  and CSV/Parquet import/export regressions. The final spacing refinement also
  passed the full production UI suite, including both new/existing editor frame
  checks, at `http://127.0.0.1:4173/CoffeeOS/` with `TEST_PRODUCTION=1`.
- The first production invocation omitted `TEST_PRODUCTION=1` and stopped at a
  development-only database-module import; the correctly configured rerun passed.
- Development and preview responses returned COOP `same-origin` and COEP
  `require-corp`; compiled JS/CSS assets returned HTTP 200 under `/CoffeeOS/`.
- CSS-only change: no persistence/startup code, schema, storage identifiers,
  field meanings, backup formats, dependencies, service workers, origin, or
  hosting changes. Previous-build OPFS/IndexedDB upgrade checks were not rerun;
  no new upgrade-path verification is claimed.
- Physical iPhone/iPad touch, software keyboard, Safari browser chrome, enlarged
  text, Home Screen safe areas/storage lifecycle, and deployed-host behavior
  remain unverified. Desktop Safari frame checks do not replace device testing.

---

## Stage 20: Proportional Session Editor Fit

- [x] **Status:** Implemented; desktop Safari development/production checks passed; physical iOS pending

### Goal

Scale the entire session editor together on smaller phones and use available
height without leaving spare space beneath the measurements.

### Tasks

1. Use a shared CSS scale derived from available viewport width/height and safe
   areas, with a 393×759 usable reference viewport and an 80% minimum scale.
2. Give the editor a scrolling body and a separate persistent action row; let
   the chart fill remaining height instead of assigning device-specific heights.
3. Preserve native input font sizing before visual scaling, data semantics,
   timestamp targeting, error recovery, navigation and save/cancel behavior.
4. Verify Safari phone/landscape geometry, scroll fallback, writes/reloads,
   backup regressions, production subpath assets, isolation headers and build.

### Acceptance Criteria (Stage 20 Gate)

- Header, graph, tables, inputs and actions share the same proportional scale;
  smaller screens reduce the whole editor rather than only the graph.
- At 393×852 and 375×667, including simulated 59/34px safe areas, the normal
  editor fits without scrolling. Only intentional padding remains between the
  measurements and actions; extra available height belongs to the graph.
- At 320, 375, 393 and 430px widths and in landscape, fields remain reachable
  without horizontal overflow; very short layouts scroll rather than shrinking
  below 80%. Actions remain at the viewport bottom independently of scrolling.
- Save/cancel, timestamp interaction, visible recoverable errors and persistence
  regressions pass. Storage identifiers, schema and backup formats stay stable.
- Build and Safari checks pass; physical-device and upgrade-path limits are
  recorded explicitly.

### Verification — 2026-10-27

- `uv run npm run build` and `git diff --check` passed using the existing local
  `.venv`/Node installation; no new runtime dependency or layout script added.
- Desktop Safari 27.2/macOS development suite passed startup/navigation,
  bean/session writes and reloads, date-input targeting, chart/editor behavior,
  save/cancel, failed-save retry, storage recovery guards and CSV/Parquet
  import/export regressions. Existing fixed-44px visual-size assertions were
  updated to verify the intended shared scale and unchanged 16px CSS input font.
- Production Safari UI suite passed at `http://127.0.0.1:4173/CoffeeOS/` with
  `TEST_PRODUCTION=1`, including backup import/reload persistence.
- Actual DOM/CSS frame checks passed at 320×568, 320×852, 375×667, 375×812,
  393×680, 393×852, 430×932 and 852×393, both with and without simulated
  59px top/34px bottom safe areas. The shared scale matches both viewport
  dimensions, controls/labels remain aligned, and no horizontal overflow occurs.
- Normal 393×852 and 375×667 editors fit without scrolling with simulated safe
  areas. At 393×852, the chart grows to 314px, measurements end at 737px and
  actions start at 749px: the remaining gap is the intentional 12px padding.
- Very short/landscape layouts stop shrinking at 80%; scrolling reaches the
  final Comment input above the actions. Added-content scrolling leaves actions
  pinned to the viewport bottom. Label focus and header timestamp hit testing
  passed, including the visually scaled control geometry.
- This deliberately scales 44px controls down to at least 35.2px visually and
  keeps their computed input font at 16px. Physical iOS focus/automatic zoom,
  touch precision and software-keyboard behavior remain unverified.
- Dev and preview returned COOP `same-origin` and COEP `require-corp`; compiled
  JS/CSS assets returned HTTP 200 beneath `/CoffeeOS/assets/`.
- Changes are limited to editor markup/CSS and browser checks. No persistence,
  startup, schema, storage identifier, field-meaning, backup-format, dependency,
  service-worker, deployment-origin or hosting changes. Previous-build OPFS and
  IndexedDB upgrade suites were not rerun; no new upgrade-path pass is claimed.
- Physical iPhone/iPad, enlarged text, Safari browser chrome, Home Screen
  behavior/storage lifecycle and deployed-host checks remain unverified.
  Browsers lacking the CSS scale calculation retain an unscaled scrolling
  layout; that compatibility fallback was not tested in an older browser.

---

## Stage 21: Compact Bean Editor and Pinned Bean Histories

- [x] **Status:** Implemented; desktop Safari development/production and IndexedDB upgrade checks passed; physical iOS pending

### Goal

Open the bean form from a compact button and fit its fields and submit action
on an iPhone 15 Pro screen. Inspect long bean histories beneath a pinned bean
heading, then return to the same place in the collapsed collection with a tap.

### Tasks

1. Start with an accessible Add a bean toggle; preserve drafts when closing and
   reopen the editor when navigating from the Brew Controller's no-beans prompt.
2. Compact the name, optional dates and photo controls, including photo preview,
   while preserving input sizes, validation, error recovery and save behavior.
3. Anchor an inspected bean at the top of the content area, scroll only its
   history, and support closing from the heading/history or Escape.
4. Preserve swipe/actions/delete controls and restore the collection scroll
   position when inspection closes; keep all existing records and formats intact.
5. Run build, Safari interaction/phone geometry checks, existing save/reload and
   backup regressions, isolation headers and production repository-subpath checks.

### Acceptance Criteria (Stage 21 Gate)

- The bean form is initially hidden. Its button accurately announces expansion,
  closing preserves unsaved fields, and the no-beans prompt opens/focuses it.
- At 393×852, including simulated 59px top/34px bottom safe areas, the expanded
  toggle, every input, optional photo preview and Add Bean button fit above tabs
  without scrolling or horizontal overflow. Inputs retain 16px text/44px height.
- Opening a bean pins its heading at the content top. Long histories scroll in
  both directions without moving that heading or hiding the final session.
- Tapping the heading, session content, photo or blank history space collapses
  inspection and restores the previous collection position. Escape works;
  action buttons, swipes and text selection retain their intended behavior.
- Build and Safari checks pass. Storage identities, schema, record semantics,
  backup formats, dependencies, startup and service workers remain unchanged.
- Physical iOS and any unverified upgrade/deployment paths are recorded.

### Verification — 2026-10-27

- `uv run npm run build` passed using the existing project-local environment.
  `git diff --check` passed; no dependency or toolchain changes were needed.
- Desktop Safari 27.2/macOS development and production suites passed. Production
  ran at `http://127.0.0.1:4173/CoffeeOS/` with `TEST_PRODUCTION=1`, including
  startup/navigation, no-beans form opening/focus, bean/session saves, reloads,
  chart/editor behavior and CSV/Parquet backup import/export regressions.
- Exact-size Safari frame checks passed at 320×568, 375×667, 393×759, 393×852
  and 430×932 without horizontal overflow. At both 393px sizes, the Add a bean
  toggle, complete form, 72px photo preview, removal/status and submit controls
  fit above navigation, with and without simulated 59px top/34px bottom safe
  areas. Inputs retain 16px text and at least 44px height; submit remains 44px.
- Long-history frame checks passed at 320, 375, 393 and 430px with simulated
  safe areas: the heading stays pinned at the content top, scrolling reaches
  the last session above navigation and returns to the start, without horizontal
  overflow. Safari's native details content wrapper needed `::details-content`
  to participate in the flex layout; the corrected scrolling behavior passed.
- Interactive Safari checks passed draft-preserving form toggles, independent
  history scrolling, heading/session/photo/blank-history taps to collapse,
  Escape/focus return, action buttons that leave inspection open, and restoration
  of the collection's previous scroll position. Existing swipe/delete regressions
  passed in the upgrade suite. Native touch selection/scroll gestures on a
  physical device remain unverified.
- `uv run npm run test:upgrade` passed in Safari with the IndexedDB backend.
  Populated revision `2ccf66cbf840e9455d54f8b31d57b4df944e3bf6` was replaced
  by the candidate at the same profile/origin and `/CoffeeOS/` path. Exact IDs,
  relationships, dates/nulls, comments and numeric precision survived reload;
  historical CSV/Parquet backups imported, and injected startup/restore/migration
  failures preserved the original records without showing an empty collection.
  Photo save/reset, photo backup round trips, session editing/deletion, bean
  swipe/delete, rollback/retry and reload regressions also passed.
- Dev and preview returned COOP `same-origin` and COEP `require-corp`; compiled
  JS/CSS assets returned HTTP 200 beneath `/CoffeeOS/assets/`.
- No persistence/startup code, storage identifiers, schema, record semantics,
  backup formats, dependencies, service workers, deployment origin or hosting
  changed. OPFS previous-build upgrade checks were not rerun; no new OPFS
  upgrade-path verification is claimed.
- Physical iPhone/iPad touch, software keyboard, browser chrome, enlarged text,
  Home Screen safe areas/storage lifecycle, older Safari versions and deployed
  host behavior remain unverified. Desktop Safari frame checks do not replace
  physical-device testing.

---

## Stage 22: Portable Single-File CoffeeOS Backups

- [x] **Status:** Implemented; desktop Safari/Firefox and populated upgrade checks passed; physical iOS pending; signed-zero runtime boundary documented

### Goal

Replace the normal CSV/Parquet and one-file/two-file choices with one portable
`.coffeeos` backup containing a manifest and two independent Parquet tables.
Make saving and importing a collection straightforward while preserving exact
records, interoperability with standard tools, and access to historical backups.

### Tasks

1. **Freeze and document the version 1 archive contract.**
   - Add `docs/backup-format.md` as the normative specification, with a small
     generated example archive and instructions for reading it outside CoffeeOS.
   - Use an ordinary, unencrypted ZIP archive with exactly these root entries:

     ```text
     CoffeeOS-2026-10-27T143000Z.coffeeos
     ├── manifest.json
     ├── beans.parquet
     └── brew_sessions.parquet
     ```

   - Use UTF-8 JSON for the manifest and standard Parquet for both tables. Keep
     photos in the existing `beans.photo_jpeg` column for this version; do not
     introduce a separate assets directory or join beans onto every session.
   - Export ZIP entries using STORE to avoid recompressing already compressed
     Parquet. Accept STORE and DEFLATE on import so standard ZIP tools can repack
     a valid archive. Select and pin a small browser-compatible ZIP dependency
     after checking its installed API, license, archive limits and Safari support.
   - Use `.coffeeos` as the user-facing extension and `application/zip` for the
     download MIME type. Do not invent a registered media type. Identify imports
     by ZIP contents and manifest as well as filename; tolerate empty/generic
     MIME types from iOS Files. A standard `.zip` copy with the same valid
     contents should also import.
   - Include empty tables with their full schemas. A backup with zero beans and
     zero sessions is valid and must not be interpreted as damaged storage.

2. **Define a self-describing, versioned manifest.**
   - Require the following fields; document their types and validation rules:

     | Field | Contract |
     | --- | --- |
     | `format` | Exact string `coffeeos-backup`. |
     | `format_version` | Integer `1`; versions the archive/manifest contract. |
     | `data_schema_version` | Integer `1`; versions the logical backup schema described below, independently of the internal database schema. |
     | `backup_id` | UUID identifying this exported snapshot; not a record or database identity. |
     | `exported_at` | UTC ISO 8601 timestamp for the export, with a `Z` suffix. |
     | `producer` | Object with `name: "CoffeeOS"` and informational `version`; never a storage identifier or compatibility gate. |
     | `tables` | Exactly two descriptors, one named `beans` and one named `brew_sessions`. |
   - Each table descriptor must contain `name`, its exact root `path`,
     `row_count`, `byte_length`, and `sha256`. Counts and lengths must be
     nonnegative safe integers. SHA-256 is 64 lowercase hexadecimal characters,
     calculated over the complete uncompressed Parquet entry bytes.
   - Include `primary_key: ["id"]` in both descriptors, and a foreign-key
     descriptor for `brew_sessions.bean_id` referencing `beans.id`. Validate
     these against the known schema; never execute identifiers or SQL supplied
     by an archive.
   - Include ordered column descriptors with `name`, documented `logical_type`,
     `nullable`, and `unit` where applicable. Validate the descriptors against
     the versioned contract and actual Parquet schema; the manifest must not
     redefine field meanings or authorize arbitrary columns/types.
   - Document exact required metadata, optional informational fields and
     compatibility rules. Ignore unknown informational manifest properties;
     reject unsupported format/data-schema versions before touching live data.
     Future schema changes require an explicit reader/migration and fixtures.
   - Explain that checksums detect corruption and mismatched entries, not
     authenticity or encryption. The archive contains readable personal data
     and photos; no account, password or network service is required to open it.

3. **Specify the logical table schema and fidelity requirements.**
   - `beans`: `id` and `name` are required strings; `roast_date` and
     `freeze_date` are nullable dates; `created_at` is a required timestamp;
     `photo_jpeg` is a nullable JPEG data-URL string.
   - `brew_sessions`: `id` and `bean_id` are required strings; `brewed_at` is a
     required timestamp; `time_str` and `comment` are nullable strings.
     `dose_g`, `water_g`, `temp_c`, `grind_um`, `yield_g`, `tds_pct` and
     `extraction_pct` are nullable binary64 numbers.
   - Record units explicitly: grams for dose/water/yield, degrees Celsius for
     temperature, micrometres for grind, and percentage points for TDS and
     extraction. Preserve `time_str` exactly, including its existing duration
     notation, rather than converting or assigning a new numeric unit.
   - Preserve IDs, relationships, dates, timestamp precision and interpretation,
     nulls, empty strings, multiline/Unicode comments, zeroes, photos and numeric
     precision. Export stored values, not formatted UI values or recomputed EY.
   - Document the actual Parquet physical/logical type annotations emitted by
     the pinned DuckDB build, including timestamp precision and UTC convention.
     Verify them with an independent Parquet reader before freezing the spec.
     Do not route table records through JavaScript Date or JSON conversions.
   - Exclude derived `bean_name` session display values and all device-specific
     database paths, backend metadata, locks, credentials and browser settings.
   - Every session in a new-format backup must reference a bean in that same
     archive. Validate this independently of the destination collection so each
     backup remains self-contained.

4. **Implement consistent archive export.**
   - Add an archive module such as `src/backups.ts` for manifest validation,
     hashing and ZIP packaging. Keep database operations in `src/db.ts`.
   - Reuse the existing two-table Parquet export and its serialized database
     access. Capture both tables and their counts from the same consistent
     snapshot; no application write may interleave between them. Release the
     database operation before doing CPU-intensive ZIP/hash work when safe.
   - Build the manifest from the exported bytes and verified snapshot metadata.
     Do not count the live tables in a separate operation after export.
   - Produce one dated file. Keep only necessary buffers, release temporary
     DuckDB files and replaced object URLs, and guard against duplicate clicks.
     A preparation failure leaves the live collection and any earlier prepared
     download intact and available for retry.
   - Make export and import resource limits consistent: never produce a backup
     that this version's importer would refuse solely because of its size.

5. **Implement validation, preview and atomic merge import.**
   - Split import into preparation/validation and explicit confirmation. File
     selection alone must not mutate the collection.
   - Inspect the ZIP directory before extracting. Reject missing, duplicate or
     unexpected entries, directories, encrypted entries, unsupported compression,
     absolute/parent-traversal paths and conflicting entry metadata. Use only
     the three fixed in-memory entry names; never extract to user storage.
   - Enforce bounded manifest size, archive size and actual decompressed bytes,
     including limits during decompression rather than trusting declared sizes.
     Establish and document practical limits from Safari memory measurements
     with photo-heavy fixtures; report oversize files before any live mutation.
   - Validate UTF-8/JSON, manifest versions and structure, entry lengths and
     hashes, actual Parquet schemas, row counts, unique/nonblank IDs, required
     values, dates, finite numbers, photo encoding and internal relationships.
     Do not use untrusted row counts as allocation sizes.
   - Validate in temporary/staging tables and show the backup date, producer,
     bean/session counts, and expected new/updated/unchanged record counts.
     Retain the original uploaded bytes for retry; release replaced staging data.
   - For this stage, support **merge only**: add new IDs, update differing
     matching IDs, and retain records absent from the backup. Clearly explain
     that matching records can be overwritten even by an older backup; do not
     label this operation an exact restore or infer that imported values are newer.
   - If the local collection changes between preview and confirmation,
     recompute the comparison and require confirmation of the refreshed preview.
     Never apply a stale overwrite summary silently.
   - Before applying a merge that changes existing records, persist a recoverable
     pre-import snapshot without replacing an earlier recovery copy. Define an
     additive, versioned recovery entry in the existing snapshot store, with
     a documented way to download it as a `.coffeeos` file. If creating that
     recovery copy fails, abort before changing live records. Do not rotate or
     silently discard recovery copies in this stage; storage-full is recoverable.
   - Apply both tables together through the existing transaction and durable
     snapshot path. Pre-commit errors roll back both tables; retain the upload
     for retry. Post-commit durability errors must retain the existing committed
     write warning behavior, refresh displayed data, and discourage duplicate
     retries rather than falsely claiming that nothing was imported.
   - Refresh bean histories and brew lists only after an applied import, keep
     save/error statuses accessible, and make repeated import idempotent by ID.

6. **Replace the normal IO flow with one-file controls.**
   - Present **Save backup** and **Import backup** as the primary actions. Remove
     the format/layout selector and CSV/Parquet export buttons from normal UI.
   - Save prepares one archive, then exposes one download and, where supported,
     one Share action. Keep a separate user click for the iOS share sheet.
     Report “Backup ready” rather than claiming the user saved a prepared file.
   - Import uses one picker accepting `.coffeeos` and `.zip`, a concise preview,
     an **Import into collection** confirmation, and Cancel. Do not expose
     manifest/schema/checksum details unless they explain an actionable failure.
   - Show empty, preparing, validating, ready, importing, success and recoverable
     failure states. Keep controls reachable above navigation at 393×852, with
     16px input fonts, 44px touch targets and accessible status announcements.
   - Provide a clearly labelled recovery-backup download when a pre-import copy
     exists. Preserve retryable selections and avoid duplicate-submit races.

7. **Retain historical backup compatibility without adding CSV export.**
   - Do not include any CSV file inside `.coffeeos`, and do not implement an
     optional spreadsheet/CSV export feature in this stage.
   - Keep existing combined and separate CSV/Parquet backups readable through a
     collapsed **Import an older backup** path. This is backward compatibility,
     not a second normal backup format. Preserve mixed legacy table imports,
     optional historical photo columns and the established missing-value rules.
   - Keep the existing data-layer readers and their fidelity tests. Reuse the
     shared validation/merge logic where possible without changing legacy
     partial-import semantics or interpreting absent photo fields as deletion.
   - Preserve current OPFS/IndexedDB storage identity, selected backend, database
     ownership lock, WAL/database filenames and existing snapshot keys. Any new
     recovery metadata is additive; no live storage is recreated or switched.

8. **Verify interoperability, failure safety and real upgrades.**
   - Add focused archive tests for empty and populated collections, multiple
     sessions per bean, beans without sessions, photos, null/empty distinctions,
     Unicode/multiline text, exact timestamps and binary64 precision.
   - Cover malformed manifests, unsupported versions, corrupt/truncated ZIP or
     Parquet, duplicate/path-conflicting entries, size-limit violations, checksum
     or count mismatches, schema mismatches and orphan sessions. All must fail
     before live data changes and leave the original file available for retry.
   - Verify preview cancellation, refreshed conflict previews, duplicate-submit
     prevention, unchanged/repeated imports, atomic rollback, failed recovery
     snapshot creation, post-commit warnings, recovery download and reload.
   - Independently unzip a generated `.coffeeos` file and read both tables with
     a standard Parquet tool outside DuckDB-Wasm. Check manifest counts/hashes
     and representative exact values. Repack the same entries with a standard
     ZIP tool using DEFLATE and verify CoffeeOS accepts the result.
   - Run previous-build-to-candidate upgrades with populated OPFS and IndexedDB
     fixtures in the same isolated browser profile and origin. Check exact
     records after replacement/startup/reload, import old backups, and inject
     failed upgrades to prove the original collection stays recoverable.
   - If a ZIP dependency changes the lockfile, install old and candidate fixture
     dependencies separately; do not bypass the upgrade harness's dependency
     equality guard or run the previous build against an unverified new lockfile.
   - Use installed Safari first for startup, navigation, export/import and
     persistence; use isolated Firefox for OPFS coverage where Safari selects
     IndexedDB. Verify production `/CoffeeOS/` assets and isolation headers.
   - Run `uv run npm run build` and `git diff --check`. Record physical iPhone
     Files recognition, save/share/picker flow, large-photo memory behavior,
     Home Screen imports and any unverified cases explicitly.

### Acceptance Criteria (Stage 22 Gate)

- Normal export produces exactly one `.coffeeos` file, containing only the
  specified UTF-8 manifest and two standard, independently readable Parquet
  tables. No CSV file, joined table, login or remote service is required.
- The manifest identifies the format/schema versions, snapshot, producer,
  table paths/counts/lengths/checksums, columns, units, keys and relationship.
  The published contract and generated fixture match the implementation.
- One normal import picker previews a valid archive and requires an explicit
  merge confirmation. Cancellation and all validation failures leave the
  collection unchanged. Existing-record overwrites have a recoverable snapshot.
- New-format archives are self-contained, including photos and beans with no
  sessions. Empty archives round-trip. Exact records survive export/import and
  reload without changes to IDs, relationships, values, units or precision.
- Missing records in an imported snapshot do not delete local records; repeated
  imports do not duplicate records. Stale previews cannot silently overwrite
  intervening local changes. Both tables succeed together or roll back together.
- Independent ZIP/Parquet tools read generated files, and supported standard
  repacking remains importable. Corrupt, oversized and unsupported files fail
  safely with an actionable error and no silent fallback to an empty collection.
- Historical combined/separate CSV and Parquet backups remain readable through
  legacy import. The ordinary screen has no format/layout choices or CSV export.
- Build, Safari workflows, production-subpath checks, and populated previous-build
  OPFS/IndexedDB upgrade/recovery checks pass; remaining platform gaps are stated.
- Existing storage identity and deployment origin remain stable. The only new
  persistence metadata is the explicitly documented additive import-recovery
  storage; its failure cannot overwrite live data or previous recovery copies.
- Cloud storage, authentication, automatic synchronization, exact replacement
  restore, encryption and optional CSV export are outside this stage.

### Verification — 2026-10-27 (planning record)

- Planning only: reviewed the current `src/views/ioView.ts` controls and
  `src/db.ts` two-table/combined export, schema and transactional merge paths.
- No application, dependency, storage or backup-format changes have been made
  for this stage. All implementation acceptance criteria and browser, archive,
  interoperability and previous-build upgrade checks remain pending.
- The plan retains historical CSV import solely to meet the mandatory existing
  backup compatibility requirement; new backup creation is `.coffeeos` only.
- Documentation checks: confirmed Stage 22 follows Stage 21 at the end of this
  file; `git diff --check` and `uv run npm run build` passed. This checks the
  existing application only and does not verify the proposed backup feature.


### Verification — 2026-10-27 (implementation)

- Implemented the normative v1 contract in `docs/backup-format.md`, generated
  `docs/fixtures/example-v1.coffeeos`, and pinned MIT-licensed `fflate` 0.8.3
  with its lockfile and distributed license. Normal export is one STORE ZIP
  archive (`application/zip`); normal imports accept content-identified archives,
  including `.zip` and empty/generic MIME types. Both full-schema empty tables
  are included. Manifest/schema versions, ordered columns, units, keys, internal
  relationships, table counts, lengths, SHA-256 and ZIP CRC32 are checked.
- Export captures both COPY outputs, counts and capture time within the existing
  database queue, then releases it before hashes/packaging. Import staging and
  comparison use fixed SQL identifiers and original Parquet values. Confirmation
  rechecks the collection revision and exact field comparisons; stale previews
  refresh and require another click. Matching IDs merge, absent records stay,
  and repeated unchanged imports produce no duplicate records or recovery copies.
- Overwrites atomically add immutable `import-recovery-v1:<UUID>` records in the
  existing snapshot store. They never replace `tables-v1`, backend metadata or
  earlier recovery copies. IO lists them after reload and prepares downloadable
  `.coffeeos` recovery archives. Recovery-write failures abort before live DML.
  For archive imports on IndexedDB, the snapshot transaction remains open until
  SQL COMMIT resolves: failed SQL commit aborts the candidate snapshot; an IDB
  abort after SQL commit retains the prior durable snapshot and raises the
  committed-write warning. Existing OPFS/IndexedDB identities, database/WAL
  filenames, lock, deployment origin, service worker and startup behavior are
  unchanged. No migration or storage reset is introduced.
- Replaced ordinary format/layout controls with Save backup, one download and
  separate Share, plus one picker, preview, Import into collection and Cancel.
  Retryable files and earlier prepared downloads survive failures. Status/error
  announcements are accessible; only applied imports refresh histories/lists.
  The collapsed legacy path retains combined/separate/mixed CSV and Parquet,
  optional historical photos, partial import behavior, and quoted/null semantics.
- `uv run npm run build`, `uv run npm run typecheck`, and `git diff --check`
  passed. Node resolves inside the project's `.venv`; no global installation or
  application framework was introduced. Local dev and production-preview
  responses have COOP `same-origin` and COEP `require-corp`. Generated asset
  URLs remain relative, and production candidate fixtures loaded at `/CoffeeOS/`.
- Installed desktop Safari 27.2 on macOS: `uv run npm run test:safari` passed
  startup/navigation, bean/session writes, narrow layouts with 16px inputs and
  44px controls, legacy IO fidelity/error/retry tests, persistence, ownership,
  and committed-warning regressions. Isolated `uv run npm run test:backups`
  passed empty/populated/photo archives, beans without sessions, multiple
  sessions, full precision values, Unicode/multiline text, null/empty distinctions,
  STORE/DEFLATE, unchanged imports, and restoration into a genuinely empty test
  database while preserving the original test collection.
- Focused archive tests rejected 27 malformed/archive/Parquet cases before live
  mutation, plus ten independently generated PyArrow fixtures covering invalid
  IDs/names, duplicates, required timestamps, NaN/infinity, photos, a wrong
  actual column type and year 10000. Other checks covered lying DEFLATE output
  sizes, orphan sessions despite locally present beans, stale previews, failed
  recovery creation, second-table rollback, failed SQL COMMIT with reopen,
  post-commit IDB abort, retained prior snapshots, recovery download and reload.
  UI checks covered cancellation, duplicate submits, refreshed confirmations,
  retained invalid selections/earlier downloads, mocked Share availability,
  cancellation/failure, and post-commit warnings with refreshed data and reload.
- Isolated Firefox: `TEST_FIREFOX=1 uv run npm run test:backups` passed the same
  archive and normal UI workflows using OPFS. This does not count as Safari
  coverage. No Chrome or normal browsing profile was used.
- `uv run python tests/backup-interoperability.py` with independent PyArrow 21.0.0
  and Python `zipfile` passed ZIP entry/count/hash checks, physical/logical Parquet
  annotations, all restored field values, microsecond timestamps and binary64
  bit patterns in the generated representative fixture. This confirms optional
  Parquet fields, UTF8 strings, DATE/INT32, DOUBLE, and TIMESTAMP/INT64 microseconds
  with `isAdjustedToUTC=false` and CoffeeOS's documented UTC interpretation.
  Python's DEFLATE repack imported successfully in both browsers. Different
  physical Parquet byte layouts after import are permitted; exact logical values
  were checked independently rather than requiring byte-identical encodings.
- Populated previous-build upgrades passed `uv run npm run test:upgrade` in
  Safari/IndexedDB and `uv run npm run test:upgrade:firefox` in Firefox/OPFS,
  from immutable `2ccf66cbf840e9455d54f8b31d57b4df944e3bf6` at the same isolated
  origin and `/CoffeeOS/` path. Old dependencies were installed from their own
  lockfile with `npm ci` and built separately from candidate dependencies; the
  equality guard was not bypassed. Checks included exact records after build
  replacement/startup/reload, old CSV/Parquet imports, failed migrations/startup,
  durable-byte preservation/recovery, ownership, photos and bean/session
  regressions. Production archive controls additionally passed preview-only
  selection, explicit overwrite merge, recovery packaging and reload. The harness
  now acquires its server port before rebuilding fixtures, preventing overlapping
  runs from replacing another run's source files.
- Resource measurements: a 30-distinct-photo Safari fixture produced a
  30,821,909-byte archive and completed, but coarse peak RSS across newly started
  Safari/WebKit processes was 2,197,168 KiB. The application therefore uses a
  conservative **8 MiB** archive/expanded-data cap and **64 KiB** manifest cap;
  exporter overhead reservation ensures it cannot produce an archive rejected
  solely for size. A six-distinct-photo 6,169,395-byte STORE archive (4,732,905-byte
  DEFLATE repack) exported in about 30 ms and validated in 125 ms; a ten-photo
  oversize export failed without changing records. Coarse peak process RSS was
  1,391,520 KiB, including shared/native runtime memory and fixture generation,
  not just JS heap or archive buffers. The reproducible measurement command is
  `uv run node tests/measure-backup-memory.mjs`. These desktop results do not
  establish physical iPhone memory safety; Parquet decoding has working memory
  beyond the ZIP byte limits.
- Additional precision boundary: an independent Parquet probe found the pinned
  DuckDB runtime can normalize IEEE negative zero to positive zero while
  materializing tables through the existing import path. Disabling statistics
  propagation/forcing uncompressed storage did not correct it in isolated
  experiments; no such settings or runtime changes ship. Numerical zero and the
  representative finite binary64 values round-trip, but zero sign-bit fidelity
  is not claimed. This existing runtime boundary is documented in the format
  specification; exact preservation of negative-zero sign remains unresolved.
- Physical iPhone/iPad Files recognition, native download/share/picker behavior,
  touch/keyboard/safe-area behavior, large-photo memory/storage lifecycle and Home
  Screen imports remain unverified. Older Safari versions and deployed host
  response headers/storage access remain unverified. No deployment was performed.


---

## Stage 23: Raise Portable Backup Size Limit to 1 GB

- [x] **Status:** Implemented; build and configuration checks passed

### Goal

Allow photo-heavy collections to exceed the original 8 MiB backup limit.

### Tasks

1. Raise the shared archive and expanded-data limits to 1,000,000,000 bytes.
2. Update size-limit messages, the format specification and the photo fixture's
   former 8 MiB rejection expectation.
3. Build and check the diff without changing storage identity or backup schemas.

### Acceptance Criteria (Stage 23 Gate)

- Export, import and recovery packaging share the 1 GB limit; the 64 KiB manifest
  limit and export overhead reservation remain in place.
- Current error messages and documentation describe the new limit, and the
  ten-photo fixture no longer expects rejection at 8 MiB.
- Build and diff checks pass; existing storage and backup formats are unchanged.

### Verification — 2026-10-27

- Confirmed both configured byte limits are 1,000,000,000, with all export/import
  and recovery size checks still referencing the shared configuration.
- Updated messages/specification and the existing photo fixture expectation.
- `uv run npm run build` and `git diff --check` passed.
- No storage, schema, startup, dependency or deployment changes. No populated
  upgrade rerun or 1 GB browser/memory test was performed for this limit-only
  update; physical iOS capacity remains unverified.

---

## Stage 24: Google Drive Login and Basic Snapshot Sync MVP

- [x] **Status:** Complete; accepted by the user after private testing on 2026-10-27

### Goal

Prove that a user can connect Google Drive, upload a real `.coffeeos` backup,
and recover it into an empty collection on another isolated browser profile.
Keep the first delivery small enough to test the actual login/API integration
before adding restore options, large transfers and the finished workflow.

### Tasks

1. **Establish the minimum working authorization flow.**
   - Configure a Google test project, enabled Drive API, web OAuth client,
     authorized origins, consent branding and test users. Document the required
     configuration in `docs/google-drive-backups.md`. Ship only the public client
     ID; no client secret, service-account key or refresh token.
   - Use Google Identity Services' browser token model and direct Drive REST
     calls. Request `drive.file`, plus `openid` and `email` to identify/display
     the selected account. Verify granted scopes and the authenticated identity.
   - Connect from a user gesture, keep access tokens/expiry in memory, and load
     Google's client only for this optional flow. Do not store tokens in URLs,
     logs, archives or persistent browser storage.
   - Prove Safari login callbacks and API calls with the existing COOP/COEP
     settings before building more UI. Preserve isolation on the database page.
     If needed, implement only the minimum same-origin authorization helper:
     narrowly exclude that document from isolation rewriting and return results
     over an ephemeral channel tied to a one-time request with a bounded lifetime.
     Never weaken the main page's headers or switch its storage backend.
   - Handle denied/closed/blocked authorization and expired tokens with a clear
     retry/reconnect state. Use one active account per connection; disconnect
     clears tokens, pending callbacks and account-specific folder/file state.
     No remembered-login or automatic session-resume feature is required.

2. **Implement one small, end-to-end Drive transfer path.**
   - Create/find a visible **CoffeeOS Backups** folder using app-owned metadata,
     not its name alone. Discover it through the authorized account on each new
     connection so recovery works without a cached folder ID. If multiple marked
     folders are found, report the ambiguity without writing; reconciliation is
     deferred to Stage 25.
   - Reuse the current snapshot/packaging APIs and exact `.coffeeos` format.
     Upload a dated file containing the manifest backup ID; add app metadata
     identifying its kind, backup ID and whole-archive hash. Retain old files.
   - For this MVP, allow Drive transfers up to **4 MiB per archive** using a
     single multipart upload with metadata. Enforce this clearly labelled MVP
     limit on upload and download; keep the existing 1 GB local-file limit
     unchanged. Larger/resumable Drive transfers belong to Stage 25.
   - List app-marked, completed, non-trashed snapshots in the identified folder.
     Select the most recently uploaded by Drive `createdTime`, with deterministic
     tie handling; do not use filename or client timestamp as the ordering key.
     Do not mistake a failed/incomplete listing for an empty history.
   - Verify upload completion and remote size/checksum before reporting success.
     Keep the same bytes/backup ID through an uncertain result. A lost response
     must not trigger a blind second upload: reconcile by backup ID, or report
     an unconfirmed result and stop. General retry/backoff is deferred.
   - Bound downloads by the MVP limit before and during reading, then reuse
     `prepareBackup` for all archive/schema/hash/relationship checks. Stop with
     an actionable error if the latest snapshot is invalid or unsupported;
     automatic fallback to older snapshots is not part of the MVP.

3. **Implement exactly one sync operation on connect or explicit Sync now.**
   - Explain beside Connect that it will save local data or recover an empty
     collection. After successful authorization, apply this behavior once:

     | Local collection opened successfully | Cloud state | MVP action |
     | --- | --- | --- |
     | Contains records | Empty or populated | Upload one new snapshot; preserve all previous snapshots. |
     | Both tables empty | Latest completed snapshot exists | Download, validate and import into the still-empty collection. |
     | Both tables empty | No snapshots | Show “No Drive backup yet”; create no empty upload. |
     | Local storage cannot be opened/read | Any | Preserve the existing recoverable error; no transfer. |
     | Any | Cloud lookup/authentication/network fails | Show failure; do not interpret it as empty history. |

   - Sync now repeats the same behavior. Navigation, renders, saves and a completed
     download/import must not automatically launch another operation.
   - Determine emptiness from successful reads of both tables on the selected
     backend. Missing storage, held locks, denied access and failed restores
     never establish an empty collection.
   - Recheck emptiness and collection revision inside serialized database access
     immediately before applying a downloaded snapshot. If local data changed
     during download, stop without modifying it. Do not automatically merge or
     replace a now-populated collection; those choices arrive in Stage 25.
   - Reuse the existing transactional import and coordinated persistence path.
     Preserve rollback and committed-durability warning semantics. Refresh both
     app views after a successful import and verify reload persistence.
   - Capture the export snapshot before network transfer and release database
     access while uploading. Report the captured date/counts; later local edits
     wait for the next explicit Sync now.

4. **Add only the controls needed to exercise the integration.**
   - Add a small optional Drive section with Connect/Reconnect, selected account,
     Sync now, Disconnect, busy state and last operation result.
   - Serialize operations, disable repeated submissions and ignore late callbacks
     from disconnected/cancelled connections. An expired-token reconnect must
     resolve the pending operation before starting any new connection-time sync.
   - Disconnect preserves both local records and Drive files. Keep file backups
     and offline brewing available when Google resources or authorization fail.
   - Provide readable errors and normal 16px inputs/44px touch targets. Do not
     add history browsing, cloud merge/replace, persistent account preferences,
     background sync or elaborate progress/transfer management in this stage.

5. **Verify the actual MVP, including its essential safety boundaries.**
   - With a dedicated Google test account, connect from installed Safari, upload
     a small populated fixture containing a photo and linked sessions, inspect
     the resulting Drive file, then recover it on a fresh isolated browser
     profile. Compare exact records and verify them after reload.
   - Verify a second sync creates a separate snapshot; existing backups survive;
     an empty cloud history creates no upload; and offline/local file workflows
     remain available after disconnect or denied authorization.
   - Add targeted checks for double-clicks, expired/denied authorization, uncertain
     upload completion, corrupt/oversize downloads, failed database access and a
     local write racing empty recovery. None may discard existing records.
   - Test database write/commit failure during empty recovery using existing
     rollback/durability coverage. Keep all baseline archive validation enabled;
     “MVP” must not bypass the existing data-safety rules.
   - Run the mandatory populated previous-build OPFS/IndexedDB upgrade checks
     for import/startup/service-worker/dependency changes, including old backup
     imports and failed-upgrade preservation. Use isolated Safari first, with
     Firefox for OPFS coverage where needed; no user browsing profile resets.
   - Run `uv run npm run build`, `git diff --check`, relevant existing backup
     regressions, isolation checks and production repository-subpath checks.
     Record actual tested sizes and physical iPhone/Home Screen gaps. Mocked
     OAuth tests alone cannot establish that the MVP works with Google.

### Acceptance Criteria (Stage 24 Gate)

- A real Google test account can authorize in installed Safari with the database
  page still isolated; a real `.coffeeos` file uploads and is discoverable from
  a second isolated profile without cached cloud identifiers.
- Connect and Sync now each perform one operation according to the behavior
  table. A nonempty collection uploads a new file; a confirmed-empty collection
  recovers the latest file and retains exact records after reload.
- Drive transfers within the documented 4 MiB MVP limit succeed; larger files
  fail clearly without changing local data or existing Drive snapshots. The
  local file-backup format and 1 GB limit are unchanged.
- Storage/network/authentication failures never masquerade as empty data;
  archive validation, guarded empty import, rollback and operation serialization
  remain effective. No merge, replacement, storage reset or cloud deletion occurs.
- Tokens stay ephemeral and account state is cleared on disconnect. Routine
  offline usage and historical file imports remain functional.
- Build, targeted safety tests, applicable populated upgrades and a real-service
  round trip pass. Device/authentication gaps are explicit; do not mark the MVP
  complete on mocked service results alone.
- Stop after this MVP gate. Stage 25 supplies the remaining workflow and
  reliability features; they are not prerequisites for proving this small path.

### Verification — 2026-10-27

- Planning only: split the previously proposed full integration into this MVP
  and Stage 25 at the user's request. No Google or application implementation
  changes were made, and all MVP runtime/service checks remain pending.
- Retained the existing browser authorization, limited Drive permissions,
  portable archive and data-preservation design. The temporary Drive-only
  transfer cap keeps the initial proof small without reducing local backups.
- Planning checks: stage structure and scope reviewed; `git diff --check` and
  `uv run npm run build` passed for the existing application. No MVP integration
  pass is claimed by this documentation-only verification.


### Implementation and Verification — 2026-10-27

- Implemented optional Connect/Reconnect, selected account, Sync now, Disconnect,
  serialization, errors/results and the 4 MiB cap. Public client ID entry is in
  IO, with optional `VITE_GOOGLE_CLIENT_ID` build/Pages configuration. Setup and
  personal-device acceptance steps are in `docs/google-drive-backups.md`.
- GIS runs only in `drive-auth.html`, with a random one-time BroadcastChannel,
  three-minute expiry, cancellation/late-callback suppression, granted-scope
  checks and Google userinfo identity verification. Only the helper receives
  popup-compatible headers. Main-page isolation and storage identity are intact;
  no tokens, secrets or remembered account state are persisted. The helper can
  update an older isolation worker before authorization without opening a DB.
- Versioned app markers identify folders/snapshots. Discovery rejects ambiguous
  folders and incomplete/paginated listings. Latest ordering uses server
  `createdTime`, including sub-millisecond precision, with deterministic ID ties.
  Single multipart uploads verify remote size/SHA-256 and reconcile uncertain
  completion with the same backup ID without a second POST. Downloads are
  bounded before/during reading and retain all existing archive validation.
- Connect/Sync implement the behavior table. Capture includes both tables and
  revision before networking; empty recovery rechecks revision and both counts
  under serialized DB access, including add/delete races back to empty. The
  existing transaction, coordinated IndexedDB/SQL commit, rollback and committed
  warning paths are reused. Schema, storage identifiers, local 1 GB cap, archive
  format and origin are unchanged. No cloud deletion, merge or replacement.
- Installed **Safari 27.2/macOS (IndexedDB)** and isolated **Firefox (OPFS)**
  passed `test:drive` with `TEST_BASE_URL=http://127.0.0.1:5174/` and
  `TEST_FIREFOX=1` for Firefox. Checks covered 16 simulated adapter tests,
  populated upload, photo/linked-session/precision/null/comment round trip,
  empty recovery/reload, failed reads before transfer, populated/stale/add-delete
  guards, a write during download, insert/commit failure rollback and Safari
  snapshot failure rollback. UI duplicate Connect/Sync, navigation, denial,
  sanitized reports and 393px layout passed. Mock archive sizes were **8,357
  bytes on Safari** and **8,262 bytes on Firefox**; no real Google size claim.
- Existing `test:backups` passed on both backends, including old CSV/Parquet,
  Python DEFLATE, 10 malformed PyArrow fixtures, 27 invalid archives, recovery,
  atomic rollback, failed commit/post-commit IDB abort, Share/cancel and reload.
  Photo fixtures measured **1,035,650 bytes (Safari)** and **617,358 bytes
  (Firefox)**. Generated example files were restored to their prior version.
- Populated upgrades from previous build
  `abcddcde6206eefc9b9d28656cb234eac9bf4b00` passed with
  `TEST_PREVIOUS_REF=abcddcd uv run npm run test:upgrade` (Safari IndexedDB) and
  `TEST_PREVIOUS_REF=abcddcd uv run npm run test:upgrade:firefox` (Firefox OPFS).
  The same isolated profile/origin at `/CoffeeOS/` retained exact photo-bearing
  beans and linked sessions after replacement/startup/reload, read old backups,
  and preserved records across failed schema/metadata/permission/restore opens.
  Editing/deletion and archive merge/recovery regressions also passed.
- The first recent-build upgrade attempt exposed a legacy-only migration
  assumption in the harness. Migration failure injection now applies only to
  fixtures that need it, and recent fixtures retain existing photos. A subsequent
  transient startup failure did not recur on passing runs; fixture-only startup
  error capture was added. Dependencies remain unchanged.
- `uv run node tests/drive-auth-helper.mjs` passed simulated GIS success, denial,
  blocked popup, cancellation, late callback and timeout checks. Installed Safari
  passed `tests/drive-isolation.mjs`: production `/CoffeeOS/` assets on a static
  host without native isolation headers, previous-worker update, one-time channel
  across isolated windows, helper-only header exception, and no Google/DB load
  in the helper. Production preview main/helper COOP/COEP headers also passed.
- Build and diff checks passed. **Live Google OAuth/CORS, real upload/recovery
  across profiles, actual deployed-host behavior and physical iPhone/iPad/Home
  Screen checks remain unverified.** The user will supply personal-account/device
  results using Stage 26 diagnostics. Stage 24 stays unchecked until the real
  service gate passes; Stage 25 has not started.
- Final verification: `TEST_BASE_URL=http://127.0.0.1:5174/ uv run npm run
  test:safari` passed the full installed Safari app suite, including startup,
  navigation, bean/brew writes and reload, input/layout checks, lock exclusion,
  failed writes, committed warnings and historical backup round trips. Final
  `test:drive` runs on Safari/IndexedDB and Firefox/OPFS passed the added explicit
  unchanged-revision/recovery assertions. Final build and diff checks passed.

### Registered Client Integration — 2026-10-27

- The user supplied the Google web OAuth client registered for
  `https://krischris.github.io` and requested the normal integration instead of
  the temporary setup/test UI. Stage 28 configures that public ID, removes manual
  client-ID entry and the Stage 26 panel, and retains Connect/Sync/Disconnect.
- The OAuth helper remains necessary to retain the main database's isolation
  policy. It uses the real GIS token model and existing ephemeral authorization;
  it is not a mocked service. Automated test helpers now live outside the app.
- The user clarified that only the deployed origin is authorized, then explicitly
  cancelled the live Firefox test and requested implementation only. No local
  origin, Google Cloud setting, deployed site or personal collection was changed.
  Real OAuth/Drive results remain unverified; Stage 24's gate stays unchecked.

---

### User acceptance — 2026-10-27

- The user reports private testing worked and explicitly accepts Stage 24 as
  complete. Device, account and transfer details were not supplied; this records
  user acceptance without claiming additional automated or physical-device checks.

## Stage 25: Complete Google Drive Backup and Recovery Workflow

- [ ] **Status:** Implementation underway in Stage 33; Stage 24 accepted by the user

### Goal

Extend the verified login/basic-sync path with snapshot history, explicit merge
and replace recovery, larger resumable transfers, robust retry/account handling
and a finished mobile workflow. Preserve the MVP's connection-time behavior and
all existing local data/backup compatibility guarantees.

### Tasks

1. **Extend cloud discovery and snapshot selection.**
   - Handle paginated history and simultaneous folder creation across devices.
     Discover all eligible app-created snapshots, choose a stable upload folder,
     and retain access to earlier snapshots without deleting duplicate folders.
   - Treat account-scoped cached folder IDs as hints; rediscover after renames,
     moves, permission changes or missing files. Do not adopt unrelated folders
     by display name, broaden Drive access or change the established app markers.
   - Show a dated history ordered by server-assigned upload time with stable
     tie handling. Label it “Most recently uploaded,” not proof of latest edits.
   - Capture the previous latest snapshot before connect-time upload, and keep
     it as the default restore candidate after that upload. Label the new upload
     separately so it does not obscure the cloud version the user may want.
   - Allow explicit selection of an older snapshot if the newest is corrupt,
     unsupported or too large. Never silently substitute an older backup.
     Pin a selected file ID and validated bytes through preview/confirmation.

2. **Complete transfer reliability and larger-file support.**
   - Replace the temporary 4 MiB Drive cap/single multipart path with resumable
     uploads, bounded chunks, progress and cancellation. Apply the shared archive
     limits and document tested device capacities; a 1 GB configured ceiling
     does not establish physical iPhone memory safety.
   - Preserve immutable snapshot bytes/backup ID while resuming; reconcile
     ambiguous completion before starting another upload. Exclude unfinished
     snapshots from history and verify remote size/checksum before success.
   - Add bounded retries/backoff for transient/rate-limit failures. Distinguish
     quota exhaustion, revoked access, expired tokens, missing files and offline
     interruptions. Never retry destructive local work after an ambiguous commit.
   - Resume a pending transfer after user-driven reauthorization without also
     triggering a new connect-time snapshot. Handle expired resumable sessions
     and report unconfirmed remote results honestly.
   - Bound downloads during reading, minimize full-buffer copies, and preserve
     the existing manifest/schema/hash/relationship validation. Test photo-heavy
     files and browser-background interruptions; report actual memory/size limits.

3. **Add explicit cloud merge and replace operations.**
   - Add Restore from Drive: select a history entry, download/validate it, then
     show cloud/local counts and a comparison before any data changes.
     Offer Merge by default:

     | Mode | Local result |
     | --- | --- |
     | **Merge with local collection** | Add new IDs, update differing matching IDs, retain local-only records; show overwrite counts. |
     | **Replace local collection** | Exactly adopt the selected snapshot, removing local-only records; show removal and replacement counts. |

   - Reuse `confirmBackup` and its revision-aware merge/recovery behavior.
     Matching cloud records can overwrite newer local edits; state this clearly.
   - Implement a separate revision-aware replacement API. Choosing the mode does
     nothing by itself: require an explicit **Replace local collection** action
     identifying the snapshot, affected counts and retained recovery copy.
   - Fully validate/stage both incoming tables first. Under serialized database
     access, recheck the local revision, retain a durable immutable pre-replacement
     recovery snapshot, and atomically replace table contents using the existing
     database identity. If local data changed, refresh the preview and reconfirm.
   - Reuse the existing recovery store and `.coffeeos` recovery-download flow.
     Abort if recovery creation fails or exceeds limits. Never overwrite an
     earlier recovery or depend on a cloud upload as the sole recovery copy.
   - Respect parent/child constraints and verify the installed DuckDB API.
     Do not clear OPFS/IndexedDB, delete/recreate the database, change backend,
     rename storage or release its ownership lock to perform replacement.
   - Use the coordinated durable-snapshot/SQL commit path. Pre-commit failures
     roll back to the original collection; post-commit uncertainty shows the
     committed warning, refreshes data and retains access to recovery copies.
     No intermediate empty collection may become the visible or durable result.
   - Restoring a valid empty snapshot into a populated collection needs the same
     destructive confirmation. Cancel and validation failures leave data intact.
   - After merge/replace, refresh both views and report applied results. Do not
     upload the result immediately; the next explicit Sync now creates a snapshot.
     A race that stops MVP empty recovery may now offer this restore workflow.

4. **Finish account handling and mobile interaction.**
   - Extend the MVP section with last confirmed upload, snapshot history,
     restore previews, progress/cancel controls and recovery downloads.
     Maintain a single operation state across connect, transfer and restore.
   - Add deliberate account switching: clear old tokens/pending operations and
     cloud selections, show the new account, and confirm enabling backup to that
     account before sending the existing local collection. Late callbacks from
     an earlier account must never mutate data or start another transfer.
   - Persist only necessary non-secret account-scoped preferences/status in an
     additive documented location. Treat them as advisory; remembered connection
     state is not authorization and must never select the local database.
   - Keep Disconnect non-destructive and explain how Google access can be revoked
     separately. Do not claim that clearing a token revokes Google's grant.
   - Complete accessibility and 393×852 layout checks, clear error/retry states,
     token-expiry guidance and physical iPhone/Home Screen interruption handling.
     Keep offline brewing and file backup/import independent of Google availability.
   - Complete any Google consent/access configuration needed beyond the MVP's
     dedicated test users and document setup/reconnection limitations. Do not
     report testing-mode authorization as verified access for all intended users.

5. **Verify the finished workflow and compatibility.**
   - Extend adapter tests to pagination, ordering ties, multiple marked folders,
     simultaneous uploads, missing/moved files, account switching, interrupted
     transfers, expired sessions, quota/rate limits and delayed callbacks.
   - Verify local/cloud fixtures with conflicting records and local-only IDs:
     merge preserves local-only data, replacement adopts cloud contents exactly,
     and downloadable recovery restores every prior record after reload.
   - Inject failures creating recovery copies, after removal of local rows,
     during incoming inserts, during durable snapshot commit and after commit.
     Check rollback/committed warnings and stale-preview reconfirmation on both
     OPFS and IndexedDB; preserve all baseline archive validation regressions.
   - Run populated previous-build upgrades on both backends in the same isolated
     profile/origin, including prior Stage 24 settings/snapshots. Preserve IDs,
     relationships, dates/nulls, comments, photos and numeric precision; import
     historical backups; prove failed upgrades keep the original data recoverable.
   - Run a real Google test-account workflow across isolated profiles/devices,
     including history discovery, interrupted/resumed upload, reconnect, merge,
     replacement and recovery download. Check isolation before/after login and
     any helper/service-worker update. Mocks do not verify live OAuth/CORS behavior.
   - Verify installed Safari first and Firefox for additional OPFS coverage.
     Check physical iPhone Safari/Home Screen authorization, background behavior,
     transfer sizes and memory where available; explicitly record remaining gaps.
   - Run build, diff checks, existing backup regressions, repository-subpath
     assets and isolation headers. Use separately installed old/candidate
     fixture dependencies when dependency changes require it.

### Acceptance Criteria (Stage 25 Gate)

- Stage 24 login/basic-sync behavior still works; history and explicit recovery
  are added without continuous synchronization or automatic conflict resolution.
- Larger transfers use resumable upload with progress/cancel and bounded retry.
  One operation cannot create duplicate successful snapshots after a lost response.
  Unconfirmed/incomplete uploads are not reported as verified backups.
- Eligible snapshots remain discoverable across profiles and marked folders;
  account changes, pagination and folder/file changes cannot silently hide data
  or send a pending operation to the wrong account.
- Merge retains local-only records. Explicitly confirmed Replace adopts exactly
  the selected validated snapshot and retains a durable downloadable recovery.
  Stale previews, invalid files, cancellation and pre-commit failures preserve
  existing data; post-commit uncertainty produces the correct recovery guidance.
- Existing cloud snapshots are never overwritten/deleted by sync or Disconnect.
  Storage identity, archive format and historical imports remain compatible.
- Mobile/accessibility checks, build, focused reliability tests, populated
  upgrades and real-service workflows pass, with tested sizes and outstanding
  platform/service limitations recorded accurately.
- Continuous sync, scheduled background transfers, multiuser collaboration,
  automatic conflict resolution and automatic cloud retention cleanup remain
  outside this stage.

### Verification — 2026-10-27

- Planning only: moved the fuller workflow and extended failure handling out of
  Stage 24. Neither stage has been implemented or exercised against Google.
- The design retains the previously reviewed official references: Google's
  [browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
  [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
  [upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
  [file listing](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
  and [setup/isolation guidance](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
  These references inform implementation; live compatibility is still unverified.
- All Stage 25 acceptance criteria, browser/service checks and upgrade tests
  remain pending. Stage 24's real-service gate must pass before this work starts.
- Documentation verification: Stages 24 and 25 are sequential and both retain
  unchecked status, Goal, Tasks, acceptance gates and dated notes. Build and
  diff checks passed; earlier completed stages were preserved.


---

## Stage 26: Temporary In-App Drive Diagnostics for Personal Device Testing

- [x] **Status:** Implemented and locally verified; personal Google/device results pending

### Goal

Let the user test Stage 24 on their own account/device and share useful results
without exposing credentials or changing their existing collection. This
requested diagnostic addition accompanies Stage 24; Stage 25 remains deferred.

### Tasks

1. Add a temporary expandable IO view with safe simulated self-tests, explicit
   live round-trip testing and a copyable diagnostic report.
2. Allow one test snapshot upload and a download pinned to that file ID. Verify
   archive bytes, standard restore validation/staging and every stored field.
   Always roll back staging: never write local records, revisions, snapshots or
   recovery entries. Stop on local changes/mismatches and keep the Drive file.
3. Serialize tests with connection/sync controls and suppress cancelled results.
   Report safe request phases/statuses and errors, excluding credentials,
   client ID, account email, photos and record contents.
4. Document Google setup, simulated/live test limits, fresh-profile recovery
   and physical Safari/Home Screen checks.

### Acceptance Criteria (Stage 26 Gate)

- IO exposes Run self-tests, Test Drive round trip and Copy diagnostic report.
  Repeated actions cannot overlap, and disconnected callbacks cannot apply.
- Self-tests use fake transports without Google or collection writes. The live
  path compares the exact pinned snapshot against current values/revision and
  rolls back without local writes; differences/races stop safely.
- Reports include environment, isolation/backend, PASS/FAIL and operation phases
  without credentials or record contents. Phone-width controls have 16px inputs
  and at least 44px touch targets.
- Build, focused Safari/Firefox checks and applicable archive/upgrade checks
  pass. Personal Google/device results remain separate from local verification.

### Verification — 2026-10-27

- Implemented the IO panel and shared 16-test simulated adapter suite. Safari
  27.2 and isolated Firefox passed all checks, exact fixture round trips,
  unchanged collection revision/recovery entries, repeated submissions, readable
  denial, sanitized report and 393px layout. The actual DuckDB validation/staging
  path ran against simulated Drive on both IndexedDB and OPFS. No diagnostic
  local record writes were required.
- Stage 24's populated upgrades, archive regressions, helper/worker isolation,
  build and diff checks cover this addition. No personal browser storage was
  cleared or used for destructive tests. The user's real Google/physical-device
  results remain pending; Stage 24 stays unchecked. This temporary panel can be
  removed in a later numbered update after those results are collected.

### Retirement — 2026-10-27

- Removed the temporary user-facing Drive diagnostic panel and manual client-ID
  entry in Stage 28 at the user's request. Automated safety checks remain in
  `tests/`; the Stage 26 implementation/verification above is retained as history.

---

## Stage 27: Recoverable Database Worker Startup and Loading Diagnostics

- [x] **Status:** Implemented; local failure/recovery checks passed and user confirmed the deployed fix works

### Goal

Address the reported deployed/Home Screen startup hang without resetting storage,
changing backends or hiding an unreadable collection. Surface worker-load failures
and provide useful startup details when initialization cannot finish.

### Tasks

1. Reproduce startup on installed Safari using both Vite and a localhost
   production `/CoffeeOS/` mirror with GitHub Pages-style caching, gzip and
   service-worker isolation. Inspect the public deployed asset responses.
2. Reject worker error/message-decoding failure during instantiation. Bound
   silent runtime loading by a 120-second inactivity deadline that resets on
   actual instantiation progress. Terminate the failed worker before opening or
   registering persistent database files; preserve the recoverable startup path.
3. Expose read-only startup phases and show Reload/copyable startup details
   after ten seconds or any failure. Include browser, isolation, Home Screen,
   controller and local runtime-resource information, without record contents.
   Do not race/abandon an active restore or create an alternative dataset.
4. Verify populated previous-build IndexedDB and OPFS upgrades, failed-worker
   durable-byte preservation, retry/reload, old backups, baseline Safari flows,
   build and repository-subpath/isolation behavior. Record device limitations.

### Acceptance Criteria (Stage 27 Gate)

- A worker load/error or message-decoding failure exits loading with a recoverable
  error. An unresponsive instantiation stops after the bounded inactivity period.
  Failure releases ownership; retry can open the original exact collection.
- Populated previous-build OPFS and IndexedDB fixtures retain exact records,
  relationships, photos, units, precision, dates/nulls/comments and historical
  backup readability after replacement, failure and reload. Failure before open
  leaves the existing durable bytes and backend identity unchanged.
- Slow/failed initialization exposes its phase and copyable environment details
  directly on the loading screen, with a working Reload action and no storage
  reset, automatic backend switch or empty-collection presentation.
- Build, focused failure tests, baseline Safari checks and applicable populated
  upgrades pass. Actual iPhone/Home Screen reproduction and deployed-fix testing
  remain explicitly separate from localhost Safari verification.

### Verification — 2026-10-27

- User reported the deployed app at `https://krischris.github.io/CoffeeOS/`
  remaining on “Loading your coffee data…”. Eight Vite reloads and twelve
  production-mirror starts/reloads passed in isolated Safari 27.2; ordinary
  desktop startup alone did not reproduce the user's precise device trigger.
- Public deployed HTML matches the prior local build. Worker, Wasm and Parquet
  extension URLs returned HTTP 200 with appropriate content types; GitHub Pages
  supplies no native isolation headers and uses a ten-minute HTTP cache.
- Inspected the installed pinned DuckDB-Wasm source map/API: its worker error
  handler clears pending requests without rejecting them. A localhost production
  mirror returning a missing worker reproduced indefinite loading and that exact
  error path. With the candidate, the same failed asset exits loading with a
  recoverable error and startup details. No user storage was reset.
- Added worker error/messageerror handling and a progress-aware instantiation
  deadline before persistent-file registration/open, plus read-only startup phases
  and slow/error diagnostics. Full `test:safari` passed on Safari 27.2/macOS,
  including writes, reload persistence, locks, failed writes, old CSV/Parquet
  imports, UI/layout and committed warnings. Build and diff checks passed.
- Populated upgrades from deployed revision `f5babb8` passed on installed Safari
  27.2/IndexedDB and isolated Firefox/OPFS using `TEST_PREVIOUS_REF=f5babb8` with
  `test:upgrade` and `test:upgrade:firefox`. Worker error, message-decoding failure
  and silent-instantiation timeout each preserved durable byte hashes and exact
  records after Reload. The timeout was shortened only in automation fixtures.
  Old CSV/Parquet imports, photo/session fidelity, startup failure preservation,
  editing/deletion and archive merge/recovery regressions passed on both backends.
- Firefox additionally verified the slow-startup panel with simulated elapsed
  time: phase and copyable details appeared while initialization stayed pending.
  That final clock-based UI assertion was not rerun in Safari before wrap-up;
  Safari's failure panel and Reload actions passed the populated upgrade checks.
  Twelve further starts/reloads of the corrected production mirror passed.
- An intermediate Safari upgrade attempt surfaced a Parquet-load `NetworkError`;
  a subsequent full run passed. The fixture now waits for a new document after
  Reload and reports startup errors without silently retrying initialization.
  The precise original device trigger remains undetermined beyond the reproduced
  worker-load hang path. No storage reset, backend switch or data-format change
  was introduced. Final build and `git diff --check` passed.
- **User confirmation:** on 2026-10-27, the user confirmed in the app that the
  latest fix worked and requested wrap-up. This is user-reported deployed-app
  verification; device/browser versions and a full physical iOS/Home Screen
  lifecycle matrix were not independently checked. No further code changes or
  test runs were made after that request. Stage 24's live Google gate remains
  separate and unchanged.


---

## Stage 28: Registered Google Drive Connection and Remove Temporary Test UI

- [x] **Status:** Implemented; local safety/upgrade checks passed; real Google testing deferred to the user

### Goal

Use the registered public Google client for the ordinary optional Drive backup
workflow. Remove the temporary setup/diagnostic interface while preserving exact
local records, archive compatibility, isolation and all MVP sync safeguards.

### Tasks

1. Configure the user's public web OAuth client as the application default,
   retaining `VITE_GOOGLE_CLIENT_ID` as an optional deployment override. Remove
   the user-facing client-ID field; Connect works with the configured app.
2. Retain normal account display, Connect/Reconnect, Sync now, Disconnect,
   serialization and readable results/errors. Keep the isolated authorization
   helper, minimal scopes, ephemeral tokens and guarded empty recovery.
3. Remove the temporary IO diagnostics, self-test/round-trip/copy-report controls
   and associated styling. Keep adapter tests and round-trip checks in `tests/`,
   outside the app bundle. Preserve startup failure diagnostics from Stage 27.
4. Update the setup guide and Stage 24 notes. Run build, local regressions and
   applicable populated upgrades. Defer real-service testing to the user as
   explicitly requested; do not change authorized origins or publish the app.

### Acceptance Criteria (Stage 28 Gate)

- IO exposes the configured normal connection controls with no client-ID entry
  or temporary Drive test panel. The supplied public registration is used when
  the optional build variable is absent/empty; no secret or token is persisted.
- Normal snapshot upload/guarded empty recovery, Disconnect, failed/expired auth,
  cancellation and operation serialization retain their prior behavior. Local
  records, storage identity, deployment origin and old backups are preserved.
- Automated adapter tests remain runnable without appearing in the app. Safari
  and Firefox local safety regressions, build, diff checks and populated upgrade
  checks pass. Live Google/device results remain explicitly unverified.

### Verification — 2026-10-27

- Configured public ID
  `336592974400-o78vsk4u36ggvfj5u72ppmif98sktsqj.apps.googleusercontent.com`
  in `src/driveConfig.ts`. An empty Pages environment variable falls back to this
  registration. Removed manual ID entry and the temporary IO diagnostic panel;
  self-tests/round-trip helpers moved to `tests/driveChecks.ts`.
- Normal UI retains the same authorization helper and sync engine. Tokens remain
  memory-only; main-page isolation, database ownership/backend, IDs, schema,
  archive format and local/Drive size caps are unchanged. Import refresh failure
  now reports that the import already applied and directs a reload.
- `test:drive` passed on installed Safari 27.2/IndexedDB and isolated Firefox/OPFS:
  all 16 adapter self-tests, photo/session/precision round trips, guarded recovery,
  revision/download races, rollback, reload, double-submit guards, denial and
  393px layout. Tests assert that setup/debug controls are absent. Build passed.
- An initial live attempt used an isolated localhost Firefox profile; Google's
  script initially failed to load and then loaded on a read-only retry. No login,
  consent or transfer completed. The user clarified that only the deployed
  origin is authorized and then cancelled live testing. The proposed production-
  origin candidate override was not run, and the pending browser restart was
  rejected by automatic approval review after cancellation. No personal browsing
  profile, Google account configuration or deployed application was modified.
- Populated previous-build upgrades from `a0a427d` passed with
  `TEST_PREVIOUS_REF=a0a427d uv run npm run test:upgrade` (Safari IndexedDB) and
  `TEST_PREVIOUS_REF=a0a427d uv run npm run test:upgrade:firefox` (Firefox OPFS).
  The same isolated origin/profile retained exact beans/photos/linked sessions,
  dates/nulls/comments and precision across build replacement, startup and reload.
  Old CSV/Parquet imports, failed startup/worker durable-byte preservation,
  rollback, editing/deletion and archive merge/recovery checks all passed.
- Final build and `git diff --check` passed. A production-bundle assertion
  verified the registered client ID is present and the temporary ID input,
  diagnostics, test buttons and fake-token fixtures are absent. Dependencies,
  storage schema/identifiers and deployment origin are unchanged.
- Real Google authorization, Drive transfer and physical iOS/Home Screen checks
  are deferred to the user. No production-origin override or deployment was
  performed. Mocked regressions do not complete the Stage 24 real-service gate.

---

## Stage 29: Stable Session Editor While the Keyboard Is Open

- [x] **Status:** Implemented; desktop Safari checks passed; physical iOS keyboard verification pending

### Goal

Keep the brew/session editor's graph, controls and overall scale steady when
the software keyboard opens, while allowing scrolling to covered fields.

### Tasks

1. Capture editor height, scale, graph height and vertical safe-area padding
   before native input UI opens. Hold them through field changes and keyboard
   dismissal; release on leaving the editor or after focus/viewport recovery.
2. Add scroll space for the covered area without compressing the graph. Preserve
   responsive layout outside editing and on window-width/orientation changes.
3. Verify stable geometry under simulated keyboard viewport changes, covered-field
   scrolling, focus transfer/dismissal, resize and cancel/reopen. Run the existing
   Safari suite, production-subpath/isolation checks and build.

### Acceptance Criteria (Stage 29 Gate)

- Focusing a session input and shrinking the visible viewport leaves the editor
  height/scale, graph dimensions and control sizes unchanged. Covered fields
  remain reachable by scrolling, with draft values intact.
- Moving between fields preserves geometry. Keyboard dismissal after blur,
  cancel/reopen and width/orientation changes release stale sizing. Normal
  responsive layouts, saving, navigation and reload persistence still work.
- Build and desktop Safari regression checks pass. Storage identifiers, schema,
  records, field meanings/units, backup formats, dependencies, startup and service
  workers remain unchanged. Physical iOS keyboard/Home Screen behavior is
  explicitly distinguished from simulated desktop viewport checks.

### Verification — 2026-10-27

- `uv run npm run build` and `git diff --check` passed with the existing project
  `.venv` Node installation (`process.execPath` is inside the project's `.venv`).
- Full `test:safari` passed on installed Safari 27.2/macOS against Vite at
  `http://127.0.0.1:5175/`: startup/navigation, bean/session writes, reload
  persistence, editor layouts/chart, save/cancel, failed-write recovery and old
  CSV/Parquet import/export checks all passed in isolated automation storage.
- Focused desktop Safari checks used the actual editor DOM/CSS and viewport
  helper inside 393×852 and 375×667 frames, with simulated 59/34px safe areas.
  Reducing both the frame and simulated visual viewport by 300px preserved exact
  editor height/scale, chart/control dimensions, safe-top padding and draft
  numeric/comment values. The added scroll range reached Comment above the
  simulated keyboard. Field transfer, blur during dismissal, restored viewport,
  subsequent height resize, width change and reset/cancel/reopen passed.
  Geometry assertions allow subpixel rounding when testing a fresh CSS resize.
- Production `test:safari` passed at
  `http://127.0.0.1:4188/CoffeeOS/` with `TEST_PRODUCTION=1`, including normal
  editor geometry, save/cancel, navigation and IO import/reload persistence.
  An earlier attempt on port 4190 could not load the page in Safari; using the
  browser-compatible port resolved that local test setup issue.
- Dev and production preview returned COOP `same-origin` and COEP `require-corp`.
  Built JavaScript and CSS returned HTTP 200 with the correct content types
  under `/CoffeeOS/assets/`; the production build retains relative asset URLs.
- Changes are limited to session editor UI behavior and CSS. No storage,
  startup, dependency, service-worker, deployment, identifier, schema or backup
  format changes. Previous-build populated OPFS/IndexedDB upgrade suites were
  not rerun for this UI-only refinement; no new upgrade-path pass is claimed.
- Desktop viewport simulation does not reproduce the native iOS keyboard.
  Physical iPhone/iPad keyboard animation, touch scrolling, focus zoom, picker,
  Home Screen and storage lifecycle checks remain unverified. No deployment or
  personal browser profile modification was performed.

---

## Stage 30: Public Privacy Policy and In-App About Overlay

- [x] **Status:** Implemented; build and desktop Safari checks passed; deployment and physical iOS checks pending

### Goal

Provide an accessible public privacy-policy URL for Google OAuth and a readable
About/privacy overlay that keeps users in the app and preserves their current work.

### Tasks

1. Add a standalone `public/privacy.html` explaining CoffeeOS, local storage,
   optional Google account access/Drive transfers, third-party hosting, retention,
   deletion, security limits and the user-approved GitHub project contact.
2. Replace the header tagline with an information icon and About & privacy link.
   Open the same policy text in a scrollable native dialog with a persistent Back
   button, Escape dismissal, focus restoration and recoverable loading failure.
3. Keep the policy public without JavaScript, login or database initialization.
   Share typography between the public page and overlay; preserve relative URLs.
4. Run build, Safari regression and focused overlay/public-page checks, including
   narrow screens, data/reload preservation and production repository subpaths.

### Acceptance Criteria (Stage 30 Gate)

- `/CoffeeOS/privacy.html` is a readable standalone page with clear app identity,
  effective date, accurate Google/data disclosures and the GitHub contact. It
  opens without authorization, app JavaScript or database startup.
- The header visibly links About & privacy. Ordinary activation stays in the
  current page, with scrollable content and a visible Back button. Back/Escape
  restore access/focus to the app and preserve navigation, drafts and records.
  Loading failures allow retry without navigating or altering the collection.
- Build and installed Safari checks pass. Dev/preview isolation headers and
  production-relative assets remain correct. Storage, schemas, identifiers,
  backup formats, dependencies, service workers and deployment origin are unchanged.
  Deployment, Google approval and physical iOS checks are reported separately.

### Verification — 2026-10-27

- Added `public/privacy.html` and shared `public/privacy.css`. The policy
  describes local records/photos and recovery copies, optional Google identity
  and Drive access, connect-triggered transfer, ephemeral credentials, hosting,
  deletion/revocation and backup security limits. The user approved the GitHub
  project as the contact. Checked the Google API Services User Data Policy,
  OAuth privacy-disclosure requirements and GitHub Pages IP logging guidance
  against the implementation; no blanket zero-information claim is made.
- Replaced the header tagline with About & privacy and an information icon.
  Its native dialog fetches the standalone policy on demand, preserves the
  current document, and keeps Back visible above the scrolling text. Failed
  loading offers retry. Safari needed explicit focus restoration on close;
  that behavior passed after the fix. Setup docs record both OAuth URLs.
- `uv run npm run build` passed with Node inside the existing project `.venv`.
  The built homepage references relative `./privacy.css` and hashed app assets;
  public policy HTML/CSS are copied intact into `dist/`. No dependency changes.
- Full `TEST_BASE_URL=http://127.0.0.1:5175/ uv run npm run test:safari` passed
  on installed Safari 27.2/macOS, including startup/navigation, bean/session
  writes, reload persistence, editor/chart layouts, lock/failure safeguards and
  old CSV/Parquet import/export regression checks. An initial run caught the
  dialog's extra form in the existing form-count assertion; Back now uses an
  ordinary button, and the unchanged suite passed.
- Focused isolated Safari checks ran against production preview mounted with
  `--base /CoffeeOS/` at `http://127.0.0.1:4188/CoffeeOS/`. Public policy text
  matched the overlay exactly and loaded without scripts, DuckDB, login or
  external service requests. At 393px width, no horizontal overflow occurred,
  Back retained its 44px touch target and stayed visible while content scrolled.
  Simulated offline failure/retry, same-document navigation, Back/Escape,
  keyboard focus containment/return, active-tab/draft preservation and saved
  bean persistence after reload all passed. Screenshot inspected locally.
- Dev and production preview returned COOP `same-origin` and COEP
  `require-corp`. Production HTML, policy, CSS, manifest/icons and app assets
  returned HTTP 200 with appropriate content types under the repository
  subpath. Plain preview initially lacked the subpath mount; using its CLI
  `--base /CoffeeOS/` option corrected the verification setup without changing
  project config. Final `git diff --check` passed.
- Changes are limited to public policy content, About UI/styles, descriptive
  metadata and documentation. Database initialization/lifecycle, storage names,
  schemas, record units/precision, backup formats, dependencies, service workers,
  isolation settings and deployment origin are unchanged. Previous-build
  populated OPFS/IndexedDB upgrade suites were not rerun for this UI/content
  update; no new upgrade-path pass is claimed.
- No deployment or Google console changes were performed. The public policy URL
  becomes available after deployment; live hosting headers and Google approval
  remain unverified. Physical iPhone/iPad touch, Home Screen and storage
  lifecycle checks remain unverified; desktop Safari does not establish them.

---

## Stage 31: Crawler-Readable Homepage

- [x] **Status:** Implemented; local build, Safari and populated upgrade checks passed; deployment and Google approval pending

### Goal

Make CoffeeOS's purpose and privacy-policy link readable from the homepage's
initial HTML without JavaScript, login or a working database.

### Tasks

1. Add a visible basic homepage with the app name, coffee-journal description,
   local storage and optional Drive backup explanation, and relative policy link.
2. Keep this content available during loading and startup failures; let successful
   startup replace it with the normal app. Explain JavaScript use to users with
   scripts disabled.
3. Verify the built HTML and policy at the repository subpath, installed Safari
   startup/navigation/persistence, and populated previous-build upgrade safety.

### Acceptance Criteria (Stage 31 Gate)

- A plain HTTP client can read the app name, feature description and
  `./privacy.html` link in the production homepage without running scripts.
- The basic view and policy are readable with scripts disabled and on narrow
  screens. Loading/failure retains the link; successful startup removes the
  basic view and retains the ordinary About overlay and app navigation.
- Build, Safari regressions and populated upgrade checks pass; relative production
  assets and isolation headers remain correct. Storage identities, record data,
  backup formats, dependencies, service workers and deployment origin are preserved.
- Live deployment, Google approval, unavailable browser/backend paths and physical
  iOS checks are reported separately with their limitations.

### Verification — 2026-10-27

- Added the app name, coffee-journal description, local storage/optional Drive
  explanation and a normal relative privacy-policy link directly to `index.html`.
  The content is visible without scripts, with JavaScript guidance in `noscript`.
  Startup diagnostics append below this view; successful startup replaces it
  through the existing app rendering. Failure retains the basic view and link.
- `uv run npm run build` and `git diff --check` passed. Node resolves inside the
  existing project `.venv`. Plain HTTP checks against production preview at
  `http://127.0.0.1:4188/CoffeeOS/` found the description/link in the initial HTML.
  Policy, stylesheet, manifest/icons and hashed assets returned HTTP 200 under
  the repository subpath. COOP `same-origin` and COEP `require-corp` were retained.
- Full `TEST_BASE_URL=http://127.0.0.1:5174/ uv run npm run test:safari` passed on
  installed Safari 27.2/macOS: startup/navigation, bean/session writes, reload
  persistence, failure/ownership safeguards, editing and legacy CSV/Parquet
  import/export checks.
- Focused isolated Safari checks used the production build, localhost-only
  fixtures and a 393px window. CSP blocked script execution while the homepage
  remained readable, without JavaScript/Wasm/Google requests; its 44px privacy
  link navigated to the standalone policy, with no horizontal overflow.
  Screenshot inspected locally. CSP leaves the parser's scripting flag enabled,
  so native browser-setting-disabled `noscript` rendering was not exercised.
  Simulated pending metadata access and a denied storage getter retained a usable
  policy link. Successful production startup removed the basic view, and the
  ordinary About dialog and app navigation worked.
- Populated upgrades from previous build `27e039b` passed using
  `TEST_PREVIOUS_REF=HEAD uv run npm run test:upgrade` (Safari/IndexedDB) and
  `TEST_PREVIOUS_REF=HEAD uv run npm run test:upgrade:firefox` (isolated Firefox/OPFS).
  Each replaces builds within one profile and origin at `/CoffeeOS/`, comparing
  exact records/relationships, dates, nulls, comments, photos and numeric precision
  through startup/reload, old CSV/Parquet imports and `.coffeeos` recovery. Injected
  worker/open/restore/permission failures preserved durable data and recovered on
  retry. The first Safari attempt hit a local Parquet asset `NetworkError`; an
  unchanged rerun completed the entire suite. No Safari OPFS upgrade pass is claimed.
- Storage logic/identities, schemas, record meanings/units, backup formats,
  dependencies, service workers, isolation settings and deployment origin are
  unchanged. No user collection or normal browsing profile was modified.
- No deployment or Google Console changes performed. Public-host reachability,
  Google approval and physical iPhone/iPad touch, Home Screen and storage lifecycle
  checks remain unverified; these local checks do not establish them.

## Stage 32: Edit Beans from Swipes and the Actions Menu

- [x] **Status:** Implemented; desktop Safari/IndexedDB and Firefox/OPFS upgrade checks passed; physical iOS pending

### Goal

Edit existing beans using the shared Add a bean form, while preserving bean
identity, creation dates, photos and linked brew histories.

### Tasks

1. Reveal a yellow Edit action on right swipe; keep Delete on left swipe and
   expose both actions from the three-dot button, including expanded histories.
2. Open the existing form at the top with the selected bean's name, dates and
   photo. Provide Save and Cancel and restore add mode after completion.
3. Update bean details in place through the existing transactional persistence
   path, guarding repeated submissions and retaining failed edits for retry.
4. Verify edit/cancel, photo handling, rollback/retry, record fidelity, existing
   workflows, populated previous-build upgrades and old backup readability.

### Acceptance Criteria (Stage 32 Gate)

- Right swipe exposes yellow Edit, left swipe exposes Delete, and the three-dot
  menu offers both without accidentally expanding/collapsing the bean.
- Edit from collapsed or expanded cards opens/focuses the prefilled shared form
  at the top. Save updates one existing bean; Cancel/Escape discard edits.
- Name, roast/freeze dates and photo can be changed or cleared where optional.
  Unchanged saves retain original values, including name whitespace, nulls and
  creation timestamp precision. IDs and every linked session field survive.
- Failed writes roll back durable data and retain the draft; retry updates once.
  A committed write with a flush failure shows recovery guidance and exits edit
  mode so retry cannot insert a duplicate. Missing IDs do not create beans.
- Build and desktop Safari checks pass; phone geometry remains usable. Populated
  IndexedDB and OPFS previous-build upgrades at the same origin/subpath retain
  exact records, old CSV/Parquet imports and recoverable startup failures.
- Storage identities, schema, backups, dependencies, service workers and origin
  remain stable. Unverified browser/device/deployment paths are recorded.

### Verification Notes

- 2026-10-27: `uv run npm run build`, test-module syntax and `git diff --check`
  passed. Node resolves to `/Users/kkrol/Projects/CoffeeOS/.venv/bin/node`.
- Full `TEST_BASE_URL=http://127.0.0.1:5176/ uv run npm run test:safari` passed
  on installed Safari 27.2/macOS: startup/navigation, bean/session writes,
  reload persistence, validation, phone layouts, backups and failure safeguards.
- Added focused bean-edit checks to the populated upgrade suites: both swipe
  directions, menu access and expanded-history editing, prefill/focus/top,
  unchanged full CSV equality (including microsecond creation timestamps and
  whitespace), Cancel/Escape, blank names, exact sibling/session preservation,
  rename/date changes, photo replacement/removal, cancel during photo decoding,
  rollback/reopen/retry, repeated submit, committed-flush recovery and missing IDs.
  All focused checks passed in isolated Safari and Firefox sessions.
- The installed DuckDB runtime rejects `UPDATE ... RETURNING id` for parents
  referenced by brew sessions. A focused probe confirmed that updating non-key
  fields without RETURNING succeeds. The final method uses the existing durable
  transaction path, then selects the bean under the same serialized queue;
  identity, creation timestamp and sessions are never replaced.
- Safari's automation can leave empty date segments invalid after assigning
  `.value = ''`, even while `validity.valid` is true. An isolated native-control
  probe confirmed resetting `valueAsDate` after clearing resolves this. Fixtures
  now reset that native value; app validation remains enabled. Nullable editor
  prefills also reset the native date value explicitly.
- Populated upgrades from previous build `4d31002` passed with
  `TEST_PREVIOUS_REF=HEAD uv run npm run test:upgrade` (Safari/IndexedDB), replacing
  builds at the same `/CoffeeOS/` origin/profile. Exact records survived startup
  and reload; old CSV/Parquet imports, `.coffeeos` recovery and injected failed
  startup/write preservation checks passed. Some earlier Safari attempts hit a
  transient local Parquet asset NetworkError; the unchanged final run passed.
- Safari edit-form geometry passed at 320×568 and 393×852 with simulated safe
  areas. No horizontal overflow; both Save/Cancel retain at least 44px targets.
  At 393×852 the photo-inclusive form fits above navigation. The screenshot at
  `.cache/bean-edit-safari.png` was inspected locally. Swipe checks use synthetic
  pointer events; these do not establish physical-device touch behavior.
- Production preview at `http://127.0.0.1:4188/CoffeeOS/` retained COOP
  `same-origin` and COEP `require-corp`; all eight HTML-linked assets returned
  HTTP 200 under the repository subpath. Storage identities, schema, units,
  backup formats, dependencies, startup, service workers and origin are unchanged.
- Final `TEST_PREVIOUS_REF=HEAD FIREFOX_BIDI_URL=ws://127.0.0.1:9228/session
  uv run npm run test:upgrade:firefox` passed in an isolated localhost-only
  Firefox profile, verifying populated OPFS build replacement, exact records,
  old backups, new bean/session edits, failed startup/write preservation and reload.
- Safari OPFS upgrades, physical iPhone/iPad touch, keyboard/viewport and Home
  Screen/storage lifecycle, and deployed-host response headers remain unverified.
  No deployment performed; no normal browsing profile or user collection modified.

---

## Stage 33: Implement Stage 25 Drive History, Transfers and Recovery

- [ ] **Status:** In progress

### Goal

Deliver the Stage 25 workflow after the user's Stage 24 acceptance, preserving
all existing local records, storage identities and historical backup formats.

### Tasks

1. Add complete paginated history and stable marked-folder selection.
2. Add resumable uploads, bounded retries, progress/cancel and reauthorization.
3. Add pinned restore previews, merge and explicit atomic replacement with
   durable recovery copies and stale-preview protection.
4. Complete account switching and mobile controls; document service limitations.
5. Run adapter, restore-failure, Safari, populated upgrade and subpath checks.

### Acceptance Criteria (Stage 33 Gate)

- Stage 25's functional and data-preservation criteria are met; completed files
  remain discoverable and transfer retries do not duplicate successful snapshots.
- Explicit replacement preserves a downloadable recovery, rolls back failures
  and requires renewed confirmation after any local change.
- Build, focused browser checks and previous-build IndexedDB/OPFS upgrades pass.
- Actual tested sizes, live-service and physical iOS gaps are recorded separately.

### Verification — 2026-10-27

- Implementation started. Stage 24 marked complete on the user's private-test
  acceptance. Existing Stage 29 removed archive size caps; this update preserves
  that decision rather than reintroducing the older Stage 25 proposed 1 GB cap.
