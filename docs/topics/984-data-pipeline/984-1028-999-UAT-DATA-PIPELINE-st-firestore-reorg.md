**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1028  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #999  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# UAT — SHARED-IMPL: st- ID builders + mapping helpers (#999)

## Scope

Canonical st- doc-id builders and legacy→canonical migration mappers:

- `shared/st-ids.ts` (`@st/ids` alias) — `stSignalOccurrenceId`
  (`{SYM}_{barDate}_{signalType}`), `stTicketId` (`{liv|pap}_{id}`),
  `stTradeId` (`{SYM}-{YYMMDD}-{origin}-{expr}[-{exp}-{strike}]-{NN}`),
  `stPositionGroupId` (`{SYM}-{YYMMDD}-grp-{NN}`),
  `ORIGIN_TYPE_TO_TRADE_CODE` (sig/prg/man/mgmt), `formatYYMMDD` reused
- `shared/st-order-tickets.ts` — `mapOrderSourceToOriginType`
  (`signal_pipeline`→signal, `position_management`→management, unknown→null)
  + `mapLegacyTicketStatus` (`'paper'`→`{mode:'paper',state:'submitted'}`)
- `shared/st-signals.ts` — `stSignalStatusFromBarStatus` (barStatus 1 →
  CONFIRMED else INTERIM)
- `functions/src/st-cloud-function/signal-persister.ts` — delegates to
  `stSignalStatusFromBarStatus` (IMPL: reuse, don't duplicate)
- `@st/ids` wired in root `tsconfig.json`, `functions/tsconfig.json`,
  `jest.config.js`
- `scripts/verify/data-pipeline-st-ids-999.{ts,md}` + run-all/README
  registration

Guard contract (review-loop hardening): `barDate` must match `YYYY-MM-DD`
(defeats the `signalDedupeKey` arg-order trap); `exp` is 6-or-8 digits,
`strike`/`exp` dash-free; `expr`/`symbol` uppercase; `/` rejected in every
segment (Firestore-illegal); `_` rejected in `symbol` for the underscore
layout; `seq` must be a positive safe integer; invalid `Date` throws;
unknown origin (incl. `'toString'`) throws via `Object.hasOwn` guard;
seq-allocation contract documented (transaction/`create()`).

Acceptance criteria (from #999 + IMPL §3/§4): the four builders exist with
the specified layouts; `source`→`origin.type` and `status:'paper'`→
`mode:'paper'` mappings exist; unit tests cover NN rollover and
equity-omits-contract; pure/shared/testable; `signal-persister` delegates
rather than duplicating the barStatus rule.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, node_modules installed, `npx` available.
- No credentials, Firestore access, or running services needed — all checks
  are pure builders/mappers, jest specs, and build compilation.

## Scenarios

### S1 — Builder/mapper spec suite

**Confirms:** every id layout, NN padding/rollover, equity contract
omission, guard rejections (arg-swap, `/`, `_`, non-digit exp, bad seq,
invalid Date, poison-key origin), both mappers, barStatus mapping.

```
npx jest shared/st-ids.spec.ts shared/st-order-tickets.spec.ts \
  shared/st-signals.spec.ts --coverage=false
```

**Expected:** 3 suites pass, 46/46 tests.

**Result:** PASS — 3 suites, 46/46 tests.

### S2 — Offline verification script

**Confirms:** end-to-end asserts on the real modules — layouts, origin
codes, mappers, every guard class.

```
npx tsx scripts/verify/data-pipeline-st-ids-999.ts
```

**Expected:** every line prints `OK`, ends `=== ALL CHECKS PASSED ===`,
exit 0.

**Result:** PASS — all checks `OK` incl. `/`, `_`, `NaN`-Date, `1e21`, and
non-digit-`exp` guard pins; `=== ALL CHECKS PASSED ===`, exit 0.

### S3 — jest `moduleNameMapper` alias probe (`@st/ids`)

**Confirms:** the new `@st/ids` alias resolves inside jest (specs import
relatively, so this probes mapper wiring).

Create `shared/alias-probe-999.spec.ts` importing `stTradeId`,
`ORIGIN_TYPE_TO_TRADE_CODE` from `@st/ids`, then:

```
npx jest shared/alias-probe-999.spec.ts --coverage=false
```

Delete the probe afterward.

**Expected:** 1/1 test passes; alias resolves.

**Result:** PASS — probe `shared/alias-probe-999.spec.ts` imported
`stTradeId`, `stSignalOccurrenceId`, `ORIGIN_TYPE_TO_TRADE_CODE` through jest
`moduleNameMapper`; 1/1 test passed; probe deleted.

### S4 — functions bundle build

**Confirms:** BE compiles through `@st/ids`/`@st/signals` aliases and the
`signal-persister.ts` delegation keeps its consumers working.

```
cd functions && npm run build
```

**Expected:** esbuild bundle green (~1.8mb), no TS errors.

**Result:** PASS — esbuild bundle green, `lib/index.js` 1.8mb, no errors.

### S5 — Persister delegation diff

**Confirms:** `signal-persister.ts` no longer contains an inline
`barStatus === 1` check — it delegates to `stSignalStatusFromBarStatus`,
and semantics are identical (old code was `=== 1`, verified in review).

```
grep -n "stSignalStatusFromBarStatus\|barStatus ===" functions/src/st-cloud-function/signal-persister.ts
```

**Expected:** import + call to the shared helper present; no inline
`barStatus === 1` remains.

**Result:** PASS — `signal-persister.ts:15` imports
`stSignalStatusFromBarStatus` from `@st/signals`; `:87` calls it; no inline
`barStatus ===` remains. Old code was `barStatus === 1` (confirmed in the
review pass), so semantics are byte-identical — `-1`/0/undefined → INTERIM
before and after.

### S6 — Verify-script registration

**Confirms:** `data-pipeline-st-ids-999.ts` is registered in the run-all
script and README table so the check runs in the suite.

```
grep -n "st-ids-999" scripts/verify/run-all.ts scripts/verify/README.md
```

**Expected:** one entry in each file.

**Result:** PASS — registered at `run-all.ts:34` ("st- id builders +
mappers", `needsAccount: false`) and `README.md:47` row.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `stSignalOccurrenceId`/`stTicketId`/`stTradeId`/`stPositionGroupId` per IMPL layouts | S1, S2 |
| `source`→`origin.type` + `status:'paper'`→`mode:'paper'` mappings | S1, S2 |
| Unit tests incl. NN rollover + equity-omits-contract | S1 |
| Arg-order trap / `/` / `_` / bad-seq / invalid-Date guards | S1, S2 |
| `@st/ids` alias resolves (FE, BE, jest, tsx) | S2, S3, S4 |
| `signal-persister` delegates, semantics unchanged | S4, S5 |
| Verify script delivered + registered | S2, S6 |

## Regression / smoke

- Shared/core sweep — **PASS** — 715/716; sole failure is the pre-existing
  unrelated `shared/screenshot-capture-contracts.spec.ts` PositionType
  expectation.
- Functions-tree spec sweep — **PASS** — 177/177 (persister consumers green).

## Refinement pass

Not applicable — no user-facing surface (shared builders/mappers + build
wiring only).

## Findings

None — all six scenarios pass; no new issues discovered. Documented #1003
duties carried forward (not findings): rebuild `origin.signalId` via
`stSignalOccurrenceId` rather than passing `signalDedupeKey` values through;
settle migrated `paper`-status tickets to a terminal state; pick the
`exp` convention (6 vs 8 digits) and the `expr` convention (template key
vs expression code); decide how dash-bearing symbols are represented in the
dashed layouts.
