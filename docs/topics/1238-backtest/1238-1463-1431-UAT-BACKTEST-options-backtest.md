**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1463  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1431  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-12  

# UAT — #1431: Analysis results — UAT follow-ups (open outcome, hit-rate, table enhancements)

## Background

#1431 bundles twelve follow-ups from the analysis-results UATs (#1425,
#1435): three worker/contract bugs (missing `open` outcome, structural
0% hit-rate on the `expiry` rule, all-OTM verification) and nine results
-page enhancements (position count, run-params headline, Δ mark column,
MAE %, per-strategy wins/losses, outcome filter chips, capital/ROC,
back nav, per-rule chart send). `EXIT_REGISTRY_VERSION` bumped 1→2 —
existing result docs render but are flagged `stale`; the chart deep
link refuses them until a re-analyze produces v2 docs.

## Scope

- Worker/contract: `open` outcome variant, `openCount` aggregate, hit
  -rate denominator excluding open+error, expiry-kind `expiredCount`
  numerator — `functions/src/options-analysis/{records,aggregate}.ts`,
  `shared/options-analysis-contracts.ts`, `shared/options-analysis-registry.ts`
- Results page: store `analysis-results.store.ts`, metrics util
  `backtest/utils/analysis-results-metrics.util.ts`, page component +
  template, `options-replay-runs.service.ts` `watchRunDoc`, converter
  `openCount` backfill
- Chart handoff: `utils/analysis-results-emit.util.ts`,
  `option-chart-list.service.ts` `?results=` deep link + stale gate,
  `option-chart-load.service.ts` `emitEntriesToChart` marker-line
  round-trip, `option-chart.component.ts` `bindResultsDeepLink()`
- Verify probe: `functions/scripts/verify/options-analysis-all-otm-1431.ts`

## Prerequisites

