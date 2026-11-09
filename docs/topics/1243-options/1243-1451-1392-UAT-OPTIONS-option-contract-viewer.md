**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** options  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1451  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1392  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-09  
**Last Updated:** 2026-11-09  

# UAT — Extract option-chart page wiring (#1392)

## Scope

#1392 split `option-chart.component.ts` (1,108 lines, over the repo's
1k hard rule) into a 362-line composition root + six page-scoped
injectables (`page` context, `catalog`, `load`, `list`, `replay`,
`generator`) + a shared `OPTION_CHART_PAGE_PROVIDERS` list. It is a
**behavior-preserving refactor** — nothing visible should change. This
UAT is therefore a **regression acceptance**: every pre-existing flow
must work exactly as before, plus the page must still boot. Any
behavioral difference vs. prod memory is a finding.

Task acceptance criteria (all verified in the code review — this UAT
confirms them at runtime):

1. Component under 1,000 lines (delivered: 362).
2. List wiring page-scoped; picker resolves the same
   `ContractListSessionStore` instance the page provides.
3. `?list=` deep link: consume-once + `replaceUrl` clear, cross-symbol
   switch before load, named error outside the drawer.
4. Chooser → picker performs a single `getList$` read.
5. Existing specs green; new unit seams have specs.
6. TypeScript + template (AOT) compile clean.

## Prerequisites

- Dev server: `npm start` (or `ng serve`) → http://localhost:4200 —
  already running during QA prep, hot-reloaded to the refactored code.
- Signed in to the app (Firestore-backed flows: contract lists, replay
  runs require auth + rules access).
- `?list=` doc ids (verified live in `st-options-contract-lists`,
  `status=success`, pulled 2026-11-08):
  - QQQ: `2026-11-06_fri_120138_manual_j9gqhh_QQQ` (csp-45-20, 212
    picks, 2026-01-02→2026-11-05)
  - SPY (cross-symbol): `2026-11-06_fri_120138_manual_09h45m_SPY`
    (csp-45-20, 205 picks)
  - Also available: XOM `2026-11-07_sat_142311_manual_dbdl0c_XOM`,
    NFLX `2026-11-06_fri_132650_manual_y00qbp_NFLX`
- A valid OCC contract id **present in the partner corpus** for
  paste-loads. Verified root cause of the first QA hit:
  `QQQ260619P00470000` → upstream `404 "Time series object not found"`
  (Cloud Logging, `getHistoricalOptionsContract_error`) — a corpus
  data-miss for that contract, not a code defect. Use a contract from
  an on-page catalog query, or `QQQ261218P00645000` (fetched 686
  series on 2026-11-07 per function logs).

## Getting to the feature

Route: **`/options/chart`**. Entry point: app nav → **Options → Chart**.
You land on the option contract viewer:

- **Left side panel (collapsible)** — contract input textarea + Load,
  symbol, catalog builder fields, replay-run dropdown, catalog table.
- **Right side drawer (collapsible, `generatorOpen`)** — the current
  interactive control surface: "Contract list" section (Lists… chooser
  button, active-list summary, Open picker) on top, the option-group
  generator below it.
- **Center** — contract chart with underlying overlay, chips strip,
  and the contract catalog table in the panel area.

(The left control panel is slated for rework under #1423 — the right
drawer is where the newer list/generator workflows live.)

## Automated evidence (executed this session)

- `npx jest src/app/features/savant-trader/pages/option-chart` —
  **4 suites / 71 tests green** (62 pre-existing + 9 new seam specs)
- `npx jest` — **304 suites / 5,354 tests green**
- `npx tsc -p tsconfig.app.json --noEmit` — clean
- `npm run build` (AOT) — clean; only the pre-existing `papaparse`
  CommonJS warning
- Mechanical member census: zero pre-refactor members missing from the
  new facade/services; template identifier audit clean

## Scenarios

### 1. Page boots clean

- **Feature:** composition root still wires the page.
- **Steps:** Hard-refresh `http://localhost:4200/options/chart`. Open
  devtools console.
- **Expected:** Page renders — control panel, catalog table (may be
  empty until search), chart area, chips strip. Contract index +
  catalog summary + underlying bars load (network tab shows the three
  requests or their cache hits). **No console errors** (NG0914-zoneless
  warnings, if any, are pre-existing noise).
- **Evidence/result:**

### 2. OCC id paste → Load

- **Feature:** `onLoad` parse → `loadContract`/`loadPlotted` dispatch.
- **Steps:** Paste an unexpired contract id (e.g.
  `QQQ261218P00645000`) in the contract textarea → Load. Then clear,
  paste two dated lines (`2026-10-01,QQQ261218P00645000` +
  `2026-10-08,QQQ261218P00676000`) → Load.
- **Note:** contracts absent from the partner corpus return `INTERNAL`
  (verified: upstream `404 "Time series object not found"` on
  `QQQ260619P00470000`) — the callable rethrows the raw partner error
  instead of mapping 404 → `not-found`, a pre-existing error-surfacing
  gap unrelated to #1392 (candidate CHORE).
