**Topic:** Watchlist management  
**Thread:** Unified list infrastructure  
**Task:** #527 — FE-IMPL: RhSelectMenu option groups + generic option typing  
**Reviewed:** 2026-09-23  
**Last Updated:** 2026-09-23  
**Status:** Complete  
**Verdict:** PASS (fixes applied in-gate)

## Axes

### Spec — PASS (all 4 ACs, after wiring fix)
1. `RhSelectMenu` renders group headers between sections — `optionGroups` +
   disabled `rh-menu-group-header` items; spec-verified.
2. Generic-typed options; no consumer `string → SymbolListFilter` casts —
   `RhSelectOption<T>`/`RhSelectOptionGroup<T>`/`RhSelectMenuComponent<T>`;
   review-header's `onListPicked` cast deleted, signal-review header emits
   typed. Remaining cast: `symbol-nav`'s native `<select>` boundary
   (unavoidable, #528 retires that control).
3. One 'show everything' sentinel — `'ALL'` everywhere; `SymbolListName.NONE`
   deleted (triage store, viewport service, review-header default migrated).
4. Grouped `filterOptionGroups` computed — Triage (exclusive in catalog
   order + Not-triaged) then My lists (nonexclusive incl. Monitor), hidden
   excluded, empty group omitted.

### Standards — PASS after fixes
- `filterOptionGroups` was dead code (no `[optionGroups]` consumer) →
  **wired**: review-header + signal-review-header now bind sentinel via
  flat `options` + catalog via `listGroups` input (chart-review page,
  facade passthrough). `SYMBOL_LIST_FILTER_OPTIONS` remains only for
  symbol-nav until #528.
- `(string & {})` widening verified idiomatic; no exhaustiveness breakage.
- `RhSelectMenuComponent<T>`: template inference is nominal (all T are
  string-like) — the generic is a contract for option authors, noted.

### Thermo-nuclear — PASS after fixes
- Flat-first template change safe (no consumer bound both inputs;
  observation-tool binds groups only).
- No persisted 'NONE' path (filters are in-memory only).
- **Cross-store gap fixed**: `deleteList` reset the list store's
  `activeListFilter` but not `TriageStore.activeViewportList` — viewport
  would go silently empty on a deleted key. `viewportSymbols` now falls
  back to show-all when the key isn't in `byKey` (previews #528's
  deleted-list fallback).
- Blank `activeLabel` for unknown values noted as accepted.

## Fixes applied during review

| Fix | Where |
|---|---|
| `filterOptionGroups` wired into both header dropdowns (sentinel flat + groups) | review-header, signal-review-header, chart-review.html, signal-review.html, facade |
| Deleted-key viewport fallback (`byKey` miss → reviewSymbols) | chart-review-viewport.service |
| Stale spec comment + unnecessary `as SymbolListFilter` casts dropped | store spec |
| Menu spec verifies flat-before-groups order + disabled headers + typed emit | rh-select-menu spec |

## Deferred / notes
- Nav `<select>` keeps static `SYMBOL_LIST_FILTER_OPTIONS` — #528 scope
  (grouped `<optgroup>` or menu migration + enum retirement).
- `activeLabel` blank for deleted keys — cosmetic, superseded by #528.
- Generic `T` doesn't infer from bindings — accepted; contract is at the
  option-array level.
- Pre-existing mojibake in spec/comment lines (utils.ts:611,
  chart-review.component.ts:300, store spec header) — separate cleanup.

## Verification
- Focused: 20 tests (menu spec + store spec) green.
- Feature suite: 70 suites / 1270 tests green.
- `tsc --noEmit` clean on touched files (3 pre-existing unrelated errors
  in indicator-config-dialog + bulk-swing-sweep).
