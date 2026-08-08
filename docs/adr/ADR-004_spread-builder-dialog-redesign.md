# ADR-004: Spread Builder Dialog — Parametric Template + Catalog Picker

## Status

Accepted

## Context

The initial Spread Builder dialog (shipped in Topic #77) uses a single-column form with per-strike dropdown selectors. Each spread requires manually selecting spread type, option type, expiration, and individual strikes from scroll-only dropdowns that load all available strikes and expirations. For symbols like SPY with thousands of contracts, this is extremely labor-intensive.

The primary workflow the dialog must support is **comparing the same spread structure across many expirations** — e.g., a vertical debit spread with ATM long strike, fixed strike width, and a target contract length, repeated across entry dates to observe how the spread price behaves relative to the underlying over time. The current UI requires fully re-entering every field for each variant.

## Decision

Redesign the spread builder dialog as a **three-column wide dialog** with a **parametric spread template** driving a **catalog picker** for leg selection.

### Layout

Three columns in a wide Material dialog (~1200px+):

| Column | Content |
|---|---|
| Left | Filters (chart date range, strike range, length bucket) + catalog table (filtered contracts) |
| Center | Spread form (type, option type, entry date, strike distance, strikes, expiration, debit/credit badge) + Add to List + Advance buttons |
| Right | Built-spreads table (working buffer) + named list controls (dropdown, New/Save/Save As, Clear, dirty indicator) |

### Data model: Working Buffer + Named List (hybrid)

- **Working Buffer** — in-memory `SpreadDefinition[]` in the root-provided `SpreadViewerStore`. Persists across dialog open/close. Source of truth for "Load to chart."
- **Named List** — persisted in Firestore `spread-lists/{listId}`. Open populates the buffer; Save / Save As persist the buffer back.
- **Dirty state** — derived by comparing buffer against a `lastSavedSnapshot` in the store. Dirty indicator in the dialog top bar. Close-with-unsaved prompt.
- **Load and Save are independent** — Load sends the buffer to the chart; Save persists to Firestore. No forced save-before-load.

### Parametric template

The form defines a spread structure once. Fields:
- Spread type (vertical, straddle, strangle, iron condor, custom)
- Option type (vertical only)
- Entry date (date picker, non-trading days disabled from underlying bars)
- Strike distance (auto-computes secondary strikes from primary)
- Contract length bucket (filters catalog query)

The template narrows the contract catalog. The user picks actual legs from the catalog — no silent "nearest available" guesswork. Auto-filled values are suggestions, always editable.

### Catalog picker

Uses the existing `queryContractCatalog` callable with:
- `symbol` — from store
- `firstObservedGte` / `firstObservedLte` — **new backend params** (entry date ± window)
- `strikeGte` / `strikeLte` — from strike range fields
- `contractLengthBucket` — from length bucket dropdown
- `type` — from option type field

Table displays: type, strike, expiration, contract length bucket, first observed date, observation count. Clicking a row populates the form's expiration + strike fields. The catalog table is sorted by first-observed date.

### Advance workflow

"Advance 1 Day / 1 Week / 1 Month" buttons move the entry date forward, update the underlying price display, and scroll the catalog table to the contract closest to the new entry date and underlying price. The user reviews the auto-scrolled position and clicks "Add to List" manually — no auto-add without review.

### Strike distance auto-scroll

When the user picks the long leg from the catalog, the table auto-scrolls to the row at `long strike + distance` (or `− distance` depending on direction) to surface the second leg.

### Underlying data

Keep `RsBarsService.getDailyBars$` (calls `getPairDailyBars` callable) for now. Fetch the full dataset on symbol set, keep in memory, filter client-side to the chart date range. **Tech debt**: migrate to Firestore `symbol-data` (internal data, no SA dependency) in a separate topic.

### Density

Dialog-scoped CSS density overrides (Material component sizing variables scoped to `.spread-builder-dialog` wrapper class). No global theme change. Full design system deferred to a future topic.

### Buffer persistence

The `SpreadViewerStore` is `{ providedIn: 'root' }` — the working buffer already persists across dialog open/close. Add `selectedListId` and `lastSavedSnapshot` to store state so the named-list context and dirty indicator also persist.

## Rationale

- **Catalog picker as primary** eliminates the "nearest available" resolution problem. The user sees exactly what contracts exist and picks the real one. The parametric template narrows the catalog to a manageable set; the user makes the final choice.
- **Working buffer + Named List hybrid** matches how creative work flows: open a list as a starting point, experiment freely, save when happy. Decouples visualization (Load) from persistence (Save).
- **Advance buttons** serve the core "compare across expirations" workflow — move forward in time, see the new contracts, review, add. Two clicks per spread instead of full form re-entry.
- **Strike distance** preserves the spread structure across clones — change the long strike, the short auto-follows. One field edit per clone.
- **Contract length bucket** replaces DTE as the time-span filter. DTE is derived per-spread after selection (`expiration − entryDate`), not an input. Avoids the approximate mapping between bucket labels and exact DTE.
- **`firstObserved` filter** is necessary because the workflow is entry-date-driven, not expiration-driven. Filtering by expiration date would return contracts with the right expiration but wrong listing date.

## Consequences

- **Backend change**: `queryContractCatalog` callable gains `firstObservedGte` / `firstObservedLte` parameters. Small additive change, follows the existing `expirationGte` / `expirationLte` pattern.
- **Store changes**: `SpreadViewerState` gains `selectedListId`, `lastSavedSnapshot`, chart date range, entry date, strike range, length bucket. Underlying bars fetch changes from hardcoded 730-day window to full dataset + client-side filter.
- **Dialog size**: ~1200px+ wide. Acceptable for a power-user tool on a 1920px screen. Material dialog `maxWidth` and `width` overrides required.
- **Density**: dialog-scoped CSS overrides. If the density feels right, the overrides can be extracted into a reusable mixin for other dense UIs.
- **Tech debt**: `RsBarsService` SA dependency documented. Migration to Firestore `symbol-data` deferred to a separate topic.
- **Deferred from this refinement**: asymmetric iron condor wings (second distance field), auto-select best match on advance (keep simple for v1), full design system, FE test files, backtest plotting mode, gap date UI rendering.

## Future Work

- **PriceBarService refactor**: Extract a clean app-wide service in `src/app/core/services/` that reads from Firestore `symbol-data`, returns `OHLCDatum[]`. Migrate `RsBarsService` callers. Tracked as tech debt.
- **Full design system**: Replace dialog-scoped density overrides with a proper M3 custom theme including density configuration. Separate topic.
- **Asymmetric iron condor wings**: Second strike distance field for independent put-wing and call-wing widths.
- **Advance auto-select**: If scroll-to-highlight (B) proves insufficient, upgrade to auto-select best match with one-click add.