- **Expected:** Single id → single-contract view with span marker.
  Pair lines → plotted set: one series per contract, a dot at each
  marker date, chips appear and hover/remove work.
- **Evidence/result:**

### 3. >50-line send → confirm gate

- **Feature:** `LARGE_LIST_WARN_THRESHOLD` confirm + deferred textarea
  write + `loadConfirmOpen` re-entrancy.
- **Steps:** Paste 51+ `date,id` lines (generate via the generator
  drawer or a picker Send of >50 rows — or duplicate a line 51 times;
  duplicates of the same contract still count as entries) → Load →
  Cancel. Then Load → confirm Load.
- **Expected:** Cancel → nothing loads, textarea state consistent.
  Approve → all lines write to the textarea and the set loads.
- **Evidence/result:**

### 4. `?list=` deep link — same-symbol doc

- **Feature:** consume-once deep link → session load → picker opens.
- **Steps:** Navigate to
  `http://localhost:4200/options/chart?list=2026-11-06_fri_120138_manual_j9gqhh_QQQ`.
- **Expected:** The `list` param disappears from the URL (replaceUrl,
  so Back doesn't re-fire), the doc loads into the session, and the
  picker dialog opens with the list's provenance header. Refresh after
  the param cleared → nothing reloads.
- **Evidence/result:**

### 5. `?list=` deep link — cross-symbol doc

- **Feature:** symbol switch happens *before* the doc applies.
- **Steps:** With the page on QQQ, navigate to
  `http://localhost:4200/options/chart?list=2026-11-06_fri_120138_manual_09h45m_SPY`.
- **Expected:** Page symbol input flips to the doc's symbol; the
  picker opens with the doc's rows. (If no second-symbol doc exists,
  skip and note it — the ordering is spec-pinned.)
- **Evidence/result:**

### 6. `?list=` deep link — missing doc

- **Feature:** named error, chart untouched, drawer stays closed.
- **Steps:**
  `http://localhost:4200/options/chart?list=no-such-doc-id`.
- **Expected:** A named error ("Contract list … not found") renders in
  the page's list-error area — visible without opening anything; the
  chart content is unchanged; no picker opens.
- **Evidence/result:**

### 7. "Contract lists…" chooser → pick a doc

- **Feature:** chooser rows are pre-converted docs — the pick applies
  the in-hand doc with **no refetch**.
- **Steps:** Click "Contract lists…" → chooser opens filtered to the
  page symbol (toggle "All symbols" to check filtering) → pick a
  success doc.
- **Expected:** Picker opens immediately with the doc loaded. (Dev
  evidence of single-read is spec-pinned: `getList$` `times(1)`.)
- **Evidence/result:**

### 8. Picker Send → chart, then close/reopen preserves session

- **Feature:** `emitSessionLines` → `emitLinesToChart` → loadPlotted;
  session store survives dialog close.
- **Steps:** In the picker, check a few rows → Send → dialog closes,
  contracts plot with marker dots at each selected date. Click the
  header's picker-reopen button.
- **Expected:** Plotted set matches the sent lines (replace, not
  merge). Reopened picker shows the same doc, selection, and chunk
  cursor — shared page-scoped session instance (AC2).
- **Evidence/result:**

### 9. Symbol input change

- **Feature:** `onSymbolChange` orchestration — clears occ input +
  list error, swaps all three store sessions, reloads symbol data.
- **Steps:** Change the symbol input to a different liquid symbol
  (e.g. SPY) → confirm.
- **Expected:** Symbol propagates (catalog builder, generator, list
  session all point at the new symbol); the OCC textarea clears; any
  stale list error clears; index/summary/bars reload.
- **Evidence/result:**

### 10. Replay dropdown → select a run

- **Feature:** `onReplaySelected` — first-10-Wednesday-picks slice →
  load.
- **Steps:** Pick a completed run from the replay dropdown.
- **Expected:** Textarea fills with `date,id` lines and the set loads;
  runs whose list is a different symbol switch the page first; runs
  with no Wednesday picks name their error.
- **Evidence/result:**

### 11. Generator drawer + brush range

- **Feature:** drawer open state, `(studyRange)` → `applyRange`,
  `brushArmed`, send → load path.
- **Steps:** Open the generator drawer (header toggle) → set query
  fields (type pills + axes) → click **Run** → availability results
  fill the preview → click the header **"Select range"** button → drag
  a range on the chart → confirm the drawer's "alive across" bound
  fills → click **"Send N to chart"** at the bottom of the drawer →
  plot. Then click the range-clear (×) beside "Select range".
- **Note:** "Send N to chart" stays disabled while the filtered set is
  empty (hint: "Run and refine to a non-empty set first") — Run is a
  required first step.
- **Expected:** Range bound reflects the brush; send plots through the
  same load path; clear disarms the brush and clears the bound.
- **Evidence/result:**

### 12. Catalog table interactions

- **Feature:** sort, display filters, filter-to-chart, pagination,
  prev/next — all still delegate through the facade.
- **Steps:** Run a catalog query (builder fields → Search) → click
  column headers to sort → open a display-filter menu and toggle
  values → use "Filter to chart" after brushing a visible window →
  page through results / Load more / Load all → prev/next contract
  buttons.
