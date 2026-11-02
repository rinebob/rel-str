# Verification Guide — Backtest Analytics Shared Layer (#1367)

Task [#1367](https://github.com/rinebob/rel-str/issues/1367) — SHARED exit
registry + analysis contracts (`shared/options-analysis-registry.ts` and
`shared/options-analysis-contracts.ts`, consumed as
`@options-analysis/registry` / `@options-analysis/contracts` by the BE
analyzer worker and the FE results UI).

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `options-backtest-analytics-1367-registry-contracts.ts` | registry + contracts | Asserts `@options-analysis/*` + `@options-replay/contracts` alias resolution under tsx, `{listDocId}_{exitId}` doc keys composing valid 2-segment Firestore paths for every seed, trade-record outcome-variant conventions (`exit`/`expired`/`error` incl. the entry-day placeholder convention on errors and the PERCENT ×100 unit on `assignmentDistancePct`), result-doc shape (doc key ↔ trades exitId consistency + registryVersion stamp), and task/callable payload shapes. Registry hygiene itself is owned by the jest spec — this script checks only what a spec can't (alias resolution + doc-key composition) |

### Usage

```bash
npx tsx scripts/verify/options-backtest-analytics-1367-registry-contracts.ts
```

No arguments, no environment variables, no Firestore access — the modules are
a pure registry + contracts.

**Pass:** every check prints `OK` and the script ends with
`All checks passed.` (exit 0).

**Fail:** the offending line prints `FAIL` with detail; the script ends with
`N check(s) FAILED` (exit 1).

## Setup / teardown

None — read-only, no side effects.

## Notes

- The registry seed list is **provisional** pending the user's final exit
  list; adding/removing a rule is a constants edit in
  `shared/options-analysis-registry.ts` plus a bump of
  `EXIT_REGISTRY_VERSION`.
- Doc-key validity is verified structurally (no `/` inside the doc id); the
  collection itself lands in #1368 (`st-options-analysis-results` constant +
  rules + indexes) with its own verify script.
