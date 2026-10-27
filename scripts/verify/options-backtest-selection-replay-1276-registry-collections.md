# Verify Guide — options-backtest-selection-replay-1276-registry-collections

Task: #1276 — SHARED Task: Template registry + collections/rules/indexes (absorbs #1277)  
Pipeline stage: shared registry + collection constants → `@options-replay/templates` + `@st/collections` alias resolution under tsx

## Script

`options-backtest-selection-replay-1276-registry-collections.ts` — no
credentials, no Firestore, no network. Imports the registry and collection
constants through the real tsconfig aliases (the path FE and BE consume) and
runs smoke checks against representative values.

Registry hygiene, rules coverage, and the `(runId, symbol)` composite index are
verified by the test suites, which run the same assertions for real:

- `npx jest shared/options-replay-templates.spec.ts shared/st-collections.spec.ts`
- `cd functions && npm run test:st-rules-indexes`

## Usage

```powershell
npx tsx scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts
```

## Pass / fail

Every check prints `OK`/`FAIL`; a passing run ends with
`=== ALL CHECKS PASSED ===` and exit code 0.
