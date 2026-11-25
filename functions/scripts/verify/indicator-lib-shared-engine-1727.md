# #1727 — Shared signal-engine hoist verification

Verifies the #1727 hoist on **real** stored bars: the shared engine
(`shared/st-signal-detect.ts` + `shared/st-signal-filter.ts`) must produce
identical emitted/suppressed sets through the BE emit wrappers and through
the raw detector + partition path the FE emitter uses.

## Script

`indicator-lib-shared-engine-1727.ts` — pipeline stage: signal detection →
IBS partition → emit (strategy/marker-path equivalence, uptick + zero-cross).

### Usage

```powershell
cd functions
npx tsx scripts/verify/indicator-lib-shared-engine-1727.ts [--symbol=SPY] [--now=ISO-date]
```

| Flag | Values | Meaning |
|---|---|---|
| `--symbol` | ticker, 1–12 chars `[A-Z0-9.-]` | Symbol whose `symbol-data` doc supplies the bars. Default `SPY`. |
| `--now` | parseable ISO date | Pins the IBS availability clock (`IbsFilterContext.now`) for deterministic runs; default = wall clock (production semantics). |

### Pass result

For each timeframe (D, W) × version (V1, V2) × family (uptick, zero-cross),
five `OK` lines:

- emitted `(index|direction)` sets identical — BE emitter ≡ raw detector + partition
- `emitted ∪ suppressed == candidates` (partition completeness)
- `emitted ∩ suppressed == ∅`
- raw candidates carry no `ibs` (detector is filter-agnostic)
- emitted `ZoneSignal.indicators.ibs` == partition-attached `ibs` (no emit-time drift)

Then `=== N passed, 0 failed ===`, exit 0.

### Fail result

`FAIL` lines name the cell and print both index sets (or counts); exit 1.
Weekly cells skip (informational line) if the symbol has < 45 stored weekly
bars — same as production's `minBarsRequired`.

### Setup / teardown

Read-only. Needs ADC/Firestore env like the other live scripts; reads
`symbol-data/{symbol}` via `getCachedBarsFromSymbolData`. No test data to
create or clean up.