- Local repo at `C:\aa\projects\rel-str`, deps installed
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`
- Dev server: `npm start` (app reads prod Firestore — v1 result docs
  exist and are usable for the stale-gated scenarios)
- **Deploy-gated legs** are marked ⛔ DEPLOY — they need
  `firebase deploy --only functions` (the `open` outcome + aggregate
  semantics live in the worker, not yet deployed) plus one re-analyze
  of a recent run

## Getting to the feature

- **Route:** `/options/strategy/backtest/analysis/{listDocId}` (the
  `listDocId` is the run doc id — e.g. `or-2026-11-02_tue_1200_manual_x9_SPY`)
- **Entry point:** `/options/strategy/backtest` → a completed run's
  row → **View Results** (available once its analysis docs exist;
  run **Analyze** first if not)
- **Chart link target:** `/options/chart?results={listDocId}_{exitId}`
- **Landing surface:** aggregate table (one row per registered exit
  rule) above the per-contract event table; headline strip + outcome
  chips above it

## Scenarios

### S1 — Automated evidence (run by agent)

- [x] BE suite `npx tsx --test tests/functions/options-analysis/*.test.ts`
  — **68/68 PASS** — open-outcome records, per-rule excursions,
  `openCount`, expiry numerator, denominator exclusions
- [x] FE suites — **148/148 PASS** over `analysis-results.store`,
  results component, converter, emit util, `option-chart-{list,services,
  component,dom,generator}` — filters, W/L, header, capital/ROC,
  `?results=` consume-once + stale refusal
- [x] `npx tsc --noEmit -p tsconfig.app.json` — clean; functions build clean
- [x] Live probe `functions/scripts/verify/options-analysis-all-otm-1431.ts`
  — **PASS** — 24 result docs, 1,588 expired records (511 ITM / 1,077
  OTM), 0 intrinsic↔ITM violations; `GOOG260220P00315000` spot check
  (strike 315 vs close 314.90) recomputed exactly

### S2 — Results page surface — exercised on v2 docs (stale leg spec-pinned)

All 36 prod result docs were re-analyzed to registry v2 during S4, so a
v1 stale doc no longer exists to render — the `stale`-chip leg is pinned
by the store/component specs (registry-mismatch flag + refusal text)
rather than live observation. Every other leg ran live on v2 docs.

- [x] Headline reads `{symbol} · {friendly template name} · {N}
  positions · from {startDate}`; "Analyzed" stamp renders — **PASS**
  (v2 docs; `stale` chip spec-pinned)
- [x] Event table: `Mark change` shows `±delta` + `%` on exit/expired
  rows, `—` on open/error; `Exit mark` shows the terminal mark itself;
  `Entry Δ` / `Entry IV` carry pick-day greeks; `Exit Δ` / `Exit IV`
  carry terminal-bar greeks; MAE cell carries `% of premium` subtext;
  capital/ROC column shows `${strike×100}` + `{roc}%` on CSP rows —
  **PASS** (user-confirmed columns populate post-deploy)
- [x] Aggregate table: W / L column counts resolve side-aware; `Open`
  column counts live open records — **PASS**
- [x] Outcome chips (All / Exit / Expired / Open / Error) AND with the
  exit-type chips — **PASS**
- [x] ← Backtest link returns to `/options/strategy/backtest` — **PASS**

### S3 — Chart deep link, stale refusal — spec-pinned (no v1 docs remain)

- [x] Stale-registry refusal ("re-run Analyze before charting"), param
  consumed + cleared, no re-fire on refresh — **PASS (spec-pinned)**:
  `option-chart-list.spec.ts` `?results=` stale-refusal + consume-once
  specs pin the path; with all prod docs at v2 the refusal branch is no
  longer live-reachable

### S4 — ⛔ DEPLOY: fresh analysis on a recent run — **DONE**

Worker `optionsreplayanalysis-00012-kiy` (registry v2 + greeks build)
deployed 2026-11-12; all 36 result docs re-analyzed.

- [x] `still open · as of {lastBarDate}` rows under every rule — **PASS**:
  523 `open` records across 36 docs, zero `error: series ends … before
  expiry` survivors; `Open` aggregate column counts them
- [x] `expiry` rule row shows a non-zero hit rate (expired share);
  other rules exclude open+error from the denominator — **PASS**
- [x] Open rows carry real days-held + MAE/MFE values — **PASS**; all
  523 open records carry `terminalDelta`/`terminalIv`/`terminalMark`
  (field census: `entryDelta` on 7,602/7,602 records; terminal fields on
  7,524 — the 78 without are error records with no series, by design)

### S5 — ⛔ DEPLOY: chart send on a v2 doc — **DONE**

- [x] A v2 doc's `chart` link plots its contracts — pick-day dots plus
  terminal markers per record outcome; error records carry pick-day
  only — **PASS** (user-run on v2 docs, incl. the >50 picker handoff
  covered by #1471's QA)
- [x] The textarea is rewritten to one `date,id` line per marker; a
  re-**Load** of the field round-trips the same plotted set with dots —
  **PASS**
- [x] A second `chart` link on another rule supersedes cleanly — **PASS**

### S6 — Refinement pass (UI surface — needs eyes)

- [x] Headline strip hierarchy reads correctly (symbol · template ·
  count · start date) vs the Analyzed stamp — **PASS**
- [x] New columns (Δ mark, W/L, cap/ROC) don't crowd/wrap badly at
  desktop + narrow widths; `—` cells align — **PASS**
- [x] Outcome chip row reads distinctly from the exit-type chips — **PASS**
- [x] `still open`/`error`/`expired` outcome-cell color coding is
  distinguishable — **PASS**

## Traceability

| Issue item | Scenario(s) |
|---|---|
| 1 `open` outcome + openCount + render | S1, S4, S2 (column) |
| 2 expiry-rule hit rate | S1, S4 |
| 3 all-OTM verification | S1 probe |
| 4 position count | S2 headline |
| 5 run-params headline + startDate | S2 headline |
| 6 Δ mark + % | S2, S1 |
| 7 MAE % subtext | S2, S1 |
| 8 wins/losses side-aware | S2, S1 |
| 9 outcome chips | S2, S1 |
| 10 capital/ROC | S2, S1 |
| 11 back nav | S2 |
| 12 chart send + markers | S3 (refusal), S5 (success) |

## Regression smoke

- [x] A run with all-expired results still renders normally — **PASS**
  (older-window v2 docs render; no v1 docs remain for the stale flag)
- [x] Contract-list `?list=` deep link on the option chart still opens
  the picker — **PASS** (exercised live during #1471's QA on the same
  surfaces)
- [x] Textarea paste/`date,id` load on the option chart unchanged —
  **PASS**

## Results log

- 2026-11-11 — S1: BE 68/68, FE 148/148, tsc + functions build clean;
  probe PASS (24 docs / 1,588 records / 0 violations / spot recompute
  exact). S2–S6 pending (S4–S5 deploy-gated).
- 2026-11-11 — In-QA additions (user-requested): `Δ mark` header →
  `Mark change` (avoided option-delta confusion); five new columns —
  `Exit mark`, `Entry Δ`, `Entry IV`, `Exit Δ`, `Exit IV` backed by new
  optional record fields `entryDelta`/`entryIv` (pick row) and
  `terminalMark`/`terminalDelta`/`terminalIv` (terminal bar per
  outcome). Re-verified: BE 70/70, component 24/24, tsc + functions
  build clean.
- 2026-11-12 — **QA CLOSEOUT — PASS.** Deploy gate cleared: worker
  `optionsreplayanalysis-00012-kiy` (registry v2 + greeks build) live;
  all 36 result docs re-analyzed. Post-deploy field census: `entryDelta`
  on 7,602/7,602 records; `terminalDelta`/`terminalIv`/`terminalMark` on
  7,524 (the 78 without are error records — no series — by design); 523
  `open` records, all with terminal fields. S4/S5 ran live and pass
  (user-run); S2's stale-chip leg and S3's refusal are spec-pinned — no
  v1 docs remain to exercise them; S6 user-confirmed. No findings.
