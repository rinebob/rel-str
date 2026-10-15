**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #994  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #998  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# CODE REVIEW — SHARED-IMPL: canonical st- type shapes (#998)

## Change set

- NEW `shared/st-types.ts` — `StMode` + `ST_MODES`
- NEW `shared/st-signals.ts` — `StSignal`, `StSignalStatus`, `StSignalTimeframe`, `normalizeStSignalDirection`
- NEW `shared/st-order-tickets.ts` — `StOrderTicket` + origin/terms/legs/state/fill/error types, `validateStTicketTerms`
- NEW `shared/st-position-groups.ts` — `StPositionGroup` + rollups
- NEW `shared/st-strategy-instances.ts` — `StStrategyInstance extends StrategyInstanceConfig`
- EDIT `shared/paper-trading-contracts.ts` — `positionGroupId`, `strike`/`expiration`/`optionType`, `PAPER_TRADE_WRITABLE_STATUSES`, `signalTimeframe`/`signalStatus` → canonical types
- EDIT `functions/src/st-cloud-function/signals.ts` — `StSignalStatus` delegates to `@st/signals` (import + re-export)
- EDIT `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js` — five `@st/*` aliases
- NEW 5 spec files (41 tests) + `scripts/verify/data-pipeline-st-types-998.{ts,md}` + run-all/README registration
- EDIT `…-IMPL-…-SHARED-…md` §2 — shape blocks updated to as-built, review deltas marked

## Standards

Fixed during review: `StSignalStatus` was declared twice (`shared/st-signals.ts` and `functions/src/st-cloud-function/signals.ts`) — now a delegated re-export, same pattern as the constants barrel. `PaperTrade.signalTimeframe`/`signalStatus` inline unions replaced with the canonical types. `ST_TICKET_SIDES`/`ST_TICKET_INSTRUMENTS` runtime arrays added; `ST_MODES` pinned by spec.

Remaining nits (accepted): parallel type+array pairs for writable statuses (existing pattern, array pinned); `fillSummary.filledAt` duplicates top-level `filledAt` (matches IMPL shape).

## Spec

All documented #998 acceptance criteria met: `StSignal`/`StOrderTicket`/`StPositionGroup` shapes present, `StStrategyInstance` extended, `PaperTrade` extensions in place, BE/FE identity by construction via shared aliases, shape specs + offline verify script delivered. No #999 concerns pulled in (no ID builders, no mapping helpers beyond the direction normalizer — see below).

**Plan deltas (IMPL doc updated accordingly):** the original draft spec'd BE/FE mirror files; implementation used the single-shared-source + alias pattern #997 established. Review also grew the ticket/group shapes beyond the original sketch — see Thermo-nuclear.

## Thermo-nuclear

Findings and dispositions:

| Finding | Severity | Disposition |
|---|---|---|
| `StOrderTicket` had no `symbol` — ticket could describe "buy 10 of nothing" | Critical | **Fixed** — `terms.symbol: string` required |
| Option tickets couldn't express legs/contract identity (`optionId`, `positionEffect`, `occSymbol`) | Critical | **Fixed** — `terms.legs?: StTicketLeg[]` (v1 single-leg) |
| No `rejected`/`failed` terminal state | Major | **Fixed** — `'failed'` added to `StTicketState` |
| `direction` lowercase vs legacy `'LONG'/'SHORT'` — silent miscase corruption | Major | **Fixed** — `normalizeStSignalDirection()` + JSDoc warning |
| `validateStTicketTerms` accepted 0/negative/NaN/fractional quantities | Major | **Fixed** — positive-finite + integer checks |
| `StPositionGroup` missing `userId` | Major | **Fixed** — required `userId` added |
| `StStrategyInstance` missing `paperAccountId` (needed by #1006) | Major | **Fixed** — `paperAccountId?: string`, documented required-when-paper |
| Legacy `orderType`/`timeInForce`/`marketHours`/`taxLots`/`signalContext`/`bucketId`/`terminalAt`/tracking fields had no home — silent drop in the #1003 intent migration | Major | **Fixed** — all added as optional terms/top-level fields (`tracking` reuses `OrderIntentTrackingFields`) |
| Staged expression recipe had no home (was `PaperTrade.expressionTemplate`) | Major | **Fixed** — `terms.expressionTemplate?: SignalExpressionTemplate` |
| `enabled` vs `lifecycleState` precedence ambiguous | Minor | **Fixed** — documented: `enabled=false` wins |
| `indicators: Record<string, unknown>` looser than legacy scalar payload | Minor | **Fixed** — narrowed to `number \| string \| null` |
| `StSignal` lacks `id` | Minor | Accepted — doc id fully derivable from `{symbol, barDate, signalType}`; builders are #999 |
| `refId` required for paper mode | Minor | Accepted — used as the paper callable idempotency key too |
| `lastFiredAt` optional though IMPL listed it | Nit | Accepted — absence = "never fired" |

## Test results

- 5 shape specs — **41/41 pass**
- `scripts/verify/data-pipeline-st-types-998.ts` — **38/38 checks OK**
- `cd functions && npm run build` — green (esbuild 1.8mb)
- Shared/core sweep — 971/972, sole failure is the pre-existing unrelated `screenshot-capture-contracts` `PositionType` expectation (committed drift, not this task)

## Verdict

**PASS** — after the review-loop fixes above. The canonical shapes now carry everything the #1003 order-intents migration and live option submission need, the duplicate `StSignalStatus` is unified, and direction/validation hazards are handled at the contract layer.
