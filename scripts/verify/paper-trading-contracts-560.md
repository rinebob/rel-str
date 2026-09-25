# Verification Guide — Paper Trading Contracts (#560)

Task [#560](https://github.com/rinebob/rel-str/issues/560) — SHARED contracts:
record types, `paper-trading` collection-path helpers, and human-readable ID
builders (`shared/paper-trading-contracts.ts`, `shared/paper-trading-ids.ts`).

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `paper-trading-contracts-560-ids.ts` | ids + paths | Exercises every ID builder, collection/doc path helper (segment parity), `parseTradeId` round-trip, and a kind-guard discrimination check — all through the `@paper-trading/*` and `@common`/`@options` tsconfig aliases, so a passing run also proves alias resolution |

### Usage

```bash
npx tsx scripts/verify/paper-trading-contracts-560-ids.ts
```

No arguments, no environment variables, no Firestore access — the contracts
are pure functions and types.

**Pass:** every check prints `OK` and the script ends with
`=== ALL CHECKS PASSED ===` (exit 0).

**Fail:** the offending line prints `FAIL` with the expected value; the
script ends with `=== N CHECK(S) FAILED ===` (exit 1).

## Setup / teardown

None — read-only, no side effects.
