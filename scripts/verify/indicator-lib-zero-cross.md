# Verification Guide — Indicator Lib Zero Cross Detection (Task #319)

## Scripts

### `indicator-lib-zero-cross-detection.ts`

Verifies `detectAllZoneZeroCrossSignals()` detects zone sign flips correctly.

**Usage:**
```bash
npx tsx scripts/verify/indicator-lib-zero-cross-detection.ts
```

**What it checks:**
- Basic bullish cross ([-1, +1] → LONG)
- Basic bearish cross ([+1, -1] → SHORT)
- Jumps over zero ([-3, +2] → LONG)
- Zero is neutral ([-1, 0, +1] → no signal)
- NaN breaks sequence ([-1, NaN, +1] → no signal)
- Multiple crosses ([-1, +1, -1, +1] → 3 signals)
- V2 version signalType
- Weekly timeframe prefix
- Reason text content
- Cross after gap recovers ([-1, NaN, -1, +1] → LONG at index 3)

**Passing output:** `=== Results: 22 passed, 0 failed ===`

**Failing output:** Any check marked `✗` and non-zero exit code.
