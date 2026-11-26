# #1728 — Marker-path IBS partition verification

Verifies #1728 on **real** stored bars: the chart-marker path
(`computeSymbolIndicatorSeries` → `generateZoneSignals`) partitions zone
signal candidates by **real bar IBS** through the shared `partitionByIbs`
— not the zero-filled OHLC stub the pre-#1728 code used, which made every
candidate pass through unfiltered.

## Script

`indicator-marker-path-ibs-1728.ts` — pipeline stage: signal detection →
IBS partition → dotMarkers doc shape (strategy-path parity, uptick +
zero-cross merged candidates).

### Usage

```powershell
cd functions
npx tsx scripts/verify/indicator-marker-path-ibs-1728.ts [--symbol=SPY] [--now=ISO-date]
```

| Flag | Values | Meaning |
|---|---|---|
| `--symbol` | ticker, 1–12 chars `[A-Z0-9.-]` | Symbol whose `symbol-data` doc supplies the bars. Default `SPY`. |
| `--now` | parseable ISO date | Pins the IBS availability clock (`IbsFilterContext.now`) for deterministic runs; default = wall clock (production semantics). |

### Pass result

Per interval (D, W) × version (V1, V2) — 7 `OK` lines each:

- `dotMarkers.zoneV*` is `{ emitted: [], suppressed: [] }` arrays
- `signals.zoneV*` index set == `emitted` index set (suppressed are never "signals")
- emitted `(index|signalType)` set == strategy-path emitted set on the same
  bars — recomputed via `detectAllStTrendRiderSignals` +
  `detectAllZoneZeroCrossSignals` with the same filter context (the
  spec-pinned parity contract)
- every suppressed marker carries a **finite** `ibs` that violated its
  direction bound — suppression is always a real filter decision
- emitted markers with finite `ibs` satisfy their bound (undefined-ibs
  pass-through is legal, never suppressed)
- emitted markers carry **real** ibs — not the uniform `0.5`/`null`
  signature the old zero-OHLC stub would leave
- `marker.d === bars[marker.index].d` (index alignment)

Then `=== N passed, 0 failed ===`, exit 0. The suppression-% table is
informational — expect roughly 20–35% per cell on liquid symbols (QQQ:
~30% D, ~24–30% W), consistent with the Pine artifact's filter and the
#1678 filter script.

### Fail result

`FAIL` lines name the cell and print both index sets (or counts); exit 1.

### Setup / teardown

Read-only. Needs ADC/Firestore env like the other live scripts; reads
`symbol-data/{symbol}` via `getCachedBarsFromSymbolData`. No test data to
create or clean up.
