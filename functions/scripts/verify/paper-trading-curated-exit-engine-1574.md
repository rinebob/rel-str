# paper-trading-curated-exit-engine-1574

Verify script for **#1574 — BE: Signal-replay exit engine** (Topic #553,
Thread #906).

## What it pins

Static + fixture checks on the curated exit engine — no env, read-only:

- **Grammar** — every `CURATED_VARIANT_KEYS` member parses via
  `parseVariantKey`; `ma-close-{N}` → `{ period }`, `target-{pct}` →
  `{ pct }` fraction; neither is `isTerminalVariantKey` (the seed gate
  keeps them out of `governingVariant` — the mint pin).
- **Evaluators** — `ma-close` fires on the close-cross (long below,
  short above) and never fires without SMA data; `target` fires at
  entry × (1±pct) both directions.
- **`variantLevel`** — trailing rides the watermark including today's
  mark; `ma-close` = today's SMA (undefined without indicators);
  `target` = the fixed target price; time/limit/`none` have no level.
- **`isIndependentCloser`** — `target-*`/`time-*` true; stops/unknown
  false.
- **`selectGoverningRun`** — deepest-below governs (long) / highest-above
  (short); past-entry → `trailing-8` fallback; dead fallback → deepest
  ACTIVE; `target-*` family-excluded even when its level lands on the
  stop side; wrong-side levels excluded; no candidates → `undefined`.
- **`smaAt`** — last-N close mean through the eval date; undefined on
  short history.

## Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-curated-exit-engine-1574.ts
```

- **Args:** none. **Env:** none (pure-function fixtures).
- **Pass:** `All 35 checks passed.` — exit 0.
- **Fail:** named check + got/want — exit 1.

## Notes

This pins the contract *surface* — the behavioral specs live in
`tests/functions/paper-trading/{exit-variants,governing-policy,exit-eval-pass}.test.ts`
(run via `npm run test:paper-trading`).
