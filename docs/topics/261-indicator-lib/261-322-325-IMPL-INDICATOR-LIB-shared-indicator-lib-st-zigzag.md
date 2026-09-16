**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #325  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# SHARED Implementation Plan: ST ZigZag Pine Export

## Overview

A standalone Pine v6 script ported from the TradingView official ZigZag
library v9 (MPL 2.0, 2026.02.25). Near-direct copy with one structural
change: the single `depth` parameter is split into `leftDepth` and
`rightDepth` to support asymmetric pivot confirmation.

## Module

### Pine Export — `rb-st-zigzag.pine`

**Location:** `rb-ps/rb-ta/ind/rb-st-zigzag.pine`

**Source:** Ported from `docs/topics/261-indicator-lib/reference/zigzag-lib-source.pine` (verified byte-for-byte against TradingView published source).

**License:** Mozilla Public License 2.0 (preserved from source). Attribution: TradingView.

**Changes from source:**

1. **`depth` → `leftDepth` + `rightDepth`** — the source's single `depth` input (halved internally via `math.max(2, math.floor(depth / 2))`) is replaced with two separate inputs. `findPivotPoint` uses `leftDepth` for the left-side loop and `rightDepth` for the right-side loop. The internal halving is removed — the user provides per-side depths directly.

2. **Indicator declaration** — adapted from library (`library`) to standalone indicator (`indicator`) with the appropriate `overlay = true` and input declarations.

**What stays the same:**

- `Settings` type and all display settings (`lineColor`, `displayReversalPrice`, `displayCumulativeVolume`, `displayReversalPriceChange`, `differencePriceMode`, `draw`, `allowZigZagOnOneBar`, `projectionPivots`)
- `Pivot` type (`line`, `label`, `isHigh`, `vol`, `start`, `end`)
- `ZigZag` type (`settings`, `pivots`, `cumulative volume`, `projection pivot`)
- `findPivotPoint` — adapted for asymmetric depths
- `calcDev` — unchanged
- `priceRotationDiff` — unchanged
- `findProjectionPivot` — unchanged
- `updateProjectionPivot` — unchanged
- `newPivotPointFound` — unchanged
- `lastPivot` — unchanged
- `update` — unchanged (calls `findPivotPoint` which is the only modified function)
- `newInstance` — unchanged
- All label rendering logic — unchanged
- All line drawing logic — unchanged

## Phases

Single phase — the Pine export is one self-contained file.

- Task: Port ZigZag library to standalone Pine with `leftDepth`/`rightDepth` split, MPL 2.0 attribution, and indicator declaration

## Cross-Area Dependencies

None. The Pine export is independent of the FE implementation.

## Risks

- **Pine v6 syntax changes** — the source is v6; verify the standalone `indicator()` declaration syntax matches current Pine v6.
- **Asymmetric depth in `findPivotPoint`** — the left loop bounds change from `depth+1` to `2*depth` to `rightDepth+1` to `rightDepth+leftDepth`. Verify the loop logic is correct for asymmetric cases.
- **Manual verification only** — no automated test. Verify against TradingView charts with matching parameters (both symmetric and asymmetric depths).
