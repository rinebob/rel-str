**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1393  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1361  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

# UAT — Task #1361: Session store + list service + `?list=` handler + chooser

## Scope

Acceptance coverage for the contract-list session plumbing on the options chart page:
`ContractListService` reads (`getList$`, `recentLists$`), the page-scoped
`ContractListSessionStore` (active list, selection, chunk partition/cursor, `rs-optlist:{SYMBOL}`
persistence), the `?list=` deep-link handler (consume-once + clear, cross-symbol, named errors),
the recent-docs chooser dialog, and the picker shell with Send-to-chart handoff through the
existing textarea/`loadPlotted` path.

The picker is intentionally a **shell** in this task — provenance + counts + Send only.
Rows/stepper/lines UI is #1362; mini-controls/timeline is #1363.

## Prerequisites

- Dev server running (`npm start` — port 4200 or the configured port).
- Firestore access with readable `st-options-contract-lists` docs.
- Browser devtools (localStorage inspection for persistence checks).

### Test doc ids (snapshot 2026-11-04 — verify still present before a rerun)

| Role | Doc id | Status / detail |
|---|---|---|
| **LIST-QQQ** | `2026-11-01_sun_105552_manual_anjw5z_QQQ` | success · csp-45-20 · 204 picks / 4 misses · 2026-01-02→2026-10-29 |
| **LIST-OTHER** | `2026-11-01_sun_105729_manual_al37i0_NVDA` | success · csp-45-20 · NVDA · 207/1 · 2026-01-02→2026-10-29 |
| (alt) | `2026-11-01_sun_105729_manual_al37i0_NFLX` | success · csp-45-20 · NFLX · 208/0 |
| **LIST-FAILED** | `2026-11-01_sun_102702_manual_0mgcz0_QQQ` | status `failed` — exercises the non-success named error |
| (alt failed) | `2026-11-01_sun_102702_manual_0mgcz0_SPY` / `…_AMAT` / `2026-10-29_thu_165447_manual_2xl0rk_QQQ` | status `failed` |
| **LIST-GONE** | `zzz-bogus` | no doc — exercises the not-found error |

Doc ids are also shown on each chooser row (third line, muted mono) so a
rerun can grab fresh ids without Firestore access. To re-list the collection:
`node .devin/tmp/list-contract-lists.js` (requires `firebase login` ADC).

## Start

1. `npm start`, open `http://localhost:{port}/options/chart`
2. The "Contract list" section lives at the top of the **right drawer** (tune icon) — above the generator.

## Scenarios

### S1 — Chooser → picker → send (primary flow)

- **Feature:** chooser lists recent docs; selection loads a session and opens the picker; Send emits `date,id` lines.
- **Start:** `/options/chart` on QQQ, right drawer open.
- **Steps:**
  1. Click **Lists…** — chooser opens filtered to QQQ docs (sorted symbol asc → generatedAt desc).
  2. Toggle **All symbols** — list widens to other symbols' docs; toggle back.
  3. Select the `csp-45-20 · QQQ` row dated 2026-11-01 (id `2026-11-01_sun_105552_manual_anjw5z_QQQ`) — picker opens with the provenance line (`template · symbol · generated · picks · misses · span`) and `N rows selected → M unique contracts`.
  4. Click **Send N rows to chart** — picker closes; the textarea fills with `entryDate,contractId` lines; the chart loads the plotted set.
- **Expected:** one network read for the doc (chooser row IS the doc — no second fetch); chart renders one series per unique contract; no errors.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S2 — `?list=` deep link (explicit)

- **Feature:** `?list={docId}` loads the doc, opens the picker, clears the param.
- **Steps:**
  1. Navigate to `http://localhost:4200/options/chart?list=2026-11-01_sun_105552_manual_anjw5z_QQQ`
  2. Watch the URL bar.
- **Expected:** picker opens with `csp-45-20 · QQQ` provenance (204 picks / 4 misses); the `list` param is removed from the URL (address bar no longer contains `?list=`).
- **Result:** ☑ PASS — user-executed 2026-11-04

### S3 — Deep link does NOT re-fire on refresh (consume-once)

- **Feature:** the param is consumed, so a plain refresh restores silently instead of re-opening the dialog.
- **Steps:** after S2, press F5.
- **Expected:** page reloads with **no dialog and no error chip**. The list session restores in the drawer (provenance line `templateId · N rows`, selection/cursor intact — Open picker reopens it). The chart shows **underlying only** — the plotted set is transient by design (restore never emits; `send*` is the only emit path, same as hand-pasted lines pre-feature). To replot: Open picker → Send.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S4 — Cross-symbol deep link

- **Feature:** a foreign-symbol doc switches the page symbol before loading.
- **Start:** `/options/chart` on QQQ.
- **Steps:** navigate to `http://localhost:4200/options/chart?list=2026-11-01_sun_105729_manual_al37i0_NVDA`
- **Expected:** page symbol flips to NVDA (underlying/inputs update); picker opens with `csp-45-20 · NVDA` provenance (207 picks / 1 miss); session persists under `rs-optlist:NVDA`.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S5 — Bogus `?list=` → named error, chart untouched

