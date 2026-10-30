**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1335  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1338  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

# Code Review — FE: Availability service + generator store

**Task:** #1338 — FE: Availability service + generator store  
**Blueprint:** #1335 — FE Blueprint: OCC group generator drawer  
**Verdict:** PASS (all findings fixed in-gate and re-spec'd)

## Scope

Working tree is heavily dirty with unrelated work — review scoped to the
task's files only:

- `src/app/core/common/constants.ts` (added `QUERY_CONTRACT_AVAILABILITY`)
- `src/app/features/savant-trader/services/contract-availability.service.ts` (new)
- `src/app/features/savant-trader/stores/option-group-generator.store.ts` (new)
- `src/app/features/savant-trader/stores/option-group-generator.store.spec.ts` (new)

## Axes

### Standards — CHANGES REQUESTED → resolved

- **MAJOR:** `clear()` didn't bump `runSeq` — an in-flight run's response
  could repopulate cleared results (matched `setSymbol`'s invalidation
  precedent). **Fixed.**
- **MINOR:** error path left stale `corpusDates`/`truncated`/`lastEmitted`
  attached to a failed state → error patch now reuses `clearResults()`.
- **MINOR:** `query$` too generic for house convention → renamed
  `queryContractAvailability$` (mirrors `queryContractCatalog$`).
- **MINOR:** dead spec imports (`loadGeneratorSettings`, `flush`) removed;
  fixture magic literals → `GENERATOR_SETTINGS_PREFIX`/`_VERSION`.
- **NIT (accepted):** `run`/`emit` names kept — they are the IMPL doc's
  names verbatim; docblocks describe the verbs.
- Verified clean: no `as any`/index-signature hiding, RxJS and NgRx
  idioms identical to `options-contract.service.ts` /
  `plotted-contracts-feature.ts` / `scanner.store.ts` precedents; spec
  hygiene per AGENTS.md.

### Spec — PASS

- All six task ACs and every IMPL §FE-2 bullet MET with line evidence.
- TEST-FE mapping correct: store+service, store+settings, refine-without-
  refetch, stale-guard all covered; page wiring/brush cases correctly
  deferred to FE-3/FE-4.
- Flags adopted in-gate: `clear()` runSeq (the major), `hasRun` marker
  added (FE-3 needs never-ran vs ran-empty), callable-name coupling
  flagged for #1336.
- **Naming deviation (accepted):** IMPL says `option-group-generator-
  feature.ts`; shipped as `.store.ts` — the dominant directory
  convention (~25 stores vs 4 feature files). IMPL updated below.

### Thermo-Nuclear — 1 real defect → resolved

- **MAJOR:** same `clear()`/`runSeq` resurrection defect. **Fixed + spec'd**
  (clear-during-flight discards late response).
- **MINOR:** persisted toggle+range restored without `openDate` (invariant
  broken across reload) → `setSymbol` backfills `openDate` when the saved
  blob has `useRangeAsOpenDate` + `aliveRange`.
- **MINOR:** `persist()` could write a junk `rs-optgen:` blob before
  `setSymbol` → now early-returns on empty symbol.
- **MINOR:** `applyRange` aliased the caller's `StudyRange` and accepted
  empty bounds → stores a trimmed copy; empty/inverted rejected.
- **MINOR:** `res.ok === false` body would read as successful-empty →
  treated as an error (wire contract pending #1336; cheap guard).
- **NITs accepted:** no service-level spec (thin wrapper precedent);
  `run()` snapshot-vs-edit semantics documented; `applyRange(null)`
  keeps `openDate` (independently editable field).
- Spec gap noted by the axis → added: clear-during-flight, overlapping
  same-symbol runs (last-wins), empty-bound rejection, toggle-restore.

## Verification

- Focused: 20/20 specs pass (`option-group-generator.store.spec.ts`).
- Full suite: **282 suites / 4,866 tests — all PASS.**
- `tsc --noEmit`: only the 3 known pre-existing errors in unrelated files
  (`scripts/bulk-swing-sweep.ts` ×2, `indicator-config-dialog.component.ts`).

## Accepted residuals

- Callable name `queryContractAvailability` is an FE-side inference —
  #1336 must export the callable under that name (or it's a one-line
  change in `constants.ts` + the service). Flagged on the BE task.
- `records` kept during loading (no flicker), cleared on error — the
  error UI dominates that state.
- `applyRange(null)` leaves `openDate` untouched — the field is
  independently editable by design.
- `setSymbol('')` reads a prefix-only blob key — unreachable in practice.

## IMPL drift

- IMPL §FE-2 filename updated: `option-group-generator-feature.ts` →
  `option-group-generator.store.ts` (as-built).

## Second pass (post-fix audit)

Full re-read of the post-fix store found no new findings requiring change.
Verified: the `ok:false` throw precedes the stale check but re-checks in
`catch` (superseded runs still patch nothing); `hasRun` resets via
`clearResults()` on both `setSymbol` and `clear`; the mojibake introduced
by a bulk spec rename was found and repaired. Accepted residuals:
`applyRange` trusts typed `StudyRange` bounds (`.trim()` would throw on a
JS-land bad call — typed callers only), `hasRun` sets on error ("a run
completed"), same-symbol `setSymbol` won't reload a hand-edited blob.
Verdict unchanged: **PASS**.
