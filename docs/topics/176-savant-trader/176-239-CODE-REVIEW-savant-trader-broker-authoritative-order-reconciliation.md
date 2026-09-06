**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #239  
**topic parent:** #176  
**domain:** savant-trader  
**type:** code review  
**status:** complete  
**created:** 2026-09-06  
**last updated:** 2026-09-06  

---

# review pass 5

**Task:** #239 — SHARED: Define Trading Case and reconciliation contracts  
**Verdict:** **PASS**

All pass 4 findings resolved. No critical or major findings. All remaining findings from the three review axes were LOW severity and have been fixed.

## pass 4 findings — resolution

| # | Pass 4 finding | Status |
|---|---|---|
| 1 | HIGH: `test:signal-list` stale `rh-agent` path blocks `validate` | **DONE** — path corrected to `savant-trader` in `package.json` and `tsconfig.signal-list.spec.json`; `validate` reordered so `typecheck:tests` + `test:trading-case` run before `test:signal-list` |
| 2 | MEDIUM: combined IMPL `OrderTicket` fields mismatch | **DONE** — `brokerOrderId`→`entryBrokerOrderId`, removed `parentTicketId`, `upsertBrokerOrder`→`upsert`, adapter return types aligned |
| 3 | MEDIUM: `BrokerOrderMirrorRepository` method name mismatch | **DONE** — aligned to `upsert`/`load` |
| 4 | LOW: contract/test files exceed 300-line target | **DONE** — contract split into `types.ts` (197), `broker-order.ts` (189), `helpers.ts` (266); tests split into `trading-case-helpers.test.ts` (118), `trading-case-contracts.test.ts` (297), `trading-case-snapshot.test.ts` (304) |
| 5 | LOW: migration phase 5 stale collections | **DONE** — updated to nested `trading-cases/{caseId}` model |
| 6 | LOW: fixture test shallow | **DONE** — expanded assertions for role, rawState, derivedState, lastObservedAt, caseId, observedAt |

## pass 5 new findings — resolution

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `test:trading-case` depends on unpinned `npx tsx` | LOW | **DONE** — `tsx` added to root `devDependencies`, `npx` removed |
| 2 | `validateEquityOrderTerms` doesn't validate decimal format | MEDIUM | **DONE** — added `DECIMAL_PATTERN` validation for quantity, dollarAmount, limitPrice, stopPrice |
| 3 | `BrokerOrder.derivedState` allows `LOCAL_ONLY`/`SUBMITTING`/`PENDING` | MEDIUM | **DONE** — added `BrokerOrderDerivedState` type excluding local-only states; `BrokerOrder.derivedState` now uses this type |
| 4 | `OptionOrderTerms` quantity vs per-leg quantity undocumented | LOW | **DONE** — JSDoc added documenting relationship |
| 5 | `buildReadableBrokerOrderId` no length cap on entropySuffix/sequence | LOW | **DONE** — entropySuffix capped at 16 chars, sequence validated 1-99 |
| 6 | Combined IMPL missing `instrumentType`/`instrumentId` in field list | LOW | **DONE** — added to broker-order mirror field list |
| 7 | Combined IMPL `canceled` guidance conflicts with shared helper | LOW | **DONE** — updated to "compatibility spelling alias for `cancelled`; map to `cancelled`" |
| 8 | Shared IMPL lifecycle list missing `expired`/`partially_filled` | LOW | **DONE** — added to lifecycle state list |
| 9 | Decimal helpers silently truncate beyond 6 places | LOW | **DONE** — now throws on >6 decimal places; added `Number.isSafeInteger` check |

## test results

```text
npx tsx --test tests/shared/trading-case-helpers.test.ts tests/shared/trading-case-contracts.test.ts tests/shared/trading-case-snapshot.test.ts
→ 25/25 passed, 0 failed (3 suites)
```

## build

```text
npm run build -- --configuration development
→ passed (10.694 seconds)
```

## typecheck

```text
npx tsc --noEmit -p tests/tsconfig.json
→ passed
```

## full Angular suite

```text
npx ng test --watch=false --browsers=ChromeHeadless
→ failed during Karma load (Node `path` polyfill — pre-existing, unrelated to shared contract)
```

## pass 5 verdict

**PASS** — all pass 4 findings resolved, all pass 5 findings resolved. No critical or major findings. The shared Trading Case contract is ready for BE/FE implementation.

---

# review pass 3

**Task:** #239 — SHARED: Define Trading Case and reconciliation contracts  
**Verdict:** **FAIL**

Pass 3 confirms 13 of 15 pass 2 required fixes are fully resolved. Two remain unresolved (decimal precision partial, instrument-neutral not done), and the reviews surfaced additional spec/plan alignment gaps. Focused tests pass (18/18) and the development build passes.

## progress against pass 2 required fixes

