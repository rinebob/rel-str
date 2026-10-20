**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1157  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1014  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1014 FE-IMPL: service path re-points

## Scope

Mechanical re-point of FE Firestore reads/writes onto canonical `st-*`
roots (`@st/collections`). No visual or behavioral change is intended —
acceptance = each surface still reads/writes its data, on the right
collection.

## Result: PASS

All executable checks passed. Two roots intended for re-point were
found **empty in prod** during QA and the re-points were reverted as
defects (see Findings) — the shipped behavior is every surface reads a
populated root.

## Prerequisites

- Prod Firebase project `rel-str`; admin access via
  `functions/src/firebase-admin-init` (used by `.devin/tmp` probes).
- Dev server already running: `http://localhost:4210` (ng serve, watch
  mode — the cutover bundle is what it serves).
- Jest: `npx jest --coverage=false`.

## Scenario 1 — canonical roots hold prod data

Feature: every re-pointed surface reads a populated collection.
Steps: `npx tsx .devin/tmp/probe-1014-paths.ts`.
Expected: every in-scope root reports `docs>0`.

| Root | Docs | Result |
|---|---|---|
| st-symbol-lists | 7 | PASS |
| st-strategy-instances | 4 | PASS |
| st-portfolio/buckets/items | 6 | PASS |
| st-portfolio/attributions/items | 39 | PASS |
| st-backtest-runs | 10 | PASS |
| st-backtest-permutations | 10 | PASS |
| st-config | 3 | PASS |
| savant-trader/data/runs (legacy, reverted) | 217 | PASS |
| st-runs | **0** | expected empty — revert verified |
| savant-trader/data/symbols (legacy, reverted) | 926 | PASS |
| st-symbols | **0** | expected empty — revert verified |
| paper-trading/analysis-* (deferred, #1160) | 4+2 | PASS |

## Scenario 2 — path assertions on the SDK boundary

Feature: services actually call Firestore with the new paths (not just
import the constants).
Steps: `npx jest --coverage=false` on the affected suites
(symbol-list, strategy-builder, trading-config, allocation-bucket,
position-attribution, st-path-cutover-1014).
Expected: all green; specs assert exact `path` args on mocked refs.
Result: **PASS** — 842 tests across touched suites + `shared/`
contracts; 4144/4144 full suite earlier in the round.

## Scenario 3 — no legacy literals outside pinned constants

Feature: grep-based check per the TEST doc.
Steps: `st-path-cutover-1014.spec.ts` — fs-scan of `src/app/**/*.ts`
for `'savant-trader/data/`, `'paper-trading/`, `'portfolio/{buckets,
attributions}`, `'backtest-{runs,permutations}` literals; allowlist =
`core/common/constants.ts` + the spec itself; comment lines filtered.
Result: **PASS** — zero hits outside allowlist. Retained members
(`ST_ORDER_INTENTS`/`ST_REVIEW_LIST`/`ST_OCCURRENCE_DECISIONS`/
`ST_SYMBOLS`/`ST_RUNS`) pinned to legacy spellings for #1015–#1019 and
the deferred gaps.

## Scenario 4 — compile + dev server

Steps: `npx tsc --noEmit -p tsconfig.json`; `curl -s -o nul -w "%{http_code}" http://localhost:4210/`.
Result: **PASS** — zero errors in touched files (4 pre-existing errors
in unrelated user-WIP files); dev server serves the rebuilt bundle
(HTTP 200, `app-root` present). Index listing confirms all #1012
composites defined; #1014 queries are single-field predicates — no
composite dependency.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| All FE collection paths updated to st- names | 1, 2, 3 — where canonical roots are populated |
| No remaining legacy path literals (Firestore sense) | 3 |
| No dead UI / surfaces still read data | 1 + 4 (prod data + bundle) |
| Service specs assert stubbed-Firestore path args | 2 |

## Refinement pass

No user-facing surface changed — pure path swap, identical UI.
Verified via: prod data present on every read root, the running dev
bundle serves cleanly, and all spec contracts hold. Any visual check is
identity vs. pre-change behavior.

## Findings

- **Defect found & fixed in QA:** `st-runs` and `st-symbols` are empty
  in prod — re-pointing there would have shipped empty surfaces.
  `run.service.ts`, `signal.service.ts`, `chart-review.component.ts`
  reverted to `Collection.ST_RUNS`/`ST_SYMBOLS` (user made the ST_RUNS
  revert during review; QA applied the identical ST_SYMBOLS revert).
  Follow-up: **#1159** BE-IMPL st-runs + st-symbols migration.
- **Blueprint gap (deferred, review round 1):** `analysis.service.ts`
  remains on `paper-trading/analysis-datasets|analysis-slices` — no
  canonical destination exists. Follow-up: **#1160** BE-IMPL
  st-paper-trading analysis anchors + FE re-point.
- **Ship note:** `chart-review.component.ts` and `signal.service.ts`
  contain unrelated user WIP (`willLeaveActiveList`) — hunk-level
  staging required at ship.

## Regression smoke

- Symbol lists, strategy builder, portfolio allocation, backtest
  viewers, trading config — all covered by Scenario 2 specs plus the
  46-suite affected-surface run earlier (723/723 green).
- Nearby untouched services (order-ticket, triage, occurrence-decision,
  paper-trading callable paths) unchanged and still green.
