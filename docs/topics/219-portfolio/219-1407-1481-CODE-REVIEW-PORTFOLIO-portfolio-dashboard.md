**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1481  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# Code Review — #1481 get_option_positions wire-shape mismatch

**Verdict: PASS** (three parallel axes — Spec PASS / Thermo-Nuclear
APPROVE / Standards PASS — one critical + five majors remediated
in-cycle, all pinned by specs including a real-capture replay)

## Change summary

`optionPositionsPageSpec` hunted `results`/`option_positions` +
`instrument_id`/`average_cost` — containers and fields that do not
exist on the wire — so every option position extracted to `[]`
(dashboard Options tab, option quotes, allocation legs). The remap:

- **Parse** — `data.positions` + wire field map
  (`option_id`/`average_price`/`chain_symbol`/`expiration_date`/
  `quantity`); `data.next` walk preserved from #1474.
- **`OptionPosition.side`** — wire `type` (`long`/`short` position
  side) lands here; `optionType`/`strikePrice` stay empty until the
  instrument join — the two `type` semantics never cross.
- **Instrument join** — `OptionInstrumentFilters.ids` (CSV arg);
  `getOptionInstruments({ids})` runs in the dashboard's quote wave off
  the same `collectOptionInstrumentIds` list, landing on a new
  `optionInstruments` section; the selector merges type/strike onto
  each row. No positions → no call.
- **Short semantics** — wire quantity is unsigned; parse
  sign-normalizes (`side:'short'` → `quantity:-N`) preserving the
  codebase's `qty<0`=short convention, so PnL, allocation, and the Qty
  column all read correctly.
- **Units** — wire `average_price` is contract dollars; parse divides
  by `trade_value_multiplier` → per-share `averageCost`, joining
  `mark_price`'s per-share units. Dollar math multiplies back via
  `qty × multiplier` in the selector, `computeAccountPnL`, the
  table's cost/value columns, and `allocation-mappers`
  (`o.multiplier`, handles adjusted contracts).

## Critical — remediated in-cycle

**Units mismatch (Spec axis, verified from captures).** Positions-wire
`average_price` is contract dollars — `opt-pos-open.json` shows
`190.0000` for the same instrument (`…da44`) whose `opt-quote-fill`
mark is `1.91`/share — while every consumer assumed same-unit prices.
`computePnL(190, 1.91, …)` → −$188.09 vs the real +$1.00; PnL, PnL%,
Value, `costBasis`, and the header scoreboard all ~100× wrong. The
fixtures had authored same-unit prices so no spec could catch it.
**Fix:** per-share normalization at parse (`average_price /
multiplier`) + `multiplier` propagated through every dollar
computation; `allocation-mappers` now reads `o.multiplier`. Locked by
the `opt-pos-open` capture-replay spec (real wire bytes →
`averageCost 1.9`, `multiplier 100`).

## Majors — remediated in-cycle

| Finding | Axis | Remediation |
|---|---|---|
| `allocation-mappers` costBasis ×100 on contract-dollar avg | Spec | Fixed by per-share normalization; mapper uses `o.multiplier` |
| Discovery state filter (`untradable`/`inactive`/`expired`) ran on the `ids` path — a held delisted/expired contract could never join | Spec + TN | Filter skipped when `filters.ids` set; id lookup is identity, not orderability |
| `retrySection('optionPositions')` left `optionQuotes`/`optionInstruments` permanently stale after a first-load failure | TN + Standards | Option-dependent wave extracted to `loadOptionMeta` (re-reads current ids); positions retry voids it |
| `optionInstruments` section lifecycle unreachable — dead retry affordance, error invisible | TN | `'optionInstruments'` removed from `SectionName` + dead case deleted; error heals via the positions-retry cascade; `—` is the intended cell fallback |
| `new Map(...)` built inside the `patchAccount` updater — a malformed fulfilled payload threw out of `fetchCore`, bypassing per-section error policy | TN | `Array.isArray` guard → `errorSection('Malformed instruments payload')`; Map built in `loadOptionMeta` |

## Minors — remediated in-cycle

