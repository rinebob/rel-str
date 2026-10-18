# CODE REVIEW — #1077 analysisDatasetTask live snapshot path  
**Date:** 2026-10-20  
**Reviewer:** Devin  
**Task:** #1077  
**Blueprint:** #1075  
**Topic:** #553  
**Verdict:** PASS  

## Review scope  
- `functions/src/paper-trading/analysis/live-snapshot.ts` (new — `tradeToRow` mapper + `runLiveSnapshot` pass + prod deps seam)  
- `functions/src/paper-trading/analysis/analysis-dataset-task.ts` (live branch wired; replay stays fail-loud; datasetId guard; `maxAttempts: 3`, `1GiB`)  
- `tests/functions/paper-trading/live-snapshot-pass.test.ts` (new — 12 tsx specs)  
- `functions/scripts/verify/paper-trading-analysis-1077-live-snapshot.ts` + `.md` (read-only dry-run relay + guide)  
- `functions/scripts/verify/{README.md,run-all.ts}` index entries  
- IMPL §3 as-builts (signal-bar anchor, per-symbol bar load, cohort rule, marks excursion, `entryFilters` provenance-only, barRange anchor, datasetId guard)  

## Standards  
- Pass is ~190 lines, single seam — filter → map → strength memoize → `writeDataset`; deps-injected, matches the callable's `handleX` + deps pattern.  
- Reuses `listTrades`, `getCachedBarsFromSymbolData`, `computeStTrendStrength`, `datasetWriterDeps`/`writeDataset` — zero reimplementation of ledger, bars, indicators, or the writer.  
- `tradeToRow` is pure (strength injected) — the mapper specs run without any Firestore seam.  
- Repo conventions held: `@paper-trading/*`/`@common` aliases, `logger` structured events, doc-comment header block.  

## Spec  
| AC | Result |  
|---|---|  
| Every trade → exactly one row; row count = index doc | PASS — 247 trades → 247 rows on prod; `rowCount` written by writer = row count |  
| Signal-linked equity rows carry `ind.*`/`strength.*` | PASS — `signalIndicators` verbatim into `ind.*`; `strength.*` = last-index DI/ADX from real bars at the signal bar (220/229 populated; thin-history nulls legitimate) |  
| Excluded cohort flagged, not dropped | PASS — `expression!=='EQ'` or no signal identity → `excluded`, all fields still emitted (18 on prod) |  
| Second same-day snapshot → new dataset, fresh closes | PASS — id versioning shipped in #1076; rows observe marks at invocation |  
| Direction-aware `tradeRetPct` | PASS — short-gain-on-fall spec + direction-neutral `symbolMovePct` |  
| `excursionSource: 'marks'` | PASS — excursion walks marks `[entryDate, exitDate]`, basis `mark ?? underlyingClose` |  
| Scope filters | PASS — symbolScope ∩ signalTypes ∩ barRange (`signalBarDate ??` earliest entry fill) |  
| Task routes live → pass, replay → fail-loud | PASS — handler diff reviewed |  

## Thermo-nuclear  
- Read-only against the ledger and symbol-data; the only writes flow through the already-reviewed `writeDataset`/`failIndex` seams.  
- `datasetId` guard prevents a malformed payload from stamping `failed` on a random doc id.  
- Sequential per-trade awaits with per-symbol bar cache — ~50 symbol loads for the current 247-trade ledger, well inside the 540s budget (relay completed prod-wide in ~2 min).  
- No secrets/PII in logs — datasetId + counts only.  
- `entryConvention`/`entryFilters` are provenance-only on live — correct: live entries are ledger-observed, not modeled.  

## Findings during review  
**Round 1**  
1. Scope-filter barRange anchor used unsorted `find` while the mapper used earliest-by-date — non-date-ordered fills could disagree (keep a trade whose true entry is out of range). Unified on `entryFillOf`.  

**Round 2 (pre-review implement re-pass)**  
2. `barRange` anchored only on `signalBarDate` — undated-signal manual trades leaked any range; now `signalBarDate ?? entryDate`, +1 spec.  
3. Task handler lacked a `datasetId` guard — added before any doc write.  

**Round 3 (review re-run)**  
4. `failIndex(...).catch(() => {})` in the task catch silently swallowed the failed-transition error — the same pattern the #1076 review fixed in the callable; now logs `analysis_dataset_task_failed_transition_failed`, matching the writer's surface-don't-hide rule.  
5. Whitespace `datasetId` (`' '`) slipped the guard as a truthy string and would `.doc()` a junk id — tightened to `typeof !== 'string' || !trim()`.  

Round 4 found nothing new — converged.  

## Verification  
- `tsx --test` live-snapshot spec: **12/12**; paper-trading fn suite: **300/300**  
- `verify-1077` dry-run vs real prod: **7/7** — 247→247 rows, 229 signal-equity/18 excluded, 220 stamped `ind.*`, 19 closed/226 open, excursion sane, sample row eyeballed  
- `functions` tsc: clean  

## Gate  
**PASS** — #1077 → `7_QA`; QA issue opened.
