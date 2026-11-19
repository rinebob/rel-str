# Verify — #1500 Analyzer: position net series + records

| | |
|---|---|
| **Script** | `functions/scripts/verify/options-analysis-position-1500.ts` |
| **Run** | `cd functions && npx tsx scripts/verify/options-analysis-position-1500.ts [--live]` |
| **Scope** | `runReplayAnalysis` — the `optionsReplayAnalysis` task worker's position-level path (#1500) |
| **Stages** | DRY (default): `AnalysisWorkerDeps` fakes through the real narrowing + net-series + record code, no credentials — run-all safe. LIVE (`--live`): real Firestore + real SA series fetch — needs ADC + `GOOGLE_CLOUD_PROJECT=rel-str` + IPv4 preload |

## What it verifies

### DRY — 25 checks (fake deps, real production code)

- **2-leg credit spread** — one fetch per option leg; one result doc per registered exit; `expired` at the last expiry; `entryMark` = short − long net; `contractId` = joined leg ids; net entryDelta; `target-90` fires on the net series.
- **v1→v2 narrowing parity** — a legacy v1 list doc and the equivalent 1-leg v2 doc produce byte-identical trade arrays on every exit doc.
- **Calendar spread** — `dte-21` fires against the NEAREST living leg (exit 21 days before the short leg's expiry, not the position's last); the expired leg freezes at intrinsic settlement while the living leg carries the position to the last expiry; `expired` fields = signed net intrinsic (short 5 − long 0 = 5), `expiredItm` on net liability, excursion spans the frozen window.
- **Stock leg** — covered call: the stock leg is never fetched; marks come from `underlyingClose`; `entryIv` absent (stock carries none); net intrinsic = call intrinsic − stock close.
- **Leg-series failure** — `error` record under every exit id naming the leg index; real entryMark still recorded; docs stay `success`.
- **Mixed rows** — `no-selection` rows contribute no record; a missing underlying close at an early leg's expiry → `error` (settlement is never fabricated).

### LIVE — 10 checks (real Firestore + real SA endpoint)

Reads the newest `verify-1499-*` multi-leg list doc (real SPY position rows from the #1499 live stage), writes a truncated copy (`verify-1500-{ts}` — 3 position rows), then invokes `runReplayAnalysis` with `prodAnalysisDeps` — real `callPartnerHistoricalOptionsContractV2` per option leg (6 fetches), real `getCachedBarsFromSymbolData` close map, real `st-options-analysis-results/{docId}_{exitId}` writes.

Asserted: 6 result docs all `success`, `contractCount` = seeded positions, every trade a real outcome (`open`/`exit` observed on live data), net `entryMark` matches the signed leg marks, joined `contractId` carries both legs.

Evidence docs are left in place — `st-options-analysis-results/verify-1500-*_{exitId}` is greppable.

## Result history

| Date | Stage | Result |
|---|---|---|
| 2026-11-18 | DRY | 25/25 pass |
| 2026-11-18 | LIVE | 10/10 pass — `verify-1500-1795021535308` (source: `verify-1499-1795014547301-inline-custom-legs-succe`, 2-leg custom legs) |
| 2026-11-18 | DRY | 26/26 pass — post-review (posture-flip cov assertions, dedup) |
| 2026-11-18 | LIVE | 10/10 pass — `verify-1500-1795046074614`, outcomes open+exit; post-review evidence for QA #1625 |
