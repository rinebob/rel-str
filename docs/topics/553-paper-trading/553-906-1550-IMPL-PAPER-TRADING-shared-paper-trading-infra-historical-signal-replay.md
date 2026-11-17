**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1550  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-17  

# SHARED IMPL — Historical Signal Replay

Contracts for the merged ledger model: picked signals mint real
`PaperTrade`s (backdated for history, auto-ingested live), selection is
grooming the ledger, and rejection is hard delete. No parallel
position artifact exists anywhere in this design.

## Files

- `shared/paper-trading-contracts.ts` — request/response types, curated
  variant constants, governing-policy marker, `PaperTrade` additions.
- `shared/options-common.ts` — `OptionQuoteSource` extension.
- `shared/paper-trading-ids.ts` — no changes expected; `buildTradeId`
  and `signalDedupeKey` already produce the deterministic ids the mint
  path reuses.

## 1. Mint request/response — `generatePaperSignalTrades`

```ts
export interface SignalPick {
  symbol: string;
  signalBarDate: string;   // YYYY-MM-DD — the signal's bar date
  signalType: string;      // e.g. D_ST_TREND_RIDER_V2_LONG
}

export interface GeneratePaperSignalTradesRequest {
  items: SignalPick[];     // max 50 per call — caller batches
}

export interface MintResult {
  signalId: string;        // signalDedupeKey — the value on trade.signalId;
                           // NOT stSignalOccurrenceId (swapped layout,
                           // non-interchangeable — see shared/st-ids.ts)
  tradeId?: string;        // set on created/deduped
  status: 'created' | 'deduped' | 'error';
  error?: string;          // per-item — never fails the whole call
}

export interface GeneratePaperSignalTradesResponse {
  results: MintResult[];
}
```

- Deterministic id: `buildTradeId(signalBarDate, 'sig', symbol,
  signalTradeDesc(signalType))` — the same id the live ingest mints, so
  a live capture and a historical pick can never double-mint.
- No variant parameters in the request: every curated trade carries the
  same tracked set (§3) — the workflow grooms identical artifacts.

## 2. Delete request/response — `deletePaperTrades`

```ts
export interface DeletePaperTradesRequest {
  tradeIds: string[];      // bulk — grooming sweeps are multi-row
}

export interface DeletePaperTradesResponse {
  deleted: string[];       // docs fully removed
  notFound: string[];      // idempotent — a missing id is not an error
  failed: { tradeId: string; error: string }[]; // per-item — never throws
}
```

Cascade = **everything referencing the trade**: the trade doc itself
(embedded marks/fills/runs die with it), its `rq-*` rawQuote
audit docs, and its `pap_*` order-ticket docs. User directive:
delete everything when curating out an unwanted trade — no tombstones,
no residual audit residue. Derived aggregates (account counters, stats
docs, position groups) are recomputed by the rollup passes — not
enumerated. Scoped to `source=SIGNAL` trades: other sources report
`failed`, never deleted — a groom tool must not delete strategy/manual
positions.

## 3. Curated variant set + dynamic governing

```ts
/** The tracked exit set seeded on every curated trade — minted picks
 *  AND new live signal captures. Each key evaluates daily; only the
 *  policy-selected governing run (or an independent closer) closes. */
export const CURATED_VARIANT_KEYS: readonly string[] = [
  'trailing-5',
  'trailing-8',
  'ma-close-20',
  'ma-close-50',
  'ma-close-100',
  'target-50',
  'target-100',
];

/** Marker on PaperTrade — the eval path runs the governing-selection
 *  policy each day instead of honoring a static governing flag. */
export const CURATED_GOVERNING_POLICY = 'deepest-stop-else-trailing-8' as const;
export type GoverningPolicy = typeof CURATED_GOVERNING_POLICY;

// PaperTrade gains one optional field:
//   governingPolicy?: GoverningPolicy
```

