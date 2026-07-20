# Round 2 Testing — Observation Dashboard Fixes

**Date:** 2026-07-20  
**Scope:** Tests added and updated after the round 2 review of the observation-dashboard changes.

---

## Unit tests — `observation-dashboard.model.spec.ts`

`src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.spec.ts` covers the pure model helpers added or tightened in round 2:

- **`extractNextCursor`** — URL cursor extraction from `result.next` and `result.data.next`/`next_cursor`, nested `data` shapes, non-object inputs, and bare cursor tokens.
- **`extractCursorToken` edge cases** — absolute URLs without a `cursor` parameter now return `undefined`; query-string-like values without `cursor=` also return `undefined`; bare tokens are still returned as-is.
- **`isSymbolField`** — explicit symbol field names (`symbol`, `symbols`, `chain_symbol`, `underlying_symbol`).
- **`normalizeSymbolValue`** — string/array uppercase normalization.
- **`formatResultValue`** — option instrument `display_ticker` and `occ_symbol` enrichment, plus non-option passthrough.
- **`isEmptyValue` and `isPlainObject`** utilities.

Run with:

```text
npx ng test --ts-config=tsconfig.observation-dashboard.spec.json --include=src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.spec.ts --browsers=ChromeHeadless
```

A dedicated `tsconfig.observation-dashboard.spec.json` is used because the root `tsconfig.spec.json` still references the missing Jest setup (`setup-jest.ts`, `@types/jest`). The observation-dashboard specs run under the project's Karma/Jasmine toolchain.

## Redactor tests — `rh-agent-mcp-redactor.test.ts`

`tests/functions/rh-agent-mcp-redactor.test.ts` validates the round 2 redactor changes:

- Safe identifiers (`id`, `chain_id`, `option_id`, `instrument_id`, `url`, `uuid`, `cursor`, `next`) are preserved.
- PII fields (`account_number`, `first_name`, etc.) are masked.
- Sensitive patterns match case-insensitively (`Account_Number`, `Brokerage_Account_ID`).
- Plural `emails` and `phone_numbers` arrays are fully redacted.

Run from the `functions/` directory with:

```text
npx tsx --test ../tests/functions/rh-agent-mcp-redactor.test.ts
```

## Build / type verification

- `npx ng build --configuration development --no-progress`
- `npm --prefix functions run typecheck`

## Test environment note

The root `tsconfig.spec.json` is currently Jest-oriented and not backed by installed dependencies (`jest-preset-angular`, `@types/jest`). The working Angular specs use feature-specific tsconfigs such as `tsconfig.observation-dashboard.spec.json` and `tsconfig.signal-list.spec.json`. Reconciling the root test config is out of scope for this round and is tracked in the round 2 review's Standards findings.
