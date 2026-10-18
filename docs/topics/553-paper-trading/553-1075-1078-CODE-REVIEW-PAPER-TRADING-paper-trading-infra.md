# CODE REVIEW — #1078 analysisDatasetTask replay path  
**Date:** 2026-10-20  
**Reviewer:** Devin  
**Task:** #1078  
**Blueprint:** #1075  
**Topic:** #553  
**Verdict:** PASS  

## Review scope  
- `functions/src/paper-trading/analysis/replay.ts` (new — `replaySignalToRow` modeled mapper + `runReplay` pass + `replayDeps` prod seam)  
- `functions/src/paper-trading/analysis/analysis-dataset-task.ts` (replay branch wired — single dispatch for both origins)  
- `tests/functions/paper-trading/replay-pass.test.ts` (new — 11 tsx specs)  
- IMPL §3 as-builts: asymmetric barRange, warmup semantics, injected seams, h/l excursion, calendar days, live-formula giveback, synthetic tradeId, empty-scope limitation, no hold cap  

## Standards  
- Mirrors the live-snapshot seam: pure-ish row builder + deps-injected pass + `replayDeps()` lazy prod wiring. Detector/evaluator injected so specs prove the seams (TEST doc requirement); a wiring spec pins `replayDeps().detectSignals === detectAllStTrendRiderSignals` and `evaluateExit === evaluateVariant`.  
- Reuses the registry (`evaluateVariant`), indicator libs, SDS loader, and `writeDataset` — zero reimplementation. The synthesized `PaperTrade`/`VariantRun` shells satisfy the evaluator's reads (`fills[entry].price`, `order.side`, `run.workingState` ratchet).  
- Repo conventions held: `@paper-trading/*`/`@common` aliases, structured `logger` events, header doc-block.  

## Spec  
| AC | Result |  
|---|---|  
| Replay uses the registry — no reimplemented exit logic | PASS — `evaluateVariant` is the only evaluator; wiring spec + spy spec pin it |  
| AMAT with defaults reproduces the validated prototype | PASS (qualified) — replaying the prototype's 2023+ bar window reproduces it **exactly** (99/98/32.7%/1.30, zero signal-set diff). Full SDS history yields 194/193/35.8%/1.30 — the prototype's drift was its 2023-slice warmup artifact; zones verified causal, so full-history is production-faithful |  
| Symbol missing SDS bars → logged + skipped, run completes | PASS — `analysis_replay_no_bars` warn + continue, spec'd |  
| Detection parity — same zone inputs as production | PASS — `detectAllStTrendRiderSignals` only: the production strategy (`st-trend-rider.strategy.ts`) uses `detectLastBarSignals` → the confirmation machine; `detectAllZoneZeroCrossSignals` produces chart markers only (`generateZoneSignals`), never ledger signals. Zero-cross excluded correctly. `windowV2 = own zone` matches `generateZoneSignals` |  
| barRange semantics | PASS — `to` slices bars pre-compute and bounds the walk; `from` filters signals post-detection so warmup stays production-faithful (as-built recorded) |  
| Scope filters | PASS — symbolScope (empty → SDS universe enumeration) ∩ signalTypes ∩ barRange |  

## Thermo-nuclear  
- Read-only against SDS + write path flows through the already-reviewed `writeDataset`/`failIndex` seams.  
- Malformed `datasetId`/`params` guards unchanged from #1077.  
- Empty-scope full-universe replay is the one scale risk (sequential per-symbol full-history loads vs the 540s budget) — documented in IMPL as a known limitation rather than prematurely batched.  
- No secrets/PII in logs — datasetId + counts only.  
- `entryFilters` provenance-only, consistent with live.  

## Findings during review  
**Round 1**  
1. `mfeFrac`/`maeFrac` seeded at 0 → `mfePct`/`maePct` could never be negative, diverging from the live path's marks convention (least-bad observation can be below entry). Now seeded on the first walk bar — negative `mfePct` is representable; +1 spec pins it.  

## Verified  
- `tsx --test` replay specs: **11/11**; paper-trading fn suite: **311/311**  
- Zone-causality probe: 0 diffs dropping the last 10 bars  
- AMAT parity run vs real prod SDS data: exact prototype reproduction on its window; full-history numbers recorded as the production baseline  
- `functions` tsc: clean  

## Gate  
**PASS** — #1078 → `7_QA`; QA issue opened.  

## Note for #1079  
The formal AMAT parity relay should encode both checks: (a) prototype-window replay == 99/98/32.7%/1.30 exactly; (b) full-history baseline currently 194/193/35.8%/1.30 (will drift as new bars land — tolerance or re-baseline needed).  
