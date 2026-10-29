# UAT — #1285 Contract-list table + contract-series dialog (FE)

**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1327  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1285  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

**Verdict:** PASS

## Evidence

| # | Scenario | Method | Result |
|---|---|---|---|
| 1 | Pick row renders all columns (entry, contractId, side, exp+DTE, strike, Δ, IV, mark, bid/ask, vol, OI, und. close) | spec: `renders a pick row with all columns` | PASS |
| 2 | `no-selection` marker row renders in place, never omitted | spec: `renders a no-selection marker row in place` | PASS |
| 3 | Marker reason labels (miss→no match, gap→data gap, out-of-range) | spec + `REASON_LABELS` map | PASS |
| 4 | `repeatsPrevious` rows carry `↻ repeat` badge; each stays its own row | spec: `labels repeatsPrevious rows with a repeat badge` | PASS |
| 5 | Rows sorted by entryDate regardless of input order | spec: `sorts rows by entryDate` | PASS |
| 6 | Coverage header shows pick/miss counts, date range, gridVersion from `pickDocMeta` | spec: `renders the coverage header from pickDocMeta` | PASS |
| 7 | Coverage header absent when `pickDocMeta` absent | spec: `omits the coverage header when pickDocMeta is absent` | PASS |
| 8 | Side maps SHORT→STO, LONG→BTO | spec: `maps side to STO for short and BTO for long` | PASS |
| 9 | Row inspect action emits the pick row; marker rows have no action | spec: `emits the pick row on inspect` | PASS |
| 10 | Dialog fetches exactly `(symbol, contractId)` on open | spec: `fetches exactly the row contractId + symbol` | PASS |
| 11 | Loading → mark-line polyline with min/mid/max ticks + dates | spec: `shows loading until the series arrives` | PASS |
| 12 | Single-observation series → dot, not polyline | spec: `renders a single-observation series as a dot` | PASS |
| 13 | Unparseable/missing marks dropped; all-dropped → empty | spec: `drops observations with missing/non-numeric marks` | PASS |
| 14 | Empty series → empty state naming contractId | spec: `renders the empty state` | PASS |
| 15 | Fetch error → error state naming contractId + message | spec: `renders the error state naming the contractId` | PASS |
| 16 | No contract data persisted client-side | read-only fetch; nothing written to Firestore | PASS (code trace) |
| 17 | Run-detail: collapsed-by-default row toggle; expand → table; inspect → dialog `{symbol, contractId, entryDate}` | spec: `keeps the row table collapsed until the row-count toggle is clicked` + `opens the series dialog` | PASS |
| 18 | Sim section untouched | diff verified — replay components additive | PASS |
| 19 | IV renders as percent (fraction convention, verified vs SA write path + `iv*100` codebase convention) | review-pass trace | PASS |

## Suite evidence

`npx jest options-replay` → **69/69** across 9 suites (table 8, dialog 6,
run-detail 6 incl. 2 new, plus existing suites). NG0914 zoneless/Zone.js
warnings are existing test-env noise. `tsc --noEmit` clean at implement.

## Traceability

| AC | Scenario(s) |
|---|---|
| Pick rows all columns; marker rows explicit | 1–3 |
| Repeat label, distinct rows | 4 |
| Coverage header: counts, range, gridVersion | 6–7 |
| Row action → dialog, exact contractId fetch | 9–10 |
| Loading → line → error/empty; error names contractId | 11–15 |
| No client persistence | 16 |
| Tests per TEST-FE | all (16 new specs) |

## Residuals

- No live-data run verified yet — needs a real replay run on the deployed app
  (`optionsReplayStart` → worker → list docs → expand a symbol card → inspect a row).
- Coverage counts come from `pickDocMeta` verbatim (per TEST-FE's pick-one-source
  guidance) — a meta/rows mismatch would display meta's numbers, not row-derived.
- Volume/OI render as plain integers (no thousand separators) — matches neighboring
  table conventions.
