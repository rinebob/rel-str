# Verify guide — #878 Pine export cleanup + parity audit

## Script

`indicator-lib-878-pine-parity.ts` — static audit of
`rb-ps/rb-ta/ind/rb-st-trigger-bands.pine`. Pine has no local compiler
(TradingView-only runtime), so this pins what is mechanically checkable:
the #878 cleanup and the engine-parity contract. The manual
TradingView-vs-web comparison is the separate UAT leg.

## Usage

```powershell
cd functions
npx tsx scripts/verify/indicator-lib-878-pine-parity.ts
```

No arguments, no env, read-only, ~instant. Run from `functions/`.

## Passing result

28 `PASS` lines, summary `28 PASS / 0 FAIL`, exit code 0.

## Failing result

A `FAIL` line names the violated check. Two fix paths:

- **Cleanup regression** (rbLib import, offsets, midpoint, retrace,
  constant-value markers, `log.*` reappearing) — remove the cruft from
  the `.pine` file.
- **Contract drift** (warm-up, v6 boolean flags, expansion latch, band
  precondition, crossover/crossunder, breakout-only dots, `band ∓
  1.5*ATR` anchor, statement ordering breakout→latch→state) — either
  fix the `.pine` file to match
  `functions/src/indicators/st-trigger-bands.ts` +
  `functions/src/st-cloud-function/indicator-computation.ts`, or, if the
  engine contract intentionally changed, update this audit's patterns
  in the same commit.

Comments are stripped quote-aware (whole-line AND trailing `//`) before
the forbidden checks (commented cruft doesn't fail) — but required
expressions must be live code, not comments. Remaining known holes:
required patterns could still be satisfied inside a string literal or
unreachable `if` block — the audit pins structure, not semantics.

## Known Pine divergences (documented in the .pine header, not audited)

- `ta.atr(14)` is `na` through index 12 (first valid ATR at index 13,
  the 14th bar); the engine seeds `atr[0..13]` with the hindsight
  `mean(tr[0..13])`. A breakout before bar 13 draws a dot on the web
  app and none in Pine — a structural lookahead gap, not fixable
  without repaint.
- v6 note: `nz()` has no bool overload in Pine v6 (bools can't be `na`)
  — comparisons and `ta.crossover/crossunder` on `na` history already
  yield `false`, matching the engine's null-comparison semantics. The
  audit forbids `nz(` entirely for this file.
- `length` input is mutable; parity holds at the default `3`.
- Realtime-bar values repaint intrabar; the engine sees closed bars.
- The TradingView manual compile + visual compare is the remaining UAT
  leg — the audit cannot compile Pine or verify runtime/rendering behavior.
  Boolean `nz()` calls were removed for v6; they are not a pending
  overload-compatibility check.
