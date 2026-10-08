# UAT — FE: Gallery card chart D/W toggle + action row above chart (#819)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #840  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #819  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Scope

Header **Chart D/W** pills decoupled from the signal-timeframe filter;
per-card D/W chip with header re-sync (incl. same-value clicks); weekly
bars lazy-load; card occurrence dots filtered to the *chart* interval via
`allOccurrences`; ±50 visible-bar chips; ST StdDevLines on both intervals;
action toolbar (Trade / Reject / Paper / Chart) above the chart cell;
220-day bar lookback; card-identity retention; viewport-aware chart
unmount. Round 2 added: leaf-injected `GalleryUiStore`, canonical
`allOccurrences` readers, cache-epoch guards, `enterGallery` cache clear.

## Prerequisites

- `npm start` dev server, logged in, RH-less (gallery reads Firestore only).
- A completed signal run with ≥ several signal symbols — ideally a mix
  covering both daily and weekly signal occurrences.
- Browser devtools open (Network tab) for the lazy-fetch scenario.

## Start

1. `npm start` → open `http://localhost:4200/dev/gallery`.
2. Wait for cards to load (skeleton → grid).

## Scenarios

1. **Header Chart D/W switches every card, not the filter.**
   Start: page loaded, header Chart = D.
   Steps: click **Chart W** in the header.
   Expected: every card's chart re-renders on weekly bars; the card list
   itself does not change (same symbols, same occurrence rows — the signal
   D/W filter is untouched). Click **Chart D** — all cards return to daily.
   Result: ___

2. **Per-card D/W chip overrides; header re-syncs — incl. same-value click.**
   Start: header Chart = D.
   Steps: click **W** on one card's chart (top-right chip cluster). Confirm
   only that card flips. Then click header **Chart D** — the already-active
   pill — and confirm the overridden card snaps back to D.
   Expected: per-card override respected until ANY header Chart click.
   Result: ___

3. **Weekly chart renders the weekly stack.**
   Start: a card showing W (via chip or header).
   Expected: weekly bars (one candle per week), monthly HTF zone window,
   weekly signal/uptick dots, card occurrence dots on weekly bars only.
   Result: ___

4. **Occurrence dots follow the chart interval, not the filter.**
   Start: signal filter = D (default); a card with a weekly occurrence row
   (W chip in its occurrences list).
   Steps: flip that card's chart to W.
   Expected: the weekly occurrence gets a dot on the weekly chart — the
   hidden leg still dots (`allOccurrences` pipeline).
   Result: ___

5. **±50 chips adjust the visible window per card.**
   Steps: click `+50` on a card — the chart window widens; click `−50` —
   narrows; repeat `−50` — disables at the 30-bar floor; `+50` disables at
   the loaded-bars ceiling.
   Result: ___

6. **ST StdDevLines renders on both intervals.**
   Steps: on a card with enough history, look for the center line +
   deviation bands overlay on D; flip to W — bands still present.
   Result: ___

7. **Action toolbar sits above the chart cell.**
   Expected: Trade / Reject / Paper / Chart buttons render between the
   occurrences list and the chart; clicking Trade opens the ticket dialog.
   Result: ___

8. **Weekly bars fetch lazily.**
   Start: fresh page load, Network tab filtered to `weekly`.
   Expected: no weekly bar reads while all charts stay D; on the first W
   flip, one `weekly/all` doc read per symbol.
   Result: ___

9. **Interval-scoped failure.**
   (Hard to force live — code path verified by spec; observe only if a
   weekly fetch happens to fail.) Expected: W shows "chart unavailable"
   while D still renders, and vice versa.
   Result: ___

10. **Refresh clears the bar cache and re-fetches.**
    Steps: click header **Refresh** (same run). Expected: charts show the
    loading state, then re-render with refetched bars — no permanent
    placeholder, no stale bars; grid/filters intact. Watch for a visible
    stall (epoch clears all bars at once — charts re-pace through the
    mount queue).
    Result: ___

11. **Per-card D/W override survives a Refresh.**
    Steps: set one card to W; click header **Refresh**. Expected: card
    still shows W after refresh (overrides only reset on a Chart click).
    Result: ___

12. **Scroll unmount/remount.**
    Steps: scroll ~1 viewport past a card, scroll back. Expected: chart
    remounts from cache near-instantly, same interval and bar window;
    no flicker churn near the fold (600px margin).
    Result: ___

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Header D/W switches charts, not the filter | 1 |
| Per-card override + header resync incl. same-value | 2 |
| Weekly stack (bars, monthly HTF, weekly dots) | 3 |
| Card dots follow chart interval (allOccurrences) | 4 |
| ±50 window, floor 30 / loaded-bars cap | 5 |
| StdDevLines both intervals | 6 |
| Toolbar above chart | 7 |
| Weekly bars lazy | 8 |
| Interval-scoped error isolation | 9 |
| Epoch / refresh re-ensure (#819 r2) | 10 |
| Override survives refresh (intended) | 11 |
| IO unmount/remount, no fold churn | 12 |

## Regression checklist (nearby behavior)

- [ ] Card meta rows (price + change · exchange · tier · β · P/E; sector · industry) unchanged
- [ ] Flat/None grouping (#820) unaffected by any of this
- [ ] Reject/Restore status transitions still work mid-session
- [ ] Rejected occurrences still dot the chart — adjudicate: keep or suppress (review flag)
- [ ] Rapid header Chart clicking never strands a card on a stale interval (`chartTimeframeSeq`)

## Results log

Executed 2026-10-07 against the live dev server (`/dev/gallery`), user-verified:

- Scenarios 1–4 (D/W toggle, per-card override, weekly stack, allOccurrences
  dots): **PASS** — user confirmed on the live page.
- Scenarios 5–7 (±50 chips, StdDevLines both intervals, toolbar above chart):
  **PASS** — user confirmed.
- Scenarios 8–12 (lazy weekly fetch, Refresh epoch re-fetch + re-pacing,
  override survives Refresh, scroll unmount/remount without fold churn):
  **PASS** — user confirmed.
- Scenario 9 (interval-scoped failure): **PASS by spec** — no live failure
  path available; component specs cover both isolation directions.
- Regression checklist: **PASS** — meta rows correct (incl. the new
  price+change row from #860-era tweaks), Reject/Restore works, rapid
  header Chart clicks never strand a card (`chartTimeframeSeq`).
- Adjudication: rejected occurrences **keep** their chart dots —
  card context, not actionability.
- Automated: `npx jest gallery` — 223/223 green at QA time (incl. new
  price-row and symbol-overlay specs from post-review tweaks).
