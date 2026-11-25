**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1727  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1727  
**Domain:** INDICATOR-LIB  
**Type:** DECISION  
**Status:** Approved  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# DECISION: One shared signal engine — detection, zone math, and IBS partition live in `shared/`

## Context

During UAT #1722 (Pine IBS filter) the user observed an unfiltered zero-cross short marker on a full-range bar (IBS = 1.0). Investigation surfaced that the "filter everything" directive could not be honored by the current architecture — three structural gaps:

1. **The BE marker path cannot filter anything.** `generateZoneSignals` (indicator-computation.ts) detects on `IndicatorDataPoint[]` — a derived shape carrying zone/DI/ADX/bands but no OHLC — and fabricates `{open:0, high:0, low:0, close:0}` to satisfy the detector signature. `barIbs` on a zero-range bar returns `undefined` → pass-through → every marker emits.
2. **Detection is duplicated and has already drifted.** `detectAllStTrendRiderSignals` (functions) and `detectZoneUptickDots` (FE) are two bodies implementing the same READY/FIRED state machine; zero-cross exists only BE-side, so the sandbox shows a different signal *set* than D/W surfaces — not just different filtering.
3. **Filtering is per-detector opt-in.** IBS was bolted on as an optional `ibs?` param — every new signal algo could accidentally ship unfiltered.

## Decision (user directive, 2026-11-24)

- **Every signal algorithm must be identical in BE and FE and IBS-filtered.** Vocabulary: "filter", not "gate".
- **No visual divergence between BE output and FE output.** Any difference in the rendered signal/suppression sets is a defect, not a tolerance.
- **Filtering is structural, not opt-in.** Detectors emit filter-agnostic candidates; the only path from candidate to emitted is a shared partition.

## Target architecture

```text
shared/                                  ← ONE canonical engine (pure TS, no deps)
├── st-zone.ts          computeStTrendBands, computeStZone, computeStZoneV2,
│                       computeCategories      (from functions/src/indicators)
├── st-ibs.ts           computeIbs + availability           (already here)
├── st-signal-detect.ts detectZoneUpticks, detectZoneZeroCross, …future algos
│                       → SignalCandidate[]     no filter knowledge at all
├── st-signal-filter.ts partitionByIbs(candidates, bars, tf, ctx)
│                       → { emitted, suppressed }          the ONLY exit to "emit"
└── SignalCandidate     { index, direction, signalType, reason, context }
```

Consumers are ~20-line emitters — the only legitimately per-surface code:

| Surface | Flow | Emit shape |
|---|---|---|
| BE strategy | detect → partition → `.emitted` | `st-signals` records |
| BE indicator-computation | detect → partition → both sets | `dotMarkers {emitted, suppressed}` (ATR y-placement) |
| FE sandbox | detect → partition → both sets | scatter points (ATR placement + colors) |
| FE D/W surfaces | none — renders doc verbatim | ghosts behind `showSuppressedSignals` |
| Pine | hand mirror | plots + ghosts — parity audit script enforces |

### Key mechanics

- **Detectors are filter-agnostic.** Signature returns to pre-IBS form: `(zone, window, bars) → candidates` carrying `index` + `direction`. `partitionByIbs` computes `barIbs(bars[c.index])` itself. A new algo cannot bypass the filter because `emitted` exists only through `partition`.
- **State latch stays inside the uptick detector.** It emits every candidate (READY→FIRED consumed regardless); the partition decides emission. Emission-only suppression preserved — a suppressed uptick cannot double-fire.
- **Zone engines move to `shared/`** — they are pure functions of `OHLCV[]` with zero Angular/Firebase deps; `functions/tsconfig.json` already maps `@st/*` aliases to `shared/`.
- **`dotMarkers` doc shape** gains `{emitted, suppressed}` per family — D/W ghosts and sandbox ghosts render identical sets from the same partition logic.
- **Pine remains the only mirror** (different runtime). The static parity audit (`indicator-lib-1676-pine-parity.ts`) is its contract and is extended per algo.

## Why FE duplication was legitimate — and why it shrinks

FE recompute exists for interactivity: the sandbox repartitions dots live as `ibsThreshold` drags — a BE doc round-trip per tick is impossible. That requirement is satisfied by calling the *same engine locally*, not by maintaining a second body. After the hoist, "same in BE and FE" means one detection engine + one filter + per-surface emitters + Pine under audit.

## Out of scope

- `detectTrendStrengthSignals` operates on `IndicatorDataPoint` (derived shape) and has no FE-local recompute — stays in functions/ unless that changes.
- Zero-cross signal **records**: none exist — the strategy path detects uptick only (deliberate #319 scope: zero-cross was built as the aggressive early-entry *visual*). Whether sign-flips should mint `st-signals` is a separate product decision, not assumed here.

## Task graph

```text
#1665 — Intraday Bar Strength (IBS) [Thread]
├── #1672 — SHARED Blueprint
│   ├── #1727 — hoist engines + partitionByIbs into shared/   ← DO FIRST
│   └── #1724 — Pine zero-cross filter + parity-audit extension
├── #1673 — BE Blueprint
│   ├── #1728 — marker path real OHLC + partition + suppressed dotMarkers
│   └── #1725 — zero-cross partition contract + specs (thin post-1727/1728)
└── #1674 — FE Blueprint
    ├── #1726 — sandbox zero-cross dots via shared engine + ghosts
    └── #1680 — suppressed rendering on all surfaces (sandbox + D/W doc ghosts)
```

Sequencing: **#1727 first** — everything routes through the partition it creates. Then #1728 (the parity cure) in parallel with #1726 + #1724. #1680's D/W leg needs #1728's doc shape; #1725 is a thin verification tail.
