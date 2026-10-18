**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1103  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1077  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete — QA PASS  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1077 `analysisDatasetTask` live snapshot path

## Scope

Task #1077 acceptance criteria (issue body + BE IMPL §3):

1. Every trade in `paper-trading/trades/items` produces exactly one
   `TradeAnalysisRow`; row count matches what the index doc will record.
2. Signal-linked equity rows (`expression 'EQ'` + signal identity) carry
   the stamped `ind.*` snapshot and computed `strength.*`; manual and
   option-expression trades are flagged `excluded` but kept in the file.
3. Lifecycle is ledger-observed: earliest entry fill, latest exit fill,
   entry/exit dates + prices, status, realizedPnl, marks.
4. Direction-aware `tradeRetPct`; direction-neutral `symbolMovePct`.
5. Excursion from marks (`mark ?? underlyingClose`), direction-aware:
   mfe/mae pct + dates + daysToMfe + givebackRatio;
   `excursionSource: 'marks'`.
6. Open trades keep null exit fields with provisional mark-based return;
   unfilled trades still emit a row with null lifecycle.
7. Scope filters intersect: `symbolScope` ∩ `signalTypes` ∩ `barRange`
   (anchor `signalBarDate ??` entry fill date; fully undated unbounded).
8. Task routes `origin 'live'` → pass; `replay` fails loud until #1078;
   malformed `datasetId` rejected before any doc write; any failure
   attempts `failed` transition.
9. `strength.*` computed once per `symbol|signalBarDate` from daily bars
   loaded once per symbol.
10. verify-1077 relay green on real prod; indexed in README + run-all.

## Prerequisites

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"

# unit evidence (tsx — extensionless TS imports; raw node --test does not resolve them)
npx tsx --test tests/functions/paper-trading/live-snapshot-pass.test.ts tests/functions/paper-trading/analysis-dataset-writer.test.ts tests/functions/paper-trading/generate-trade-dataset.test.ts

# real-prod evidence (read-only dry-run — writes nothing)
npx tsx functions/scripts/verify/paper-trading-analysis-1077-live-snapshot.ts
```

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | One row per trade | Relay check 1 | 247 ledger trades → 247 rows | **PASS** — 247/247 on real prod |
| 2 | Cohorts flagged, not dropped | Relay check 2 | signal-linked EQ → `signal-equity`; manual/option-expression → `excluded`, still emitted | **PASS** — 229 signal-equity + 18 excluded = 247 |
| 3 | `ind.*` verbatim snapshot | Relay check 3 + mapper spec | `signalIndicators` keys land in `ind.*`; never recomputed | **PASS** — 220/229 signal rows stamped (9 legitimately unstamped) |
| 4 | Closed lifecycle | Relay check 4 + spec | exitDate/exitPrice/ret on CLOSED rows | **PASS** — 19 closed rows on prod |
| 5 | Open/unfilled lifecycle | Relay check 5 + specs | OPEN → null exits + provisional mark ret; unfilled → row with nulls | **PASS** — 226 open rows; unfilled spec green |
| 6 | Direction-aware return | Mapper spec | SHORT + falling price → positive `tradeRetPct`; `symbolMovePct` keeps raw sign | **PASS** |
| 7 | Excursion from marks | Relay check 7 + specs | `mfe ≥ ret`, `mae ≤ 0` on closed rows; dates/daysToMfe/giveback consistent | **PASS** — sane on all closed prod rows |
| 8 | Scope filters | Pass spec | symbolScope ∩ signalTypes ∩ barRange; manual bounded by entryDate | **PASS** — incl. manual-trade-leak regression spec |
| 9 | Task routing + guards | Handler inspection | live → `runLiveSnapshot`; replay → `failed`/"#1078"; junk `datasetId` throws before `.doc()`; failed-transition logged not swallowed | **PASS** — review-fixed guards verified in code |
| 10 | Real-prod relay | Run verify script | 7 checks green | **PASS** — 7/7; sample AUGO V2-long row eyeballed (entry 91.81 → exit 82.39, ret −10.2603, `ind.zoneV2: 3`, `strength.diPlus: 34.38`) |
| 11 | Regression — typecheck + suites | `tsc --noEmit`; tsx suites | Clean | **PASS** — tsc clean; 31/31 task-surface specs; 300/300 paper-trading fn suite at review |

## Automated evidence

- `tests/functions/paper-trading/live-snapshot-pass.test.ts`: **12/12**
  (entry/exit fills, marks, short direction, excluded cohorts, ind.\*
  verbatim, strength memoize, unfilled, open-provisional, scope ×3).
- #1076 regression specs re-run: **19/19** (writer 5 + callable 14) —
  the task's writer seam unchanged.
- `functions/scripts/verify/paper-trading-analysis-1077-live-snapshot.ts`:
  **7/7** on real prod — 247 trades → 247 rows, 229 signal-equity /
  18 excluded, 220 stamped `ind.*`, 19 closed / 226 open, 220 `strength.*`
  populated, excursion sane on every closed row.
- `functions` `tsc --noEmit`: clean.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| One row per trade; count parity | 1 |
| Cohort flag-not-drop; ind.\*/strength.\* | 2, 3, 10 |
| Ledger-observed lifecycle | 4, 5 |
| Direction-aware ret / neutral symbolMove | 6 |
| Marks excursion + giveback + source tag | 7 |
| Open provisional / unfilled row | 5 |
| Intersection scope filters | 8 |
| Task routing, replay fail-loud, guards | 9 |
| Per-symbol bar load, per-symbol\|date strength memo | 10 (timing + code) |
| Relay green + indexed | 10 |
| Regression | 11 |

## Refinement pass

Not applicable — no user-facing surface (task + pass + mapper only).
The FE consumers arrive in #1081–#1085.
