**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1021  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #998  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# UAT — SHARED-IMPL: canonical st- type shapes (#998)

## Scope

Canonical shared type contracts for the st- data plane, delivered as single
sources in `shared/` behind `@st/*` path aliases and consumed identically by
BE (functions) and FE (Angular):

- `shared/st-types.ts` — `StMode` (`'live' | 'paper'`) + `ST_MODES`
- `shared/st-signals.ts` — `StSignal` doc shape, `StSignalStatus` /
  `StSignalTimeframe` value sets, `normalizeStSignalDirection`
  (legacy `'LONG'/'SHORT'` → `TradeSide`)
- `shared/st-order-tickets.ts` — `StOrderTicket` (universal order ticket),
  `terms.symbol` required, option `legs` (RH `optionId`/`occSymbol`/
  `positionEffect`), `orderType`/`timeInForce`/`marketHours`, `taxLots`,
  `expressionTemplate`, `signalContext`/`tracking`/`bucketId`/`terminalAt`
  migration homes, `'failed'` terminal state, `validateStTicketTerms`
- `shared/st-position-groups.ts` — `StPositionGroup` incl. required `userId`
- `shared/st-strategy-instances.ts` — `StStrategyInstance extends
  StrategyInstanceConfig` + `mode`, `paperAccountId?`, `enabled`, `lastFiredAt`
- `shared/paper-trading-contracts.ts` — `PaperTrade` gains `positionGroupId`,
  `strike`/`expiration`/`optionType`; `PAPER_TRADE_WRITABLE_STATUSES` excludes
  `PENDING`; `signalTimeframe`/`signalStatus` typed via canonical st- types
- `functions/src/st-cloud-function/signals.ts` — `StSignalStatus` delegates
  to `@st/signals` (import + re-export)

Acceptance criteria (from #998 + IMPL §2): canonical shapes for signals,
order tickets, position groups, and strategy instances exist; `StStrategyInstance`
carries `mode`; `PaperTrade` carries the lineage/contract extensions; BE and
FE consume structurally identical shapes via `@st/*` aliases; shape specs and
an offline verification script exist and pass. No ID builders or migration
helpers (those are #999+).

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, node_modules installed, `npx` available.
- No credentials, Firestore access, or running services needed — all checks
  are contracts / pure helpers / build compilation.

## Scenarios

### S1 — Shape spec suite

**Confirms:** all canonical value sets, required keys, JSON round-trips,
`normalizeStSignalDirection`, option-leg identity, terms validation.

```
npx jest shared/st-signals.spec.ts shared/st-order-tickets.spec.ts \
  shared/st-position-groups.spec.ts shared/st-strategy-instances.spec.ts \
  shared/paper-trading-contracts.spec.ts --coverage=false
```

**Expected:** 5 suites pass, 41/41 tests.

**Result:** PASS — 5 suites, 41/41 tests (run together with the S3 probe: 42/42).

### S2 — Offline verification script (tsx + `@st/*` aliases)

**Confirms:** every `@st/*` alias resolves under tsx through the real
tsconfig paths; pinned value sets, key sets, direction normalization, option
leg identity, and hardened `validateStTicketTerms` checks execute against the
real modules.

```
npx tsx scripts/verify/data-pipeline-st-types-998.ts
```

**Expected:** every line prints `OK`, ends `=== ALL CHECKS PASSED ===`, exit 0.

**Result:** PASS — 38/38 checks `OK`, `=== ALL CHECKS PASSED ===`, exit 0.

### S3 — jest `moduleNameMapper` alias probe

**Confirms:** the five `@st/*` aliases resolve inside the jest spec tsconfig
(the spec files themselves import relatively, so this probes mapper wiring).

Create `shared/alias-probe-998.spec.ts` importing
`ST_TICKET_STATES` from `@st/order-tickets`, `ST_MODES` from `@st/types`,
`StPositionGroup` type from `@st/position-groups`, then:

```
npx jest shared/alias-probe-998.spec.ts --coverage=false
```

Delete the probe afterward.

**Expected:** 1/1 test passes; aliases resolve.

**Result:** PASS — probe `shared/alias-probe-998.spec.ts` imported all five `@st/*` aliases through jest `moduleNameMapper`; 1/1 test passed; probe deleted.

### S4 — functions bundle build

**Confirms:** BE compiles through `@st/*` aliases and the
`functions/src/st-cloud-function/signals.ts` `StSignalStatus` delegation
(import + re-export) keeps local consumers working.

```
cd functions && npm run build
```

**Expected:** esbuild bundle green (~1.8mb), no TS errors.

**Result:** PASS — esbuild bundle green, `lib/index.js` 1.8mb, no errors.

### S5 — Legacy coexistence / delegation diff

**Confirms:** `signals.ts` still exports `StSignalStatus` (consumers
unbroken) and the only change is delegation; no other legacy file touched.

```
git diff functions/src/st-cloud-function/signals.ts
grep -rn "StSignalStatus" functions/src --include=*.ts | grep -v "st-cloud-function/signals.ts"
```

**Expected:** diff shows import + `export type { StSignalStatus }` delegation;
other files still reference the type and compile (proven by S4).

**Result:** PASS — diff shows only the `import type` + `export type { StSignalStatus }` delegation; consumer `signal-persister.ts:13,90` still imports `StSignalStatus` from the module and compiles under S4.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Canonical StSignal/StOrderTicket/StPositionGroup/StStrategyInstance shapes | S1, S2 |
| StStrategyInstance gains `mode` (+ `enabled`, `paperAccountId`) | S1, S2 |
| PaperTrade: `positionGroupId`, `strike`/`expiration`/`optionType`, writable statuses exclude PENDING | S1, S2 |
| BE/FE structurally identical via `@st/*` aliases | S2, S3, S4 |
| `terms.symbol` + option legs (review-loop contract fixes) | S1, S2 |
| `normalizeStSignalDirection` legacy direction mapping | S1, S2 |
| `validateStTicketTerms` sizing + positive/finite/integer | S1, S2 |
| `StSignalStatus` single-sourced via delegation | S4, S5 |
| Shape specs + offline verify script delivered | S1, S2 |

## Regression / smoke

- Shared/core sweep (`npx jest --coverage=false` on shared+core specs) —
  expect no new failures; known unrelated pre-existing failure:
  `shared/screenshot-capture-contracts.spec.ts` PositionType expectation.

## Refinement pass

Not applicable — no user-facing surface (shared contracts + build wiring only).

## Findings

None — all scenarios pass; no new issues discovered. The sole sweep failure remains the pre-existing unrelated `shared/screenshot-capture-contracts.spec.ts` `PositionType` expectation.
