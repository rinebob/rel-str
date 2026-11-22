**Topic:** Paper Trading Infra  
**Topic Slug:** `paper-trading`  
**Thread:** Signal Selection  
**Thread Slug:** `signal-selection`  
**Issue:** #1642  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** TEST  
**Status:** Approved  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# FE TEST — signal-selection: /signals/symbol-review pane

## Scope

- `SignalReviewStore` — queue load, bundle load + stale guard, toggle
  dispatch (mint/delete), divider computation, per-row pending/error.
- `SignalReviewService` — four `httpsCallable` wrappers + CallableName
  parity.
- `OccurrenceListComponent` / `SymbolReviewComponent` — row render,
  checkbox events, divider, error display, picker badge.
- Chart marker integration — occurrences → markers via the existing
  converter.

## E2E User Journeys

Full journeys are UAT (deployed callables). The store specs walk the
same flows against stubbed observables:

1. Open page → queue loads → pick a symbol with signals → rows render
   newest-first, divider at `previousOpenedAt` position, previously
   selected occurrences pre-checked.
2. Check an unchecked row → mint fires → row flips checked with
   `tradeId`.
3. Uncheck a checked row → delete fires → row flips unchecked.
4. Uncheck a cohort trade → delete returns `failed` → row stays
   checked, reason displayed.
5. Reopen the symbol → divider moved to the previous visit's stamp.

## Integration Tests

### Store (stubbed service observables)

- `loadQueue` → picker rows; `lastDailySignalDate > lastOpenedAt` →
  badge flag (computed or row mapping — assert the derivation).
- `selectSymbol` → bundle request with the symbol; `occurrences`,
  `previousOpenedAt`, `openedAt` stored; loading flags cycle.
- **Stale-response guard** — select A, then B before A resolves; A's
  late bundle is discarded (monotonic seq; the topic-viewer precedent).
- **Check flow** — `generatePaperSignalTrades$` called with
  `{items: [{symbol, signalBarDate, signalType}]}` built via
  `signalPickFromReviewOccurrence` (assert the pick literal — the
  field-order pin); `created`/`deduped` → `checked:true` + `tradeId`
  from `MintResult`; `error` → row unchanged + `rowErrors[sym]` set.
- **Uncheck flow** — `deletePaperTrades$` called with `{tradeIds}`;
  `deleted`/`notFound` → `checked:false`; `failed` → stays checked +
  reason surfaced.
- **Divider** — fixture: occurrences newer than `previousOpenedAt` sort
  above the divider index; `previousOpenedAt:null` → all rows "new";
  all rows older → no "new" section.
- **Divider stability across toggles** — toggling does not recompute
  `previousOpenedAt` (it's the bundle's value, not refetched).
- Concurrent toggles on different rows — independent `togglePending`
  flags; one row's failure doesn't block another's dispatch.

### Service

- Each wrapper calls `httpsCallable` with its `CallableName` literal
  and the request object verbatim; `.data` unwrapped.
- **Callable-name parity spec** — the four literals match the
  `index.ts` export names (deploy-name strings asserted directly —
  the 619 thread's convention).

## Unit Tests

### OccurrenceListComponent

- Row renders date/type/direction/status chip; `INTERIM` visually
  distinct from `CONFIRMED`.
- Checkbox reflects `checked`; emits `toggle` on click; disabled while
  `togglePending`.
- Divider element rendered at the store-provided index only when a
  "new" section exists.
- Per-row error text rendered from `rowErrors`; cleared on successful
  retry.

### SymbolReviewComponent (page shell)

- Picker lists queue rows; badge renders when the store flags
  new-since-opened; selection calls `selectSymbol`.
- Empty states: symbol with zero occurrences → empty-list message;
  queue empty → picker empty state.

### Markers

- Occurrence rows → `signal-marker-converters` input → marker set;
  checked vs unchecked marker distinction (if styled — else markers
  for all occurrences uniformly; spec whatever is built).

## Test Seams

- `SignalReviewService` stubbed in store specs (subject-based
  observables for in-flight/stale tests — topic-viewer.spec precedent).
- Component specs use stub providers per AGENTS.md (Firestore/Auth/
  Functions `useValue: {}` or the service mocked — preferred).
- Spec-local mock components use decorator `@Input()`/`@Output()` —
  AGENTS.md jest-preset-angular rule.
- Async flushes use the `setTimeout(0)` macrotask boundary (no
  `fakeAsync`/`tick` for native awaits).

## Test data / fixtures

- `SignalReviewOccurrence` fixtures: checked+tradeId, unchecked, an
  INTERIM row, a cohort-trade row (delete `failed` path).
- `GetSignalReviewBundleResponse` fixtures: multi-occurrence sorted
  list; `previousOpenedAt` mid-list / null / older-than-all.
- Queue fixtures: member with `lastDailySignalDate` newer than
  `lastOpenedAt` (badge), equal/older (no badge), absent fields.
- `MintResult` fixtures: `created`, `deduped` (with tradeId), `error`.
- `DeletePaperTradesResponse` fixtures: `deleted`, `notFound`,
  `failed:[{tradeId, error:'cohort membership…'}]`.

## Existing Test Coverage

- `topic-viewer.store.spec.ts` — the stale-guard/queue patterns being
  reused; consult for fixture conventions, don't duplicate.

## Edge Cases

- Toggle while `togglePending` on the same row → ignored/guarded.
- Bundle fetch failure → `error` state, previous bundle preserved.
- Re-selecting the same symbol → fresh bundle (stamp advances — the
  divider legitimately moves; spec confirms intent, not a bug).
- Row checked via mint `deduped` — row still flips checked (re-mint of
  an existing deterministic trade is a join, not an error).

## Verify relay

- `npx jest --coverage=false` — all new specs in the repo suite
- FE `tsc --noEmit`
- `CallableName` parity spec green
- UAT doc (thread-level, accumulating): `/signals/symbol-review`
  reachable from Signals nav; real member symbol; check → trade in
  `/trading/paper` ledger; uncheck → removed; divider persists.
