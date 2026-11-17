**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1550  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-17  

# BE TEST — Historical Signal Replay

## E2E User Journeys

- Pick a historical signal → entry fill at signal-bar close, marks per
  bar, governing/independent exits recorded → lands CLOSED (exit fired
  in history) or OPEN (joins nightly management).
- Groom a trade → trade + rq docs + tickets gone; next stats pass omits it.
- Live signal on a SECONDARY symbol → ingested entry carrying the
  curated variant set + policy marker.

## Integration Tests (fake deps, `node:test` + `assert` — the
`tests/functions/` convention; no emulator)

### `backfillSignalTrade`

- Fixture bars + hand-computed walk: entry fill at signal-bar close
  (`SDS_BARS`), `marks[barDate]` per trading day, run states/ratchets.
- Governing fires mid-history → CLOSED + exit fill + governing run
  `EXITED` with `exitEvent`; later bars not walked.
- Never-fires → OPEN at last stored bar; runs remain ACTIVE with
  ratcheted watermarks.
- Shadow fires recorded (`exitEvent` on non-governing runs) without
  closing.
- Deterministic id → second call `deduped`, no second write.
- Missing signal doc / absent bars → per-item error, no writes.
- Ticket emitted (`auto:false`, `idSeed=tradeId`) + `markFilled` on
  success.
- **Consistency pin**: minted outcome == `replaySignalToRow` row for
  the same signal+variant (return + exit reason).

### `selectGoverningRun` + policy hook

- Deepest-below-watermark selection across trailing/ma candidates.
- Deepest stop below entry price → `trailing-8` governs (the exception).
- Short-side mirror (deepest above; above-entry → `trailing-8`).
- `variantLevel` undefined (time/unparsed) never governs.
- Eval pass: policy-marked trades recompute governing per day;
  unmarked trades keep static governing — existing-trades regression.

### New evaluators

- `ma-close-20/50/100` fire on close-cross, both directions; correct
  `variantLevel` (today's smaN); absent indicators → skip, not fire.
- `target-{pct}` fires at threshold (long/short); independent closer —
  closes without governing flag.
- `variantLevel` per family; `parseVariantKey` round-trips new keys.

### Callables

- `generatePaperSignalTrades` — auth first; validation codes; per-item
  error vs call failure; bars cached per symbol; batch bound enforced.
- `deletePaperTrades` — cascade removes trade + rq + ticket docs;
  `notFound` for missing ids; bulk; idempotent re-delete.

### Live ingest

- New captures carry `CURATED_VARIANT_KEYS` + `governingPolicy`.
- PRIMARY+SECONDARY list scope admits a SECONDARY member symbol;
  non-listed skipped; `signalTypes` allowlist unchanged; live-date
  gate unchanged (historical run still skipped).

## Test Seams

- Highest seam: callable core `(request, deps)` — deps fake Firestore
  reads/writes + bars loader + ticket emitter.
- Lower seams: `backfillSignalTrade` walk (fixture bars in, final trade
  state out); `selectGoverningRun`/`variantLevel`/evaluators pure.

## Existing Test Coverage

- `auto-paper-ingest-pass.test.ts` — extend for curated-set dims +
  SECONDARY scope; all existing specs must pass unchanged.
- `exits/registry` specs — existing evaluator behavior pinned; new
  families added alongside.
- Eval-pass specs — governing recompute is additive behind the marker;
  unmarked-trade specs are the regression suite.

## Edge Cases

- Signal bar is the last stored bar → OPEN immediately, one mark.
- Non-trading-day bars absent → marks only on real bar dates.
- SMA window longer than loaded history → `ma-close` skips early days.
- Batch of picks sharing a symbol → one bars load, all mints.
- Governing fire + same-day shadow fire → both `exitEvent`s recorded.