**Governing policy** (user-stated, encoded directionally): among the
below-price stop rules (`trailing-*`, `ma-close-*`), the governing run
is the one whose current stop level is **deepest below the trade's
high watermark** — recomputed each eval day. **Exception:** when that
deepest stop sits below the entry fill price (a losing exit),
`trailing-8` governs instead. Shorts mirror: deepest stop above the low
watermark; the exception flips to "stop above entry."

- `target-*` and `time-*` families are **independent closers** — they
  fire and close the position regardless of governing assignment (a
  target or deadline is an exit, not a shadow measurement).
- On policy trades, `governingVariant` **mirrors** what actually
  governs: seeded `'trailing-8'` at mint (`seedVariantRuns` requires a
  terminal-family key — a policy pick like `ma-close-*` can't be
  seeded), rewritten to the policy's selection each eval day, and
  rewritten to an independent closer's key when one fires the real exit
  (so `exitReason` attributes correctly). Only ACTIVE runs are
  candidates; if `trailing-8`'s own run is already EXITED the fallback
  can't apply and the deepest ACTIVE candidate governs instead.
- Existing live trades keep static `governingVariant` behavior — the
  policy applies only to trades carrying `governingPolicy`.

## 4. Exit-grammar additions (registry surface)

New variant-key families for `parseVariantKey` + evaluators:

| Key | Family | Behavior | Closing class |
|---|---|---|---|
| `ma-close-{N}` | stop | Fire when close crosses the N-day MA (below for longs, above for shorts) | governing candidate — `currentLevel` = today's MA value |
| `target-{pct}` | target | Fire when mark reaches entry × (1±pct) | independent closer — `currentLevel` = the target price |
| `trailing-{pct}` | stop | (existing) watermark ± pct | governing candidate |
| `initial-stop-{pct}` | stop | (existing) fixed level off entry | governing candidate |
| `time-{N}d` | time | (existing) days-held bound | independent closer |

New registry accessor: **`variantLevel(run, ctx): number | undefined`** —
each evaluator exposes its current stop/target level so the governing
selector can compare across rules. `undefined` = no price level (time
exits) → never a governing candidate.

`ma-close-*` evaluation needs the MA value at the mark date — the ctx
gains an indicator/bars accessor (BE supplies it from symbol-data; see
BE IMPL §4). The eval signature stays `evaluateVariant(ctx)`.

## 5. Provenance — `OptionQuoteSource` extension

```ts
export enum OptionQuoteSource {
  AV_EOD = 'AV_EOD',
  RH_MCP = 'RH_MCP',
  AV_REALTIME = 'AV_REALTIME',
  SDS_BARS = 'SDS_BARS',   // NEW — priced from stored daily bars (backfill)
}
```

- Backfilled entry/exit fills stamp `SDS_BARS`; live marks stay
  `RH_MCP`. Origin is recoverable from the fills — no separate
  provenance flag, per the merged-ledger decision.
- No `rq-*` audit doc for a bars-sourced fill — the bar is reproducible
  from symbol-data; the audit doc exists to capture a live MCP payload
  that would otherwise be lost.

## 6. Ticket terms for picks

Mint emits a canonical `st-order-tickets` doc via the existing
`StOrderTicketWriter`: `mode: 'paper'`, `auto: false` (a manual pick,
not the auto stream), `origin: {type: 'signal', signalId}`,
`idSeed: tradeId` (dedupe-stable), terms mirroring the ingest's equity
market-order shape. Delete removes the ticket doc outright.

## Notes

- `SIGNAL_GOVERNING_VARIANT`/`SIGNAL_SHADOW_VARIANT_KEYS` are superseded
  for signal-source trades by `CURATED_VARIANT_KEYS` + the policy marker;
  the old constants stay for strategy-instance trades that reference them.
- The curated target percentages (`target-50`, `target-100`) are a seed
  proposal — adjust at task time; the grammar is what matters.
- Firestore paths unchanged: trades stay under `paper-trading/{anchor}/
  items/{tradeId}`; the pick set is a `source=SIGNAL` (+ symbol/date)
  query — no new collection.
