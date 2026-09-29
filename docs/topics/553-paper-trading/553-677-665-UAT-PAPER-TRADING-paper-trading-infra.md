# UAT — #665 SHARED Trade Exits contracts

**Topic:** Paper Trading Infra
**Topic Slug:** paper-trading-infra
**Issue:** #677
**Task:** #665
**Topic Parent:** #553
**Domain:** PAPER-TRADING
**Type:** UAT
**Status:** Complete
**Created:** 2026-09-28
**Last Updated:** 2026-09-28

## Scope

Contracts-only slice of Thread #652 (Trade Exits): `CANCELLED` status +
stats exclusion, `trailing-8` seeding defaults, `TERMINAL_VARIANT_FAMILIES`,
close/cancel callable request/response contracts, plus the review-round
fixes (`resolveAccountOwner` prefers doc `userId`; #564 verify re-baseline;
signal-order test re-baseline).

## Prerequisites

- Repo checkout with deps installed (`npm i` at root, `cd functions && npm i`)
- No credentials needed — all scenarios are unit/verify-level
- Functions build available (`cd functions && npm run build`)

## Scenarios

### S1 — Contract surface (verify script)

**Run:** `npx tsx scripts/verify/paper-trading-contracts-665.ts`
**Expect:** 8 checks print `OK`, exits 0: `CANCELLED` member, five prior
statuses intact, `trailing-8` defaults, empty shadow keys, only
`trailing-stop` terminal, close/cancel shapes.
**Result:** PASS — output captured below.

### S2 — Shared contract specs (jest)

**Run:** `npx jest shared/paper-trading-contracts.spec.ts --coverage=false`
**Expect:** 10 tests pass incl. `describe('trade exits contracts (#652)')`.
**Result:** PASS — 10/10.

### S3 — Stats-fold exclusion + adapter mapping + eval resolver (node:test)

**Run:** `npx tsx --test "tests/functions/paper-trading/*.test.ts"`
**Expect:** all suites green incl. "excludes CANCELLED trades from every
scope", `CANCELLED→CLOSED` adapter assertion, `resolveAccountOwner` trio,
re-baselined signal-order `variantKeys === ['trailing-8']`.
**Result:** PASS — 106/106.

### S4 — Build sanity (enum exhaustiveness)

**Run:** `cd functions && npm run build`
**Expect:** bundle builds clean (esbuild); `npx tsc --noEmit` shows no new
paper-trading errors (pre-existing `rh-agent-mcp` error only).
**Result:** PASS.

### S5 — Regression sweep

**Run:** `npx jest --coverage=false`
**Expect:** full suite green — `SIGNAL_GOVERNING_VARIANT='trailing-8'` flows
into `paperSignalOrder` seeding; no consumer still expects `none`+shadows.
**Result:** PASS — 2139/2139.

## Traceability

| AC | Scenario |
|---|---|
| `CANCELLED` + stats exclusion | S1, S2, S3 |
| Close/cancel callable contracts | S1, S2 |
| `trailing-8` defaults, no shadows | S1, S2, S3, S5 |
| `TERMINAL_VARIANT_FAMILIES` | S1, S2 |
| Shared specs green | S2, S3, S5 |
| Review fixes (resolveAccountOwner, stale consumers) | S3, S5 |

## Refinement pass

Not applicable — no user-facing surface (contracts + BE consumers only;
CANCELLED display is task #671's acceptance).