- **Feature:** missing doc names its error and never touches chart or session.
- **Steps:** navigate to `http://localhost:4200/options/chart?list=zzz-bogus` (any id that matches no doc) with the right drawer **closed**.
- **Expected:** a `flag-chip err` chip appears in the always-visible content area reading `Contract list "zzz-bogus" not found` (it echoes the raw id from the URL param verbatim — no friendly name) — visible **even with the drawer shut**; chart + textarea unchanged; param cleared from URL.
- **Variant (non-success doc):** `http://localhost:4200/options/chart?list=2026-11-01_sun_102702_manual_0mgcz0_QQQ` → chip reads `Contract list "2026-11-01_sun_102702_manual_0mgcz0_QQQ" has status "failed": pick doc fetch failed for QQQ-put-20-45: no year shard found in [2026, 2026]` — same no-touch guarantees.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S6 — Stale persisted docId → named error (not silent empty)

- **Feature:** restore re-reads the doc; a dead docId surfaces a named error.
- **Steps:**
  1. Devtools → Application → Local Storage → set `rs-optlist:QQQ` to `{"version":1,"docId":"stale-fake-id","chunkSize":10,"cursor":0,"selectionKeys":[]}`.
  2. Reload `/options/chart` on QQQ.
- **Expected:** a named error chip (`…"stale-fake-id" not found`) renders in the content area; no dialog; the blob is rewritten (docId null) so it doesn't re-fail forever.
- **Cleanup:** `localStorage.removeItem('rs-optlist:QQQ')`.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S7 — Recovery clears the error chip

- **Feature:** a successful doc handoff clears a prior page error.
- **Steps:** continuing from S6's error state (or after S5's bogus link), open the drawer → **Lists…** → select a valid doc.
- **Expected:** the error chip disappears; picker opens; session applies.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S8 — Open picker preserves the session

- **Feature:** reopening the picker reuses the session — selection/cursor intact, no reload.
- **Steps:** after S1 or S2, close the picker → drawer → click **Open picker** (under `templateId · N/M rows`).
- **Expected:** picker reopens with the same provenance and same `N rows selected` count — no loading flicker, no refetch.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S9 — Symbol switch clears stale error and swaps sessions

- **Feature:** changing the page symbol drops the old session + any stale error.
- **Steps:** with an error chip showing (S5/S6) OR a live session loaded, change the page symbol to a different ticker. **Note:** the Symbol input commits *per keystroke* (`ngModelChange`) — Enter is a no-op; the switch happens while you type.
- **Expected:** the chip clears on the first keystroke; the drawer section reflects the new symbol's session (or empty); `rs-optlist:{NEW}` is the active blob.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S10 — Send replaces the plotted set

- **Feature:** a second send replaces, not merges.
- **Steps:** send the QQQ list (`2026-11-01_sun_105552_manual_anjw5z_QQQ`) → note plotted chips → load and send the NVDA list (`2026-11-01_sun_105729_manual_al37i0_NVDA`).
- **Expected:** the plotted set is exactly the second list's unique contracts — first list's contracts are gone from chips/legend.
- **Result:** ☑ PASS — user-executed 2026-11-04

### S11 — (Automated) ordering races + edge docs

Covered by specs (manual reproduction is impractical): superseded `?list=` A-then-B keeps B + one picker; chooser pick invalidates an in-flight `?list=`; whitespace `?list=` is consumed without firing a load; failed cross-symbol doc names the error **without** a symbol switch; all-miss doc (success, only `no-selection` rows) → "contains no pick rows".
- **Evidence:** `npx jest --testPathPatterns "contract-list|option-chart"` — **10 suites / 110 tests PASS** (spec names: "superseded ?list=", "chooser pick while a ?list= fetch is in flight", "whitespace ?list=", "failed cross-symbol doc", "all-miss doc").
- **Result:** ☑ PASS — spec suite, 2026-11-04

## Negative/boundary coverage

- Missing doc (`?list=` + chooser can't produce one, restore can) — S5, S6
- Failed/non-success doc — S11 (spec)
- All-miss doc — S11 (spec)
- Cross-symbol — S4, S9
- Ordering races — S11 (spec)
- Whitespace param — S11 (spec)
- Corrupt localStorage blob — settings spec (malformed JSON → defaults, no throw)

## Traceability

| AC | Scenario(s) |
|---|---|
| `?list=` loads doc + opens picker; missing/failed → named error, chart untouched | S2, S5 |
| Cross-symbol docs switch page symbol before loading | S4 |
| Chooser: recent docs, symbol asc → date desc, current-symbol default, widen toggle | S1 |
| Store loads → first-10 select, cursor 0, no-selection rejected | S1 (counts readout) + specs |
| Chunks partition, `i/n · days · unique`, cursor clamps | spec suite (store specs) — UI is #1363 |
| Emit preserves duplicates, excludes no-selection, deterministic | S1, S10 + emit specs |
| `rs-optlist:{SYMBOL}` round-trip; stale docId fails visibly | S3, S6 |

## Regression / smoke checklist

- [ ] `?list=` param absent on plain load — no navigate, no dialog, no error
- [ ] Generator (right drawer below the list section) still generates + sends to textarea
- [ ] Study-range brush still arms/drags/clears (× on the header button)
- [ ] Single-contract load (bare OCC id in textarea) still works
- [ ] Left control panel open/close unaffected by the drawer refactor

## QA execution log

| Date | Scenario | Result | Evidence |
|---|---|---|---|
| 2026-11-04 | S11 (automated) | PASS | `npx jest --testPathPatterns "contract-list\|option-chart"` → 10 suites / 111 tests |
| 2026-11-04 | S1–S8, S10 | PASS | User-executed — all scenarios, all deep-link ids live-verified |
| 2026-11-04 | S9 | PASS | User-confirmed — symbol switch clears chip + swaps session; noted per-keystroke commit (Enter no-op) |