- **Expected:** Every control works; filter-to-chart reads the chart's
  current visible window (the `chartExtents` hook — spec-pinned both
  branches).
- **Evidence/result:**

### 13. Navigate away with the picker open

- **Feature:** `ngOnDestroy` → `dialog.closeAll()` — the root-scoped
  dialog service must not outlive the page.
- **Steps:** Open the picker → navigate to another page via the nav.
- **Expected:** The picker closes with the page — no stranded dialog
  over the next route.
- **Evidence/result:**

## Manual UI/UX refinement pass

Pure refactor — nothing should *look* different. Verify:

- [ ] Control panel, chips strip, catalog table, and generator drawer
  are pixel-identical to pre-refactor memory — no layout drift
- [ ] Rejected-entries notice and list-error display appear in the same
  spots
- [ ] Light + dark themes unchanged (extraction touched zero styles)
- [ ] No double dialogs; picker reopens cleanly; no focus traps

## Regression / smoke

- [ ] Option chain page still loads (`/options/chain` — shares the
  stores' file dir but not the extracted units; quick boot check only)
- [ ] Replay list detail page unaffected (separate route, same service
  types)

## Findings filed (pre-existing backend — non-blocking, not #1392 defects)

| Issue | What | Evidence |
|---|---|---|
| #1456 — BUG: `getOptionsContractIndex` OOMs at 256 MiB | Intermittent `500` on page-boot index fetch — `Memory limit of 256 MiB exceeded`, chronic across 11-07/11-08 (~10% of calls; retry succeeds) | Cloud Logging; hit in scenario 1 |
| #1457 — CHORE: partner upstream errors flatten to `INTERNAL` | Upstream `404 "Time series object not found"` (`QQQ260619P00470000`) surfaces client-side as `{message:"INTERNAL"}` — `getHistoricalOptionsContract` rethrows raw; siblings map to named codes | Cloud Logging; hit in scenario 2 |

Both verified via Cloud Logging (not inference), classified `BE/OPTIONS`, project Status NOT STARTED, recorded on #1451. #1454 already covers this file's missing auth guard — coordinate fix order.

Also observed (pre-existing UX quirk, byte-identical to pre-refactor — folded into #1423 as new ACs rather than fixing the deprecated left panel): a selection-replay pick leaves `selectedReplayRunId` set and can stomp `occIdInput` if its `watchContractList` fetch resolves after the user edits/clears the textarea (the textarea isn't disabled during `replayLoading`). Fix lands when the controls move to the right drawer: textarea edit → deselect run + stale-run guard in `onReplaySelected`.

## Traceability

| Criterion | Scenario(s) |
|---|---|
| AC1 component <1,000 | Code review (362 lines); boot smoke = 1 |
| AC2 shared page-scoped session store | 7, 8 (close/reopen preserves selection) |
| AC3 `?list=` consume-once/clear/switch/named-error | 4, 5, 6 |
| AC4 single `getList$` read chooser→picker | 7 |
| AC5 specs green + seam specs | Automated evidence |
| AC6 tsc/AOT clean | Automated evidence |
| Regression: onLoad/confirm/emit paths | 2, 3, 8, 11 |
| Regression: symbol switch, replay, catalog, lifecycle | 9, 10, 12, 13 |

## Results log

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Page boots clean | PASS | Booted post-refresh; intermittent `getOptionsContractIndex` OOM observed → filed #1456 (backend, pre-existing) |
| 2 | OCC id paste → Load | PASS | `QQQ261218P00645000` single-id + dated pair lines loaded; corpus-miss `INTERNAL` on `QQQ260619P00470000` → filed #1457 |
| 3 | >50 confirm gate | PASS | User-verified — cancel leaves chart, confirm loads |
| 4 | `?list=` same-symbol | PASS | User-verified 2026-11-08 — `j9gqhh_QQQ` doc |
| 5 | `?list=` cross-symbol | PASS | User-verified 2026-11-08 — `09h45m_SPY` doc, page switched to SPY |
| 6 | `?list=` missing doc | PASS | User-verified 2026-11-08 — named error, chart untouched |
| 7 | Chooser → doc | PASS | User-verified 2026-11-08 — single-read handoff |
| 8 | Picker Send + reopen | PASS | User-verified 2026-11-08 — plotted + session preserved on reopen |
| 9 | Symbol change | PASS* | Orchestration/clears/session swap verified; plotted contracts *stay* on chart = known pre-existing #1440 (BACKLOG), not a #1392 regression |
| 10 | Replay dropdown | PASS | Run plotted Wednesday-pick slice; stale-selection UX quirk folded into #1423 ACs |
| 11 | Generator + brush | PASS | User-verified — Run → Select range → drag → Send N to chart; gen-table multi-sort added this session (spec-pinned) |
| 12 | Catalog interactions | PASS | User-verified — sort headers, display-filter menus, filter-to-chart, pagination |
| 13 | Navigate away w/ picker | DEFERRED | Spec-pinned (`option-chart-list.spec.ts:530` — `ngOnDestroy` → `dialog.closeAll`); manual check deferred to panel-refactor session |
