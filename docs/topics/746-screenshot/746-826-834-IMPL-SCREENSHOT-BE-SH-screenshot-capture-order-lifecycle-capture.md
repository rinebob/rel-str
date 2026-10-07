**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #834  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** IMPL (BE-SH)  
**Status:** Draft  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# IMPL (BE-SH) — Order Lifecycle Auto-Capture

Consumes the shipped capture engine (#747) at the code seams that ARE lifecycle moments. Detection of asynchronous transitions (order-state poller) is a separate effort — this builds the intake it calls.

## Module layout

```
functions/src/screenshot-capture/
  lifecycle-capture.ts        # captureLifecycleEvent() — intake, dedup, invoke, manifest+index
  capture-chart.ts            # (existing) handleCaptureChartSnapshot — reused in-process
  storage-writer.ts           # (existing)
shared/screenshot-capture-contracts.ts  # +groupId on spec, +PositionType tags
functions/src/paper-trading/
  ledger.ts                   # hooks at applyEntryFill / applyExitFill / markPositionSettled
  callables.ts                # paperSignalOrder entry capture (via the ledger hook — free)
  engine/                     # position docs carry capturedEvents ledger
src/app/common/  (or firestore collections)  # ST_ORDER_INTENTS field additions (typed)
functions/src/screenshot-capture/tracking.ts  # st-order-intents read/write + st-screenshots index
```

## Contract changes (`shared/screenshot-capture-contracts.ts`)

- `CaptureChartSpec.groupId?: string` — campaign/cohort root. Path becomes
  `st-trade-screenshots/{SYMBOL}/{groupId}/{ts}-{event}-{positionType}-{refId}-{interval}.{ext}`
  when present; falls back to the current flat shape when absent (dev/manual captures).
- `PositionType` — add strategy tags: `VERTICAL_DEBIT_SPREAD`, `CALENDAR`, `OPTION_SINGLE` (label values only — the chart always renders the underlying).
- `refId` stays `{positionId}-{event}` per capture — dedup granularity. `groupId` is folder/index granularity.

## Lifecycle intake — `captureLifecycleEvent`

```ts
captureLifecycleEvent({
  refId,        // {positionId|tradeId|intentRefId}-{event}
  groupId,      // cohortId | positionId | openIntentRefId
  event,        // CaptureEvent
  symbol,       // underlying
  positionType,
  carrier: { kind: 'intent' | 'engine-position', docPath },  // ledger home
  intervals = [DAILY, WEEKLY],
}): Promise<CaptureOutcome>
```

Flow:

1. **Dedup** — Firestore transaction on the carrier doc: if `capturedEvents` already contains `event`, return `skipped-duplicate`. Claim the slot inside the transaction (write a `pending` marker) so concurrent triggers can't double-fire.
2. **Invoke** — `await withTimeout(handleCaptureChartSnapshot(specWithRenderOnlyFalse), 10_000).catch(err → log, return {ok:false, error})`. Await-with-cap: detached promises can be frozen when the function's response returns; swallowing keeps failures off the order path.
3. **Manifest + index** — on success, transaction-commit `capturedEvents.push({event, capturedAt, paths:{svg,png}})` on the carrier + write `st-screenshots` index doc `{groupId, positionId, event, symbol, capturedAt, paths}` (id `{groupId}-{refId}-{event}` — deterministic, overwrite-safe). On failure, release the pending claim (or leave `failed` marker — blueprint choice; failure must not permanently wedge retries: leave `{event: {status:'failed', error, at}}` and allow retry on next trigger).

## Tracking fields

`st-order-intents` docs gain (backend-written; FE writes the first two at ticket creation):

```ts
role?: 'open' | 'close';
linkedPositionId?: string;   // close tickets → opening intent refId / group root
signalId?: string;           // already present on signal tickets — group linkage
lastSeenState?: string;      // detector bookkeeping (written by external poller)
capturedEvents?: CapturedEventEntry[];  // manifest + dedup ledger
```

Engine positions carry `capturedEvents` on the existing position/trade docs — same entry shape, no new collection.

## Hooks (all await-with-cap, swallow-and-log)

| Seam | Event | Carrier / roots |
|---|---|---|
| `applyEntryFill` (ledger.ts) — engine open-pass + `paperSignalOrder` | `order-filled` | engine position doc; groupId=cohortId (signal) or positionId |
| `applyExitFill` / `markPositionSettled` (terminal statuses incl. `EXPIRED_WORTHLESS`, `ASSIGNED_HOLDING_SHARES`, `CLOSED`) | `position-closed` | same |
| External detector → `captureLifecycleEvent` | `order-filled` / `position-closed` | `st-order-intents` doc; groupId=openIntentRefId or positionGroupId |
| `submitEquityOrder` success (FE, limit orders) → calls the **existing callable** directly | `order-placed` | intent doc written first, so backend hooks can find it |

## Risks / decisions

- Engine `placeBrokerageOrder` is a synchronous stub — `order-filled` fires at the fill write; `order-placed` is a no-op for engine orders today.
- `ASSIGNED_HOLDING_SHARES` fires `position-closed` per PRD decision #1 (the option position ended).
- Options positions capture the **underlying** symbol — position docs carry it.
- `positionType` per lane: `stock` for equity legs, strategy tag (e.g. `vertical-debit-spread`) derived from the position's leg shape — small helper `positionTypeFor(position)`.
