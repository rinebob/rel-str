**Topic:** Paper Trading Infra  
**Topic Slug:** `paper-trading`  
**Thread:** Signal Selection  
**Thread Slug:** `signal-selection`  
**Issue:** #1642  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# SHARED IMPL — signal-selection contracts: review bundle, queue, review-state

## Architecture overview

Single deliverable: the shared contract surface the signal-selection pane
(Thread #1117) speaks — three type clusters appended to
`shared/paper-trading-contracts.ts` under a new
`// ── Signal selection review (Thread #1117) ──` section, plus one
collection constant in `shared/st-collections.ts`:

```text
getSignalReviewQueue({})
  → { rows: SignalReviewQueueRow[] }
       row = { symbol, lastDailySignalDate?, lastOpenedAt? }

getSignalReviewBundle({ symbol })
  → { symbol,
      previousOpenedAt: string | null,   // divider position
      openedAt: string,                  // stamp this read just wrote
      occurrences: SignalReviewOccurrence[] }   // newest-first

SignalReviewOccurrence = st-signals occurrence row + ledger join:
  { occurrenceId, symbol, signalType, signalBarDate, signalTimeframe,
    direction, signalStatus, signalIndicators, sourceRunId,
    checked, tradeId?, tradeStatus? }
```

No runtime logic beyond one helper: `signalPickFromReviewOccurrence` —
the FE→mint bridge that maps a checked row to a `SignalPick`, which is
the single place the `{barDate, signalType}` field-name mapping is
written down (the `signalDedupeKey` vs `stSignalOccurrenceId` order
mismatch lives between these types; the helper makes the FE physically
unable to swap them).

## Boundary

- **`shared/paper-trading-contracts.ts`** — all new types. The review
  surface is a paper-trading-domain consumer (its mint/delete callables
  already live here); a separate contract file would orphan them from
  `SignalPick`/`MintResult`, which the bundle deliberately mirrors.
- **`shared/st-collections.ts`** — `SIGNAL_REVIEW_CONFIG_DOC` constant
  only (doc id for `st-config/signalReview`); `functions/src/common/
  st-collections.ts` re-exports it like `AUTO_PAPER_CONFIG_DOC`.
- **No FE/BE logic here** — this doc defines shapes both sides compile
  against; behavior lives in the BE/FE IMPL docs.

## Files

- `shared/paper-trading-contracts.ts` (modified — new section)
- `shared/st-collections.ts` (modified — one constant)
- `functions/src/common/st-collections.ts` (modified — re-export)
- `shared/paper-trading-contracts.spec.ts` or sibling spec (modified —
  constant + helper pinning)

## Modules

- **`GetSignalReviewQueueRequest/Response`** — the symbol picker's data:
  one row per PRIMARY ∪ SECONDARY member with the two fields the
  "has unseen signals" badge needs (`lastDailySignalDate` is already
  denormalized on `st-symbols` docs by the signal writer; `lastOpenedAt`
  comes from the review-state doc).
- **`GetSignalReviewBundleRequest/Response`** — the pane's per-symbol
  payload: occurrences newest-first, the pre-stamp `previousOpenedAt`
  (divider anchor), and the just-written `openedAt`.
- **`SignalReviewOccurrence`** — the row the pane renders. `checked`
  and `tradeId`/`tradeStatus` are the server-side ledger join; the FE
  never builds a dedupe key.
- **`SignalReviewStateDoc`** — `st-config/signalReview` shape:
  `{ lastOpenedAt: Record<symbol, ISO string> }`. One doc; ~288 keys
  max, trivially under the 1 MiB limit.
- **`signalPickFromReviewOccurrence(occ) → SignalPick`** — the only
  function: `{ symbol: occ.symbol, signalBarDate: occ.signalBarDate,
  signalType: occ.signalType }`.

## Contracts

```ts
// st-config doc id — per-symbol pane-visit stamps live here.
export const SIGNAL_REVIEW_CONFIG_DOC = 'signalReview';   // shared/st-collections.ts

export interface SignalReviewStateDoc {
  /** symbol → ISO timestamp of the most recent bundle read for it. */
  lastOpenedAt: Record<string, string>;
}

export interface SignalReviewQueueRow {
  symbol: string;
  /** Denormalized st-symbols field — most recent daily signal bar. */
  lastDailySignalDate?: string;   // YYYY-MM-DD
  /** Review-state stamp — absent until the pane is first opened. */
  lastOpenedAt?: string;          // ISO
}
export interface GetSignalReviewQueueRequest {}
export interface GetSignalReviewQueueResponse {
  rows: SignalReviewQueueRow[];   // PRIMARY ∪ SECONDARY members, deduped
}

export interface SignalReviewOccurrence {
  /** stSignalOccurrenceId — `{SYM}_{barDate}_{signalType}` (doc id). */
  occurrenceId: string;
  symbol: string;
  signalType: string;
  /** YYYY-MM-DD — maps to SignalPick.signalBarDate. */
  signalBarDate: string;
  signalTimeframe: StSignalTimeframe;   // 'D' only in practice — server filters
  direction: TradeSide;
  signalStatus: StSignalStatus;
  signalIndicators: Record<string, number | string | null>;
  sourceRunId: string;
  /** Ledger join — a signal-scoped PaperTrade claims this occurrence. */
  checked: boolean;
  /** Deterministic trade id when checked — the deletePaperTrades arg. */
  tradeId?: string;
  tradeStatus?: PaperTradeStatus;
}
export interface GetSignalReviewBundleRequest { symbol: string; }
export interface GetSignalReviewBundleResponse {
  symbol: string;
  /** lastOpenedAt BEFORE this read stamped it — the "new since last
   *  visit" divider anchor. `null` on the symbol's first open. */
  previousOpenedAt: string | null;
  /** The stamp this read just wrote (same value next read reports as
   *  previousOpenedAt → divider is stable across re-fetches). */
  openedAt: string;
  /** Daily occurrences, newest barDate first. */
  occurrences: SignalReviewOccurrence[];
}

export function signalPickFromReviewOccurrence(
  occ: SignalReviewOccurrence,
): SignalPick;
```

Callable deploy names: `getSignalReviewQueue`, `getSignalReviewBundle`
— registered in `functions/src/index.ts` and FE `CallableName` (parity
pinned in the FE TEST doc).

## Decisions

- **Server-side ledger join** — `checked`/`tradeId` arrive with the
  occurrence; the FE never sees `signalDedupeKey`, so the swapped
  field-order hazard (`{SYM}_{signalType}_{barDate}` vs
  `{SYM}_{barDate}_{signalType}`) can't cross the wire.
- **Stamp-on-read, not on-explicit-visit** — the bundle read itself
  writes `lastOpenedAt[symbol]`. `previousOpenedAt` preserves the
  pre-read value for this render, and re-fetches (toggle refresh,
  re-open) report the same stamp → the divider never jumps.
- **One review-state doc, not per-symbol docs** — a single
  `st-config/signalReview` with a `Record<symbol, ISO>` map; at ~288
  list members the doc is ~15 KB. Matches the `st-config/autoPaper`
  precedent (one config doc per feature, not per entity).
- **Daily timeframe filtered server-side** — the bundle carries
  `signalTimeframe` for forward-compat but the BE only queries `D`
  (PRD scope; `W` occurrences can't mint and would render as dead
  checkboxes).
- **Queue badge from `lastDailySignalDate`, not counts** —
  per-symbol occurrence counts would cost a `count()` per member
  (~288 queries per picker render). The already-denormalized
  `st-symbols.lastDailySignalDate` answers "has signals / has signals
  newer than lastOpenedAt" at zero extra write cost.
- **`signalPickFromReviewOccurrence` is a function, not a type cast** —
  one reviewed site for the `barDate`/`signalBarDate` rename across
  the seam.

## Sequence / phases

- **Task 1 (only task)** — contract section + constant + re-export +
  helper + pinning specs. Gates BE task 1 and FE task 1.

## Prior art / regression

- `SignalPick`/`GeneratePaperSignalTradesRequest`/`DeletePaperTradesRequest`
  (same file, Thread #906) — the write-side contracts this surface
  pairs with; unchanged.
- `st-collections.ts` `AUTO_PAPER_CONFIG_DOC` — the doc-id constant
  pattern `SIGNAL_REVIEW_CONFIG_DOC` mirrors.
- Pure additive — zero behavior change; regression risk confined to
  the spec that pins `SignalPick`'s field names.

## Verify relay

- `cd functions && npm run build` (shared consumed by functions bundle)
- `npx jest shared/paper-trading-contracts` (or the sibling spec path)
- FE `tsc --noEmit` compiles against the new types

## Risks / open seams

- `SignalReviewStateDoc` is a shape, not a Firestore trigger contract —
  nothing enforces the map's schema; writers must use the shared type.
- If the pane later wants per-occurrence "selected at" provenance,
  `tradeId` join already points at the ledger doc that owns it —
  no contract growth needed.
