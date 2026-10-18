**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1105  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1078  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete — QA PASS  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1078 `analysisDatasetTask` replay path

## Scope

Task #1078 acceptance criteria (issue body + BE IMPL §3):

1. Per symbol in scope: SDS daily bars → `computeStTrendBands` →
   `computeStZone`/`computeStZoneV2` → `detectAllStTrendRiderSignals` →
   filter to `signalTypes` ∩ `barRange` → walk each signal on daily closes
   under the exit-registry grammar → one `TradeAnalysisRow` per signal.
2. The walk uses the registry (`evaluateVariant`) — no reimplemented
   exit logic.
3. AMAT with defaults reproduces the validated prototype (~99 trades /
   98 closed / ~32.7% profitable / payoff ~1.30).
4. Symbol missing SDS bars → logged + skipped; run still completes.
5. Modeled rows: `source 'replay'`, `excursionSource 'replay'`,
   `analysisCohort 'signal-equity'`, stamped `ind.*` from the detector,
   `strength.*` at the signal index, direction-aware `tradeRetPct`.
6. Task routes `origin 'replay'` → the pass; `live` unchanged.

## Prerequisites

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"

# unit evidence (tsx — extensionless TS imports; raw node --test does not resolve them)
npx tsx --test tests/functions/paper-trading/replay-pass.test.ts tests/functions/paper-trading/live-snapshot-pass.test.ts

# real-prod parity evidence (read-only dry-run; lives in .devin/tmp until
# #1079 formalizes the indexed relay)
npx tsx .devin/tmp/replay-amat-parity.ts
```

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Registry-only walk | Spy spec on `evaluateExit` + wiring spec | `replayDeps()` wires the real `evaluateVariant`; trailing/time/initial-stop all fire via the registry | **PASS** — 3 variants spec'd through the real evaluator |
| 2 | AMAT prototype parity | Real-prod dry-run on the prototype's 2023+ bar window | ~99 trades / 98 closed / ~32.7% / payoff ~1.30 | **PASS — exact**: 99/98/32.7%/1.30, zero signal-set diff both directions |
| 3 | Full-history baseline | Same dry-run without the window slice | More signals (SDS now holds 8 year-shards back to 2019); zones causal so full-history is production-faithful | **PASS** — 194/193/35.8%/1.30 recorded as baseline |
| 4 | Missing bars | Spec: `NOBARS` returns empty | warn + skip, run completes | **PASS** |
| 5 | Modeled row shape | Mapper specs | source/cohort/excursionSource tagged, null ledger provenance, ind.* verbatim, strength.* at index | **PASS** |
| 6 | Direction-aware math | Short-signal spec | falling price → positive ret; mfe off lows, mae off highs | **PASS** |
| 7 | Open/unfired trades | Flat-bars spec | OPEN, null exits, provisional ret vs last close | **PASS** |
| 8 | Excursion convention | Never-favorable spec | negative `mfePct` (least-bad) — matches live marks semantics | **PASS** — review finding, now pinned |
| 9 | Scope filters | Pass specs | signalTypes ∩ barRange (`from` post-detection, `to` bounds data+walk) | **PASS** |
| 10 | Empty scope → universe | Spec | `listSymbols` enumerates `symbol-data` | **PASS** — full-universe cost is a documented limitation |
| 11 | Task routing | Handler inspection | both origins dispatch; `failed`-transition + datasetId guard intact | **PASS** |
| 12 | Regression | tsx suites + tsc | Live path unchanged, suite green | **PASS** — 23/23 task-surface specs, 311/311 paper-trading fn suite, tsc clean |

## Automated evidence

- `tests/functions/paper-trading/replay-pass.test.ts`: **11/11**
  (trailing/initial/time exits via real registry, short direction, open
  provisional, negative-mfe convention, scope filters, no-bars skip,
  empty-scope universe, detect/evaluate seam spies, prod wiring pin).
- #1077 regression re-run: **12/12** live-snapshot specs green.
- Real-prod AMAT parity (read-only): **exact** on the prototype window;
  full-history baseline documented.
- `functions` `tsc --noEmit`: clean.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Registry walk, no reimpl | 1 |
| AMAT parity | 2, 3 |
| Missing bars → skip | 4 |
| Modeled row contract | 5, 6, 7, 8 |
| Scope filters | 9, 10 |
| Task routing + guards | 11 |
| Regression | 12 |

## Refinement pass

Not applicable — no user-facing surface (BE task pipeline only).
The FE consumers arrive in #1081–#1085.