- `inst?.type ?? p.optionType` — `''` isn't nullish → `||` (TN #7)
- Duplicated `side==='short' || qty<0` → shared
  `isShortOptionPosition` in helpers (TN #6)
- `collectOptionInstrumentIds` included closed (qty-0) rows' ids in
  quotes + instruments payloads (TN #10 / Spec minor)
- `getOptionInstruments` could emit a filterless request —
  `chainSymbol` going optional dropped the type-level guarantee →
  local throw + spec (TN #11)
- `makeOptionPosition` defaults modeled post-join values — could mask
  a broken join → post-parse defaults (`optionType:''`,
  `strikePrice:null`, per-share `averageCost`, `multiplier:100`)
  (Standards nit)
- No capture-replay binding → `opt-pos-open.json` case added to
  `robinhood-mcp-client.capture.spec.ts` (Spec minor / Standards nit)
- `—` degradation unasserted at the DOM seam → render spec added to
  `option-positions-table.component.spec.ts`

## Deferred — documented, not fixed

- **`ids` CSV cap unverified** — no documented limit; one call sends
  all position ids (~36 chars each). A silent truncation would surface
  as per-row `—`. Live-probe-worthy; no cap to code against today.
- **`equityPositions` retry → `equityQuotes` cascade** — same gap
  class as the option side but pre-existing and outside this diff's
  blast radius (the fix was scoped to what #1481 made worse).
- **Epoch guard on the wave patch** — `ensurePeaks` guards on
  `loadEpoch`; the quote/instrument wave doesn't (pre-existing
  pattern, not introduced here).
- **`pending_*` quantities unmapped** — the tool guide says warn on
  non-zero pending; available on the wire when wanted. Follow-up
  candidate.
- **`side` typed `string` not `'long'|'short'`** — matches the
  codebase's verbatim-raw convention (`OptionInstrument.type`).
- **Qty column is the only short indicator** — negative qty per the
  signed convention; deliberate, no invented UX.
- **No real short-position capture** — `-Math.abs` normalization is
  correct under signed or unsigned wire encoding (safe by
  construction); capture when the account next holds a short.
- **Client file now ~1300 lines** — pre-existing over-cap condition;
  parser extraction remains the owed split (same disposition as
  #1462/#1474).

## Requirement verdicts (Spec axis)

| # | Requirement | Verdict |
|---|---|---|
| 1 | Extract `data.positions` | MET — `extractList(parsed,'positions')`; spec'd incl. capture |
| 2 | Field map + side placement | MET — `side` field; `optionType` never receives wire `type` |
| 3 | `optionType`/`strikePrice` via join | MET — `ids` lookup in the quote wave; selector merge; `—` fallback |
| 4 | Specs per capture contract | MET — wire-shape + ids-arg + join + failure + capture-replay specs |
| — | Preserve #1474 walk | MET — `data.next` walked; normalization per-page inside `page.parse` |

## Test results

313/313 suites, 5,676/5,676 specs green; `tsc` app+spec clean.

## Results log

- Standards: PASS — zero critical/major; verified `ids` CSV against
  `dep-opt-instr-07.json`; dead-code sweep clean.
- Spec: PASS after remediation — critical units finding verified from
  `opt-pos-open` + `opt-quote-fill` (same `…da44` instrument).
- Thermo-Nuclear: APPROVE after remediation — `patchAccount` is
  `accountNumber`-keyed so no cross-account landing; join-in-selector
  layer endorsed.

## Round 2 — remediation-delta re-check (2026-11-15)

Scoped delta-check of the Round-1 remediation, not a three-axis re-run.

### Verified

- **Units chain end-to-end** — every `averageCost` consumer traced:
  parse (per-share normalize) → `optionPositionsWithPnL` / `computeAccountPnL`
  (`qty × multiplier`) → table cost/value (`× multiplier`) →
  allocation-mappers (`o.multiplier`, adjusted-contract-safe). Fills path
  keeps `OPTION_MULTIPLIER` — legs carry no per-position multiplier.
- **`loadOptionMeta` wave shape** — typed-empty slot, `Array.isArray`
  guard → per-section error, `void` cascade refinds the account so it
  re-keys off the fresh positions.
- **`ids`-path filter skip** — `isIdLookup` computed from `filters.ids`;
  order-ticket `chainSymbol` discovery path still filters.
- **`SectionName` removal** — union/case deleted; `AccountState` field
  stays (heals via the positions retry cascade).

### Findings — spec-pin gaps on remediation mechanisms (all fixed)

| Mechanism | Pin added |
|---|---|
| `optionPositions` retry → `loadOptionMeta` cascade | store spec — retry re-keys instruments on the new ids, selector reflects joined metadata |
| `ids`-lookup state-filter skip | client spec — expired/untradable survives `ids`, dropped on `chainSymbol` |
| Closed positions (`qty 0`) excluded from id collection | store spec — no instrument call for a dead contract |
| Non-array instruments payload → section error | store spec — `optionInstruments.error` set, positions row preserved |

`aggregateSummary` option multiplier path already pinned
(`(5.5−5)×1×100 = 50`, selectors spec). No code defects in the delta.

### Round-2 test results

Touched suites re-run post-specs — portfolio-dashboard + robinhood-mcp:
38/38 suites, 816/816 specs green (store 51, selectors 20, client 123).
Verdict: converged — no third pass indicated.
