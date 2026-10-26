# Verify Guide — options-backtest-selection-replay-1275-contracts

Task: #1275 — SHARED Task: Replay contracts (options-replay-contracts.ts)  
Pipeline stage: shared contracts → `@options-replay/contracts` alias resolution + fixture shapes

## Script

`options-backtest-selection-replay-1275-contracts.ts` — no credentials, no
Firestore, no network. Imports the contracts through the real tsconfig alias
and validates every fixture shape the BE mapper and FE table consume:
template/coordinate, SA pick-doc wire shape, `ContractListRow` union (pick +
no-selection marker), run/list doc vocabularies, callable + task payloads.

## Usage

```bash
npx tsx scripts/verify/options-backtest-selection-replay-1275-contracts.ts
```

No arguments, no setup, no teardown.

## Pass

Every check prints `OK` and the script exits 0, ending with
`=== ALL CHECKS PASSED ===` (18 checks).

## Fail

The offending check prints `FAIL` with the actual value and an
`expected:` line; the script exits 1. A failure here means the shared
contract shapes or the `@options-replay/contracts` alias (root
`tsconfig.json`, `functions/tsconfig.json`, `jest.config.js`
`moduleNameMapper`) has drifted.
