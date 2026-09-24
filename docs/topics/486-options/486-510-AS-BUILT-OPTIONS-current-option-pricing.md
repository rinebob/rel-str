# As-Built — Topic #486: Current option pricing

**Topic:** Current option pricing
**Topic Slug:** `current-option-pricing`
**Thread:** Today's option pricing view
**Thread Slug:** `today-option-pricing-view`
**Issue:** #510 (QA)
**Thread Parent:** #487
**Topic Parent:** #486
**Domain:** OPTIONS
**Type:** AS-BUILT
**Status:** Complete
**Created:** 2026-09-24
**Last Updated:** 2026-09-24

## What was built

A current/historical option-chain page at `/savant-trader/option-chain` —
expirations as columns, strikes as rows, calls left / puts right — using
the pct-change grid's visual form but showing the session's chain
(current prices, volume, open interest), not percent changes.

### Phase 1 — Scaffold + data spine (#493)

- Route + page skeleton + nav entry (#497).
- Session resolution (`session-resolution.utils.ts`): "today" = most
  recent completed PT session; pre-1 PM PT starts from the prior trading
  day; walks back skipping weekends, capped at 7 days (#498).
- `OptionChainStore` (NgRx SignalStore): resolves the session, fetches
  session + prior-day contracts, carries `SessionFetchError` so errors
  name the actually-failed date (#499).

### Phase 2 — Grid (#494)

- `ChainGridComponent` — CSS-grid scroller with sticky expiration
  headers and sticky strike row headers; ATM row highlight; cell states
  (ITM, top-5, delta/time shading, heatmap) (#500).
- CALLS / PUTS / BOTH layouts with per-side strike orientation toggles
  (calls default desc, puts default asc — OTM-at-top in opposite mode)
  (#501).

### Phase 3 — Interactions + polish (#495)

- `DelegatedCellHover` + `ChainCellPopupComponent` contract popup;
  keyboard/screen-reader paths via delegated click + focusin/out (#502).
- Filter panel (|Δ| and strike bounds, shading toggles), header
  (symbol, company info, underlying session/prior close + %, session
  date, source), manual date entry + MatDatepicker + Today, empty/error
  states, per-symbol column picker persisted to localStorage (#503).
- **Scroll sync:** absolute-from-baseline — `sibPos = sibBaseline +
  (srcPos − srcBaseline)` recomputed per scroll event; boundary clamps
  self-heal and echo writes are no-ops (no suppression bookkeeping).
  `ChainGridComponent.centered` output re-anchors both panes on any
  auto-center; Re-sync centers each pane on its own ATM. `scrollToStrike`
  locates rows by `[data-strike]` attr + rects — immune to
  sticky/offsetParent coordinate mixing.

## Architecture decisions

- **Two panes, not one grid** — kept after weighing a single merged
  grid; the baseline-sync mechanism made the two-pane model work.
- **Opposite orientation = mirrored distance-from-ATM** — both
  scrollbars move the same direction; up = more OTM on both sides.
- **DTE-band column model** (`column-visibility.utils.ts`) — band ids
  persist, membership recomputes per session so selections track DTE
  windows, not fixed dates; per-expiration overrides win over band
  defaults. Moved out of the shared `option-grid.utils.ts` (feature-local).
- **`.date-anchor` pattern** — rendered-but-invisible input carries the
  `matDatepicker` association; a visible picker input would reformat
  ISO text via the locale adapter and parse as UTC midnight (off-by-one).

## Deviations from spec

- Default `|Δ| ≤ 0.6` band removed at user request — ships unbounded.
- Contiguous expiration from/to inputs replaced by the DTE-band +
  per-expiration picker (superset of the spec's capability).

## Review / QA trail

- Review docs: `486-491-{497..503}-CODE-REVIEW-OPTIONS-…` — all PASS.
- QA issue #510 — RESOLVED; per-task PASS lines for #497–#503.
- Final state: full Jest suite 132 suites / 1812 tests green.