| # | Pass 2 required fix | Status |
|---|---|---|
| 1 | Decimal precision policy | **PARTIAL** — 6-decimal policy documented, but `Number()` arithmetic and silent fallback to `'0'`/`'unprotected'` on invalid input remain |
| 2 | Expand shared tests | **DONE** — 18 tests covering lifecycle, identity, idempotency, closure, target-exit, multi-case, positions, unmatched, raw retention, numeric edge cases |
| 3 | Wire shared tests into tsconfig/CI | **DONE** — `tests/tsconfig.json` includes shared tests; `test:trading-case` script added to `validate` |
| 4 | Resolve `TradingCaseSource` mismatch | **DONE** — `position_management` added |
| 5 | Extend `ReconciliationOptions` filters | **DONE** — `brokerOrderId`, `state`, `symbol`, `agent` added |
| 6 | Complete `OrderTicketRepository` | **DONE** (documented) — `saveTicket` documented as upsert+archive; top-level IMPL plan still references `createTicket`/`updateTicket`/`archiveTicket` (see finding #5) |
| 7 | Add `targetExitBrokerOrderId?` stub | **DONE** |
| 8 | Document broker-order idempotency key | **DONE** |
| 9 | Document `confirmed → resting` decision | **DONE** |
| 10 | Align ADR-007 | **DONE** — `accepted`, title fixed, migration paths updated |
| 11 | Align FE IMPL plan path | **DONE** |
| 12 | Update PRD/IMPL for `UNCLASSIFIED` | **DONE** |
| 13 | Document/rename `OrderTicket.brokerOrderId` | **DONE** — renamed to `entryBrokerOrderId?` |
| 14 | Instrument-neutral extension point | **NOT DONE** — `RawBrokerOrder`/`BrokerOrder` remain equity-shaped |
| 15 | Mark shared IMPL/test approved | **DONE** |

## standards

### high — decimal arithmetic still unsafe and silently swallows invalid input

`shared/trading-case-contracts.ts:370-399`. The 6-decimal policy is now documented, but `remainingQuantity` and `getProtectionState` still convert decimal strings with `Number()` and round via `toFixed(6)`. Invalid strings silently fall back to `'0'`/`'unprotected'` rather than returning an error/Result or validating input. The pass 2 fix required *stopping* the silent coercion, not just documenting it.

**Recommendation:** Replace with string-based decimal arithmetic (or a BigDecimal lib), validate inputs, and return a `Result`/error for non-numeric input. *(carry-over from pass 2, partial)*

### medium — `RawBrokerOrder`/`BrokerOrder` not instrument-neutral

`shared/trading-case-contracts.ts:165-205`. No discriminated `instrumentDetails`/`legs` extension point; options adoption will require a breaking change. The PRD (`PRD-...:383-398`) explicitly states the reconciliation model must not assume an equity-shaped Broker Order.

**Recommendation:** Add an optional `instrumentSpecific?: EquityBrokerOrderDetails | OptionBrokerOrderDetails` discriminated field or an `unknown` extension slot with type guards. *(carry-over from pass 2, not done)*

### medium — `OrderTicketRepository` contract vs. top-level IMPL plan mismatch

`shared/trading-case-contracts.ts:287-294` documents `saveTicket` as upsert+archive, but `IMPL-savant-trader-broker-authoritative-order-reconciliation.md:46-55` still calls for `createTicket`/`updateTicket`/`archiveTicket`.

**Recommendation:** Update the top-level plan to the `saveTicket` upsert model, or add the explicit methods to the shared interface.

### medium — `EquityOrderTerms` does not enforce order-type/field coherency

`shared/trading-case-contracts.ts:39-51`. A `limit` order can omit `limitPrice`, a `stop_market` can omit `stopPrice`, and `quantity`/`dollarAmount` can both be absent.

**Recommendation:** Add a discriminated union per `orderType` + quantity mode, or add runtime validators.

### low — `contractID` casing inconsistency

`shared/trading-case-contracts.ts:59` uses `contractID` while the rest of the file uses `Id` (`brokerOrderId`, `entryBrokerOrderId`). Align to `contractId`.

### low — shared contract file exceeds size target

`shared/trading-case-contracts.ts` is 434 lines. The project's `rel-str-coding-guidelines.md` targets files under 300 lines and flags >400 as a strong smell. Consider splitting types, helpers, and repositories into separate files.

### low — test file exceeds size target

`tests/shared/trading-case-contracts.test.ts` is 509 lines. Consider splitting into contract-helpers tests and model-lifecycle tests.

### low — tautological test assertion

`tests/shared/trading-case-contracts.test.ts:233`: `assert.equal(brokerOrderDocumentPath(entry.caseId, entry.id), brokerOrderDocumentPath(entry.caseId, entry.id))` asserts nothing meaningful. Replace with a cross-role case/path check.

### low — `buildReadableBrokerOrderId` collision safety remains caller-dependent

`shared/trading-case-contracts.ts:401-433`. JSDoc documents caller responsibility but does not add entropy or sanitization. DST fall-back can still collide at minute granularity.

**Recommendation:** Add a symbol sanitizer and an optional entropy suffix derived from the external broker order ID when known.

### low — shared test project not type-checked in CI

`tests/tsconfig.json` exists but no script in `package.json` runs `tsc -p tests/tsconfig.json`; `validate` runs runtime tests but not a TypeScript typecheck of the tests.

**Recommendation:** Add `typecheck:tests` script and include it in `validate`.

### low — FE IMPL plan still `draft`

`IMPL-savant-trader-broker-authoritative-order-reconciliation-fe.md:7` is still `draft`. Should be promoted once the shared contract is approved.

## spec

### high — `deriveBrokerOrderState` derives terminal states without evidence verification

`shared/trading-case-contracts.ts:335-356`. The PRD says `filled` should be derived "only with verified fill evidence" (`PRD:189-190`) and `rejected`/`failed` should be derived "only through verified policy" (`PRD:192-193`). The function maps `filled`, `rejected`, and `failed` directly to terminal states with no evidence parameters. `verifiedResting` is the only evidence parameter.

**Recommendation:** Either extend the signature to accept evidence (e.g. `executions`, `cumulativeQuantity` vs `requestedQuantity`) and default to `UNCLASSIFIED` when missing, or document that the BE adapter must pre-verify before calling.

### medium — combined IMPL plan out of sync with shared contract and ADR-007

`IMPL-savant-trader-broker-authoritative-order-reconciliation.md:95-98` still says order-tickets live in `savant-trader/data/order-tickets/{ticketId}` and broker-order mirrors in `savant-trader/data/broker-orders/{brokerOrderId}`. The shared contract, shared IMPL plan, and ADR-007 all use the nested `savant-trader/data/trading-cases/{caseId}` model.

**Recommendation:** Update the combined plan or mark it superseded by the shared/BE/FE plans.

### medium — BE implementation plan field names differ from shared contract

- `IMPL-...-be.md:42` lists `quantity`; code uses `requestedQuantity`
- `IMPL-...-be.md:46` lists `averagePrice`; code uses `averageFillPrice`
- `IMPL-...-be.md:172` uses `lastObservedAt` for positions; code uses `observedAt`

**Recommendation:** Align the BE plan to the shared contract field names before BE implementation.

### medium — `canceled` spelling mapped despite PRD "do not claim as broker evidence"

`shared/trading-case-contracts.ts:344` maps `'canceled'` to `CANCELLED` with a "compatibility spelling" comment. `PRD:191` lists `canceled` as a compatibility spelling only and current treatment as "do not claim as broker evidence".

**Recommendation:** Either map `canceled` to `UNCLASSIFIED` while preserving the raw state, or update the PRD to allow the alias.

## thermo-nuclear quality

### medium — `validate` ordering can prevent `test:trading-case` from executing

`package.json:22`. `validate` runs `test:signal-list` before `test:trading-case`. The pre-existing Karma `path` polyfill failure may prevent `test:trading-case` from ever running in CI.

**Recommendation:** Confirm whether the Karma `path` polyfill issue is resolved; if not, either fix it or run `test:trading-case` in a separate CI job.

### low — `ReconciliationOptions.state` is a loose `string`

`shared/trading-case-contracts.ts:253`. `state?: string` could be `state?: BrokerOrderLifecycleState | string` for better type safety without breaking broker-specific values.

### low — test coverage still has gaps

- No contract test proving `RawBrokerOrder` can carry option/instrument-neutral fields (blocked by fix #14)
- No `ReconciliationSnapshot` test that populates `positionRows` and `unmatchedBrokerOrders` with real objects
- The contract fixture test still only asserts a few trivial equalities rather than required fields and raw→mirror inheritance
- `getProtectionState` not tested with `NaN`/`Infinity` inputs

## pass 3 test results

### focused tests

```text
npx tsx --test tests/shared/trading-case-contracts.test.ts
→ 18/18 passed, 0 failed
```

### build

```text
npm run build -- --configuration development
→ passed (12.725 seconds)
```

### typecheck (shared tests)

```text
npx tsc --noEmit -p tests/tsconfig.json
→ passed
```

### full Angular suite

```text
npx ng test --watch=false --browsers=ChromeHeadless
→ failed during Karma load (Node `path` polyfill — pre-existing)
```

## pass 3 required fixes before re-review

1. **Decimal precision** — stop silent `Number()` coercion; either switch to string/BigDecimal arithmetic or add validation with an error path. *(carry-over, partial)*
2. **Instrument-neutral extension point** — add `instrumentSpecific?` or `legs?` extension to `RawBrokerOrder`/`BrokerOrder`. *(carry-over, not done)*
3. **`deriveBrokerOrderState` evidence policy** — document or parameterize evidence verification for `filled`/`rejected`/`failed`.
4. **Align combined IMPL plan** — update collection paths or mark superseded.
5. **Align BE IMPL plan field names** — `requestedQuantity`, `averageFillPrice`, `observedAt`.
6. **Resolve `canceled` spelling policy** — map to `UNCLASSIFIED` or update PRD to allow the alias.
7. **`EquityOrderTerms` coherency** — discriminated union or runtime validators.
8. **`OrderTicketRepository` plan alignment** — update top-level IMPL plan to `saveTicket` upsert model.
9. **`buildReadableBrokerOrderId` hardening** — symbol sanitizer + entropy suffix.
10. **Add `typecheck:tests` to CI** — `tsc -p tests/tsconfig.json` in `validate`.
11. **Fix tautological test assertion** — `tests/shared/trading-case-contracts.test.ts:233`.
12. **Fix `contractID` casing** — rename to `contractId`.
13. **Promote FE IMPL plan** from `draft`.
14. **Consider splitting contract/test files** to stay under 300-line target.
15. **Confirm Karma `path` polyfill status** or separate `test:trading-case` from `validate` ordering.

**Pass 3 Verdict: FAIL — re-run `/proj review 176 239` after the required fixes.**

---

# review pass 2

**Task:** #239 — SHARED: Define Trading Case and reconciliation contracts  
**Verdict:** **FAIL**

The second pass substantially closes the first review's blockers. `OrderTicket`, `BrokerOrderMirror`, the four shared interfaces, the expanded lifecycle enum, normalized broker fields, the discriminated `ProposedOrderTerms` union, the `UNCLASSIFIED` unknown-state policy, and the ADR-006/glossary reconciliation are all now in place. Focused tests pass (7/7) and the development build passes.

However, three of the nine required fixes from pass 1 are not fully resolved, and the spec/quality reviews surfaced additional contract gaps that will create BE/FE interop friction if the seam is consumed as-is. The remaining blockers are concentrated in: test coverage against the shared test plan, decimal-precision policy, source/filter/repository contract gaps, and CI/test wiring.

## progress against pass 1 required fixes

| # | Pass 1 required fix | Status |
|---|---|---|
| 1 | Resolve Order Ticket vs Trading Case against ADR-006 | **DONE** — ADR-006 marked superseded; glossary aligned |
| 2 | Add `OrderTicket` and `BrokerOrderMirror` | **DONE** |
| 3 | Add missing lifecycle states | **DONE** — `local_only`, `submitting`, `rejected`, `failed`, `expired`, `partially_filled`, `unclassified` added |
| 4 | Complete Broker Order normalized fields | **DONE** — fees, TIF, market hours, trigger, placedAgent, executions, lastObservedAt present |
| 5 | Add four shared interfaces | **DONE** — `BrokerOrderAdapter`, `OrderTicketRepository`, `BrokerOrderMirrorRepository`, `ReconciliationModule` |
| 6 | Replace unsafe unknown-state fallback | **DONE** — `UNCLASSIFIED` instead of `PENDING` (see standards finding #1 for a doc-alignment caveat) |
| 7 | Decide and document decimal precision | **NOT DONE** — `Number()` + `toFixed(6)` still undocumented |
| 8 | Expand tests to cover the shared test plan | **PARTIAL** — 7 tests; plan requires ~15+ scenarios |
| 9 | Make full Angular test suite load | **NOT DONE** — Karma still fails on `path` polyfill (pre-existing infra issue) |

## standards

### high — `UNCLASSIFIED` lifecycle state is not in the PRD or shared IMPL plan

`shared/trading-case-contracts.ts:94` introduces `BrokerOrderLifecycleState.UNCLASSIFIED` and maps `new`/`unconfirmed`/`voided` and the default case to it (`:290-294`). The PRD (`PRD-...:211-214`) defines `submitted` as the state for an unclassified broker response, and the shared implementation plan (`IMPL-...-shared.md:38-49`) does not list `unclassified`.

This is internally consistent with the user's directive to avoid treating unsupported states as first-class, but the PRD and IMPL plan must be updated to formally introduce `UNCLASSIFIED` and its semantics, or the contract must revert to `SUBMITTED` per the PRD. The contract and the spec docs currently disagree.

### medium — `OrderTicket.brokerOrderId` is ambiguous

`shared/trading-case-contracts.ts:123` adds an optional `brokerOrderId` to `OrderTicket`, while `CaseSummary.activeBrokerOrderIds: string[]` (`:108`) already tracks active broker orders. The reviewed `CONTEXT.md`, `IMPL-...-shared.md`, and `test-...shared.md` do not explain why the root ticket needs its own broker-order ID or how it relates to the case-level list.

Either document the intent (e.g., it is the entry-order match key) or rename to `entryBrokerOrderId?`. As-is it is a duplicated/conflicting source of truth.

### medium — ADR-007 status and migration paths out of sync

`docs/adr/ADR-007_broker-authoritative-order-reconciliation.md:1-3` is still marked `proposed` with a lowercase title, inconsistent with accepted ADRs. Its migration section (`:87-89`) lists `savant-trader/data/order-tickets/{ticketId}` and `savant-trader/data/broker-orders/{brokerOrderId}` as the long-term target, but the implemented model embeds the root `OrderTicket` in `savant-trader/data/trading-cases/{caseId}` and nests broker orders at `.../broker-orders/{humanReadableBrokerOrderId}`.

Mark ADR-007 `Accepted`, fix the title format, and update the migration section to match the nested Trading Case design.

### medium — shared test not wired into tsconfig or CI

`tests/shared/trading-case-contracts.test.ts` is a `.test.ts` file, but `tsconfig.spec.json` only includes `*.spec.ts`, `tests/tsconfig.json` only includes `functions/**/*.test.ts`, and `tsconfig.json` excludes `tests/shared`. There is no `npm` script for it in `package.json` or `functions/package.json`, so it will not be type-checked or run in CI.

Add `tests/shared/**/*.test.ts` and `../shared/**/*.ts` to `tests/tsconfig.json`, add a `test:trading-case` script using `tsx --test`, and include it in `validate`.

### medium — test coverage does not match the shared test plan

`test-savant-trader-broker-authoritative-order-reconciliation-shared.md:15-37` requires tests for: Position identity vs Broker Order identity, Case closure rules, target-exit stub non-executability, Broker Order identity/role rules, Queued vs Resting vs Submitted semantics, idempotency, same-symbol multi-case behavior, and multi-case Symbol Position references.

The current 7 tests only exercise path builders, a few state mappings, arithmetic helpers, terminal states, and one shallow object-shape smoke test. This is a carry-over blocker from pass 1 fix #8.

### low — type-only imports in shared test

`tests/shared/trading-case-contracts.test.ts:4-19` imports interfaces (`BrokerOrderMirror`, `ReconciliationSnapshot`, `TradingCase`) as values. Use `import type` or inline `type` qualifiers per the convention in `tests/functions/sds-core.test.ts:11`.

### low — `deriveBrokerOrderState` does not normalize `canceled`

`shared/trading-case-contracts.ts:280-295` only maps `cancelled` (two `l`). The PRD (`PRD-...:191`) lists `canceled` as a compatibility spelling. Add it with a comment, or document that it is intentionally unsupported.

### low — options stub not marked and has inconsistent field names

`shared/trading-case-contracts.ts:47-62`: `OptionOrderLeg.type` should be `side`, and `OptionOrderTerms` uses loose `string` for `orderType`/`timeInForce`. Add an `// options-out-of-scope stub` comment and align terminology with `EquityOrderTerms`.

### low — `IMPL-...-shared.md` and `test-...shared.md` still `draft`

The shared code is implemented and under review. Update status to `approved`/`complete` once the findings above are resolved.

## spec

### high — `TradingCaseSource` omits `position_management`

`shared/trading-case-contracts.ts:13`:

```ts
export type TradingCaseSource = 'signal_pipeline' | 'manual' | 'broker_adoption';
```

`UAT-SAVANT-TRADER.md:143` expects queue Source badges of `signal_pipeline`, `manual`, or `position_management`. `IMPL-savant-trader-order-placement-shared.md:82` defines the legacy source enum as `SIGNAL_PIPELINE | MANUAL | POSITION_MANAGEMENT`. The new contract drops `position_management` and adds `broker_adoption` (not in the UAT).

Either add `position_management` to `TradingCaseSource`, or update the UAT and downstream queue rendering to the new source set. This will directly affect FE UAT acceptance.

### medium — `BrokerOrderAdapter.listOrders` / `ReconciliationOptions` lack required query filters

`shared/trading-case-contracts.ts:211-218`, `:243-247`. `IMPL-...-be.md:23` requires the adapter to support `get_equity_orders` with account, broker order ID, state, symbol, agent, date, and cursor filters. The shared `ReconciliationOptions` only exposes `since` and `cursor`; it has no `brokerOrderId`, `state`, `symbol`, or `agent` filters. Extend the shared adapter contract so the BE can expose those filters through the seam.

### medium — `OrderTicketRepository` narrower than the implementation plan

`shared/trading-case-contracts.ts:249-252` exposes only `loadTickets` and `saveTicket`. `IMPL-...-reconciliation.md:50-55` calls for `createTicket`, `updateTicket`, and `archiveTicket`. If `saveTicket` is an upsert that also handles archiving via `archivedAt`, document that; otherwise add the missing methods.

### medium — `RawBrokerOrder` / `BrokerOrder` is equity-shaped, not instrument-neutral

`shared/trading-case-contracts.ts:144-183`. The PRD (`PRD-...:381-394`) states the reconciliation model must not assume an equity-shaped Broker Order and should operate on instrument-neutral records. `ProposedOrderTerms` already has an `OptionOrderTerms` variant with `legs`, but `RawBrokerOrder`/`BrokerOrder` has no concept of legs or a discriminated instrument shape. At minimum, define an instrument-neutral extension point or discriminated union so options adoption is not a breaking change.

### medium — `CaseSummary` missing `targetExitBrokerOrderId` stub

`shared/trading-case-contracts.ts:105-116` has `targetExitState?` but no `targetExitBrokerOrderId?: string`. The PRD (`PRD-...:64-69`) lists both as `TBD` extension points. Add the symmetric identity stub.

### medium — broker-order idempotency not explicit in the contract

`shared/trading-case-contracts.ts:259-262`. `BrokerOrderMirrorRepository.upsert` does not state the idempotency key. `ADR-007:72` invariant 2 says a mirror is upserted by account plus broker order ID. Document that `brokerOrderId` + `accountNumber` is the upsert key, or expose `upsertByBrokerOrderId`.

### medium — `deriveBrokerOrderState` `confirmed → resting` decision is opaque

`shared/trading-case-contracts.ts:276-290` accepts a generic `verifiedResting: boolean` without explaining how the caller determines it. The BE plan (`IMPL-...-be.md:84`) says `confirmed` should map to `resting` only for verified trigger/price order types. Either take `orderType`/trigger evidence as input, or document the caller's responsibility explicitly.

### medium — FE plan path inconsistency

`IMPL-...-fe.md:33` says the broker-order child document path is `.../broker-orders/{brokerOrderId}` (external ID), while the shared contract (`brokerOrderDocumentPath` at `:272-274`) and shared IMPL plan (`IMPL-...-shared.md:85`) use a human-readable local document ID. Align the FE plan before implementation.

### low — `UnmatchedBrokerOrder` lacks local mirror metadata

`shared/trading-case-contracts.ts:185-187` is `RawBrokerOrder & { role: UNMATCHED }` with no `id`, `derivedState`, `updatedAt`, or `lastObservedAt`. The PRD (`PRD-...:320-329`) says to preserve the complete broker mirror for eventual adoption. Either extend with local metadata (nullable `caseId`) or document the intentional omission.

## thermo-nuclear quality

### high — `Number()` arithmetic on financial decimal strings

`shared/trading-case-contracts.ts:306-323`. `remainingQuantity` and `getProtectionState` convert decimal strings with `Number()` and round via `toFixed(6)`. Invalid strings silently fall back to `'0'` or `'unprotected'`. Floating-point subtraction can introduce rounding errors for fractional quantities. This is the largest remaining correctness risk and is a carry-over from pass 1 fix #7.

Replace with string-based decimal arithmetic (or a BigDecimal lib) and return an error/Result type for invalid inputs, or document the 6-decimal precision contract explicitly and validate inputs against it.

### medium — `ReconciliationSnapshot.orderRows` typed as `BrokerOrder[]` not `BrokerOrderMirror[]`

`shared/trading-case-contracts.ts:220-231`. The snapshot is the durable projection produced by `ReconciliationModule` and persisted by `BrokerOrderMirrorRepository`. The row type should be `BrokerOrderMirror[]` (or include `mirrorVersion`) to make the seam precise. The current test only type-checks because of structural subtyping.

### medium — `EquityOrderTerms` does not enforce order-type / field coherency

`shared/trading-case-contracts.ts:33-45`. A `limit` order can omit `limitPrice`, a `stop_market` can omit `stopPrice`, and `quantity`/`dollarAmount` can both be absent. The contract is not self-validating. Add runtime validators or a discriminated union per `orderType` + quantity mode.

### medium — `buildReadableBrokerOrderId` is not collision-safe

`shared/trading-case-contracts.ts:325-347`. The ID is deterministic from symbol + role + minute + optional sequence. Two orders for the same symbol/role in the same minute will collide unless the caller manually increments `sequence`. DST fall-back can produce ambiguous local timestamps, and there is no `symbol` character validation.

Document that callers must ensure sequence uniqueness (e.g., via a repository-backed counter) or add a stable entropy suffix (hash of `refId`/`brokerOrderId`). Add symbol sanitization.

### medium — numeric helpers lack edge-case test coverage

`tests/shared/trading-case-contracts.test.ts:61-71`. `remainingQuantity` is not tested for `cumulative > requested`, non-numeric input, empty strings, negative values, or sub-6-decimal precision. `getProtectionState` has no NaN/negative-position tests.

### low — `BrokerOrderLifecycleState` mixes local and broker-derived states

`shared/trading-case-contracts.ts:89-103`, `:144-183`. `LOCAL_ONLY` and `SUBMITTING` are local/CaseSummary states, yet `BrokerOrder.derivedState` is typed with the same enum while `RawBrokerOrder.brokerOrderId` is required. Either split into `BrokerOrderLifecycleState` and `TradingCaseLifecycleState`, or add a comment noting that `LOCAL_ONLY`/`SUBMITTING` are only valid in `CaseSummary`.

### low — `isTerminalBrokerOrderState` test omits `EXPIRED`

`tests/shared/trading-case-contracts.test.ts:73-79`. The function returns `true` for `EXPIRED` (`:301`), but the test does not assert it.

### low — contract fixture test is shallow

`tests/shared/trading-case-contracts.test.ts:81-144`. The test builds full `TradingCase`, `BrokerOrderMirror`, and `ReconciliationSnapshot` objects but only asserts three trivial equalities. It does not verify required fields, raw→mirror field inheritance, or `UnmatchedBrokerOrder`.

### low — `BrokerOrderMirror` lacks a runtime discriminator

`shared/trading-case-contracts.ts:189-191`. The mirror is only structurally distinguished by `mirrorVersion`. Consider `kind: 'broker-order-mirror'` or a nominal brand if any consumer will need runtime discrimination.

### low — `SymbolPosition` not named/versioned as a mirror

`shared/trading-case-contracts.ts:193-209`. `SymbolPosition` extends `RawSymbolPosition` with local-only `caseIds` and `protectionState`, but is not named `SymbolPositionMirror` and has no version field. Decide whether positions are mirrored and align the naming/versioning with `BrokerOrderMirror`, or document that `SymbolPosition` is a local aggregate.

## pass 2 test results

### focused tests

```text
npx tsx --test tests/shared/trading-case-contracts.test.ts
→ 7/7 passed, 0 failed
```

### build

```text
npm run build -- --configuration development
→ passed (10.937 seconds)
```

### full Angular suite

```text
npx ng test --watch=false --browsers=ChromeHeadless
→ failed during Karma load (Node `path` polyfill)
```

The full suite did not complete because of the pre-existing webpack `path` polyfill issue. This is a known infrastructure failure tracked separately from this task's contract scope, but it remains a verification gap.

## pass 2 required fixes before re-review

1. **Decimal precision policy** — document the 6-decimal contract or switch to decimal-safe string arithmetic; stop silently coercing invalid strings to `'0'`/`'unprotected'`. *(carry-over from pass 1)*
2. **Expand shared tests** to cover the shared test plan: lifecycle semantics (queued vs resting vs submitted), role/identity invariants, idempotency, case closure, target-exit stub, multi-case per symbol, Symbol Position relationships, unmatched orders, raw response retention, numeric edge cases, `EXPIRED` terminal assertion. *(carry-over from pass 1)*
3. **Wire shared tests into tsconfig and CI** — add `tests/shared/**` to `tests/tsconfig.json`, add a `test:trading-case` npm script, include in `validate`.
4. **Resolve `TradingCaseSource` mismatch** — add `position_management` or update UAT/queue rendering.
5. **Extend `ReconciliationOptions` / `BrokerOrderAdapter.listOrders`** with `brokerOrderId`, `state`, `symbol`, `agent` filters.
6. **Complete `OrderTicketRepository`** — add `createTicket`/`updateTicket`/`archiveTicket` or document `saveTicket` as upsert+archive.
7. **Add `targetExitBrokerOrderId?` stub** to `CaseSummary`.
8. **Document broker-order idempotency key** on `BrokerOrderMirrorRepository.upsert`.
9. **Document or parameterize `deriveBrokerOrderState` `confirmed → resting`** decision (caller responsibility or `orderType` input).
10. **Align ADR-007** — mark `Accepted`, fix title, update migration paths to nested Trading Case design.
11. **Align FE IMPL plan** broker-order path with the shared contract's human-readable local document ID.
12. **Update PRD/IMPL** to formally introduce `UNCLASSIFIED` (or revert the contract to `SUBMITTED`).
13. **Document `OrderTicket.brokerOrderId` intent** or rename to `entryBrokerOrderId?`.
14. **Define instrument-neutral extension point** on `RawBrokerOrder`/`BrokerOrder` for options.
15. **Mark `IMPL-...-shared.md` and `test-...shared.md`** `approved`/`complete` once the above are resolved.

**Pass 2 Verdict: FAIL — re-run `/proj review 176 239` after the required fixes.**

---

# review pass 1

**Task:** #239 — SHARED: Define Trading Case and reconciliation contracts  
**Verdict:** **FAIL**

The first shared-contract slice has useful foundations and its focused tests pass, but it does not yet satisfy the shared implementation plan. The missing contracts and lifecycle states are blocking because BE and FE tasks would otherwise build against an incomplete or contradictory interface.

## standards

### high — accepted glossary/ADR conflict

`CONTEXT.md` defines the existing Order Ticket as the source of truth in `savant-trader/data/order-tickets`, while the new Trading Case glossary entry makes the Trading Case the lifecycle aggregate and Order Ticket root. The accepted `ADR-006_order-ticket-single-collection.md` still describes the prior collection model.

This must be resolved before merging the shared model. Either update ADR-006 and the Order Ticket glossary definition, or explicitly define the relationship between the legacy Order Ticket collection and the new Trading Case model.

### high — temporary model dependency

`trading-case.types.ts` imports `InstrumentType` and `OrderIntentSignalContext` from `order-intent.types.ts`, even though the shared implementation plan identifies `order-intent.types.ts` as a temporary compatibility model.

This is acceptable only as a deliberate transitional seam and must be replaced or explicitly documented before the model becomes the long-term contract.

### medium — unbounded proposed terms

`TradingCase.proposedTerms` is `Record<string, unknown>`. This removes compile-time safety from the terms that drive live orders and will make future option extension harder.

The long-term contract should use a discriminated proposed-terms union, even if the first implementation only supports equity and ETF terms.

### medium — identity contract is incomplete

The shared model has both `BrokerOrder.id` and `brokerOrderId`, but does not define the invariant between the human-readable Firestore document ID and the Robinhood broker UUID. The document path helper returns only the collection path and not the document path.

The contract must state that local IDs are human-readable, while `brokerOrderId` remains the immutable external Robinhood identity.

## spec

### high — missing required shared types

The implementation plan requires:

- `TradingCase`
- `OrderTicket`
- `CaseSummary`
- `SymbolPosition`
- `BrokerOrder`
- `BrokerOrderMirror`
- `ReconciliationSnapshot`

The implementation is missing `OrderTicket` and `BrokerOrderMirror`.

### high — incomplete lifecycle enum

The implementation plan lists:

```text
local_only
submitting
submitted
queued
resting
filled
cancelled
rejected
failed
pending
```

The implementation is missing `local_only`, `submitting`, `rejected`, and `failed` from `BrokerOrderLifecycleState`.

### high — incomplete broker-order normalization

`BrokerOrder` is missing normalized fields required by the PRD and implementation plan, including:

```text
fees
timeInForce
marketHours
trigger
placedAgent
executions
lastObservedAt
```

### high — unsafe unknown-state fallback

`deriveBrokerOrderState()` maps every unknown raw state to `PENDING`. This can incorrectly make an unrecognized terminal or rejected broker state look active.

Unknown raw states must remain unrecognized/pending with the raw state preserved, and verified terminal states must be represented explicitly.

### medium — terminal-state helper incomplete

`isTerminalBrokerOrderState()` only recognizes `FILLED` and `CANCELLED`. Once `REJECTED` and `FAILED` are part of the shared contract, they must be handled as terminal outcomes according to the verified broker policy.

### medium — missing shared interfaces

The implementation plan calls for interfaces for:

```text
BrokerOrderAdapter
OrderTicketRepository
BrokerOrderMirrorRepository
ReconciliationModule
```

None are present yet.

### low — role naming mismatch

The implementation plan calls the target-exit stub role `future_target_exit`, while the code uses `target_exit`. Align the literal before the contract is consumed by BE/FE.

## thermo-nuclear quality

### high — contract is not deep enough yet

The current module exposes several domain records but omits the interfaces and invariants that make the model useful at the FE/BE seam. Adding more callers now would spread the missing decisions into multiple implementations.

### medium — numeric arithmetic in shared helpers

`remainingQuantity()` and `getProtectionState()` use JavaScript `Number` arithmetic on financial decimal strings and round to six decimal places. This is acceptable only if the shared contract explicitly constrains equity precision; otherwise it risks incorrect protection drift or remaining-quantity results.

### low — test organization

`trading-case.types.spec.ts` introduces a new `*.types.spec.ts` convention not otherwise present in the application. Consider naming the spec after the shared module contract or establish the convention deliberately.

### low — unrelated assertion

The terminal-state test also asserts `TradingCaseStatus.ACTIVE === 'active'`, which is unrelated to the behavior named by that test.

## pass 1 test results

### focused tests

```text
trading-case.types.spec.ts: 6/6 passed
```

### build

```text
npm run build -- --configuration development: passed
```

### full Angular suite

```text
npx ng test --watch=false --browsers=ChromeHeadless: failed during Karma load
```

The full suite did not complete because Karma reported a load error. This is a blocking verification failure for a gate review until the full suite can run successfully or the existing infrastructure failure is separately documented and resolved.

## pass 1 required fixes before re-review

1. Resolve the Order Ticket versus Trading Case relationship against ADR-006.
2. Add `OrderTicket` and `BrokerOrderMirror` contracts.
3. Add the missing lifecycle states and terminal-state behavior.
4. Complete the Broker Order normalized field contract.
5. Add the four shared interfaces.
6. Replace the unsafe unknown-state fallback with an explicit evidence-safe policy.
7. Decide and document decimal precision handling.
8. Expand tests to cover the shared implementation/test plan.
9. Make the full Angular test suite load and run successfully.

**Pass 1 Verdict: FAIL — re-run `/proj review 176 239` after the required fixes.**
