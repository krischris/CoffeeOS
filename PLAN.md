# Project Specification & Staged Execution Plan: `coffeos`

## 0. Global Rules for All Agent Sessions (READ FIRST)
1. **Strict Stage Scoping:** You will be asked to execute ONE stage at a time (Stage 1, 2, 3, 4, or 5). Complete ONLY the requested stage, verify the Acceptance Criteria, update the status checkbox in this file, and STOP.
2. **Scoped Toolchain via `uv`:** Do NOT assume global `node` or `npm` exist on the host machine. Node.js is installed inside `./.venv` via `nodeenv`. **Every single `node`, `npm`, or `npx` command MUST be prefixed with `uv run`** (e.g., `uv run npm install`, `uv run npx tsc --noEmit`, `uv run npm run build`).
3. **Tech Stack:**
   - Vanilla TypeScript + Vite (no heavy UI frameworks; clean modular DOM rendering).
   - `@duckdb/duckdb-wasm` for in-browser SQL storage, backed by OPFS (`opfs://coffeos.db`) with an automatic IndexedDB/in-memory fallback if OPFS locks or is unavailable.
   - Mobile-first iOS Web App (PWA) design: all `<input>` and `<select>` elements MUST have `font-size: 16px` (prevents iOS Safari auto-zoom) and touch targets `min-height: 44px`.
4. **Domain Formula:**
   $$\text{Extraction (\%)} = \frac{\text{Yield (g)} \times \text{TDS (\%)}}{\text{Dose (g)}}$$

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

### Acceptance Criteria (Stage 1 Gate)
- `uv run npx tsc --noEmit` passes with zero errors.
- `uv run npm run build` succeeds and outputs `./dist`.
- Opening the app renders the 3-tab shell defaulting to **Brew Controller**.
- **STOP HERE.** Do not install or write DuckDB logic yet.

### Verification — 2026-10-25
- `uv run npx tsc --noEmit` and `uv run npm run build` both passed.
- Headless Chrome confirmed Brew Controller is the default, all three tabs switch
  correctly, keyboard navigation works, and the main content scrolls above the
  fixed tab bar at mobile and desktop widths.
- Dev and preview responses include COOP `same-origin` and COEP `require-corp`.
- Served `dist/` under `/coffeeos/` without server isolation headers: all relative
  assets, manifest, and icons loaded, and the service worker enabled
  `window.crossOriginIsolated` with the expected headers in two fresh browser
  profiles. No unhandled browser exceptions or missing resources were observed.
- Actual GitHub Pages deployment and physical iOS checks remain deployment
  validation; no database initialization or persistence logic was added.

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

