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
