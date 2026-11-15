**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1271  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** N/A  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CATALOG  
**Status:** Draft  
**Created:** 2026-11-13  
**Last Updated:** 2026-11-13  

# Template Registry Catalog — planning snapshot

Contemplated Replay Templates for the code registry as of **2026-11-13**. Each row is a template *shape* — leg roles with delta/DTE bands — not an enumerated variant. Variants are concrete points inside the bands, pinned to the pick-doc grid at run time.

**Pick-doc grid (fixed menu):** deltas 5–95 in steps of 5 · DTEs 7, 14, 21, 30, 45, 60, 90, 120, 180, 365 · calls and puts.

**Band conventions (decided 2026-11-13):**
- Long option legs span the **full grid** — all deltas, all DTEs. No separate LEAP templates; a LEAP is just a far point of long call/put.
- Short legs carry **low-delta** bands by convention.
- Naked short templates are included for backtest completeness; blocking them from live/paper execution is a separate mechanism (deferred).
- **Stock legs** exist: long/short the underlying at the underlying mark — no Pick Document, always resolves. This makes covered-call hybrids expressible.

## Single-leg family

| Template | Legs | Bands | Notes |
|---|---|---|---|
| Short put (CSP) | 1 short put | Δ 15–35, DTE 30–45 | covers existing `csp-45-20`, `csp-30-30` |
| Long call | 1 long call | Δ 5–95, DTE 7–365 (full grid) | covers `lc-30-20`, `lc-45-15`, and LEAP variants |
| Long put | 1 long put | full grid | symmetric counterpart |
| Short call | 1 short call | Δ 15–30, DTE 30–45 | naked — flagged for the deferred live-blocking mechanism |

## Vertical family — same option type, same expiry

Credit/debit derives from delta ordering: the higher-|Δ| leg is the pricier one; shorting it = credit, longing it = debit.

| Template | Legs | Bands | Structure |
|---|---|---|---|
| Put credit spread (bull put) | short high-Δ put + long low-Δ put | short 15–35, long 5–15, DTE 30–60 | credit |
| Call credit spread (bear call) | short high-Δ call + long low-Δ call | same bands | credit |
| Put debit spread | long high-Δ put + short low-Δ put | long 30–50, short 10–20, DTE 30–60 | debit — flipped sides |
| Call debit spread | long high-Δ call + short low-Δ call | same bands | debit |

## Condor family — 4 legs, one expiry

| Template | Legs | Bands | Structure |
|---|---|---|---|
| Iron condor | put credit spread + call credit spread | short legs 15–25, wings 5–10, DTE 30–45 | all-credit |
| Iron butterfly | short ~50Δ call + short ~50Δ put + long wings | short 45–55, wings 15–25, DTE 30–45 | all-credit, centered |

## Calendar/diagonal family — different expiry per leg

Debit structure comes from expiry, not delta ordering: long the far leg, short the near leg.

| Template | Legs | Bands | Structure |
|---|---|---|---|
| Call calendar | short near call + long far call, same Δ | near 7–30 DTE, far 45–120 DTE, Δ 15–30 | debit by expiry |
| Put calendar | same shape on puts | same | debit |
| Call diagonal (PMCC-style) | long deep-Δ far call + short low-Δ near call | long 60–80Δ @ 180–365 DTE, short 15–30Δ @ 7–30 DTE | "poor man's covered call" |
| Put diagonal | mirrored | same | debit |

## Volatility family — both option types, same expiry

| Template | Legs | Bands | Notes |
|---|---|---|---|
| Long straddle | long call + long put, both ~50Δ | Δ 45–55, DTE 30–60 | |
| Long strangle | long OTM put + long OTM call | Δ 15–25 each side, DTE 30–60 | |
| Short strangle | flipped | same bands | naked — flagged for live-blocking |

## Hybrid family — stock + option legs

| Template | Legs | Bands | Notes |
|---|---|---|---|
| Covered call | long stock + short call | call leg Δ 15–35, DTE 30–45 | stock leg marks at underlying price; always resolves |

## Example variants

Concrete points inside the bands — the unit a run resolves:

| Variant | Template | Legs |
|---|---|---|
| 20Δ/5Δ @ 45DTE | Put credit spread | short −0.20Δ put, long −0.05Δ put, both 45 DTE |
| 75Δ @ 365DTE | Long call | long +0.75Δ call @ 365 DTE (the "LEAP" case) |
| 30→60DTE 20Δ | Call calendar | short +0.20Δ call @ 30 DTE, long +0.20Δ call @ 60 DTE |
| CC 20Δ @ 45DTE | Covered call | long stock + short +0.20Δ call @ 45 DTE |

## Notes

- This is a planning snapshot, not committed schema. Bands may shift during blueprinting; the grid menu is fixed.
- Atomicity applies to option legs only — a position exists when every option leg picks on the entry date; stock legs always resolve.
- Position mark = `Σ long leg marks − Σ short leg marks` per trading day, expired option legs frozen at intrinsic settlement, through the latest option-leg expiry.
