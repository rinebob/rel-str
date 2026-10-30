**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1335  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1337  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — FE-1: Generator utils + per-symbol persistence

## Verdict: PASS

All findings fixed during review and re-verified (31/31 focused specs).
Full suite green: 4,845 tests / 281 suites.

## Standards

- **Contract baseline PASS** — the shared `ContractAvailability*` block
  matches the SA-confirmed contract verbatim (field names, optionality,
  `truncated` required, `corpusDates` optional).
- Fixed: availability block moved to file end (it had split the catalog
  request from its response types); IMPL doc corrected — settings lives in
  `utils/`, not `services/`; `isInvertedRange` helper delivered (the IMPL
  promised it) and now shared by the settings sanitizer.
- Nits fixed: sanitizer helper names kept terse but the duplicated
  `strFields`/`numFields` loops collapsed into `copyAxisFields`; `as string`
  casts replaced with bound consts.

## Spec

- All FE-1 criteria met: `toAvailabilityQuery` (explicit expirations
  override range, `firstObserved*` boundary naming), `refineContracts`
  (full axis parity + alive-across-range), `toPairLines` (`date,id`/bare,
  endpoint-order sort), `rs-optgen:{SYMBOL}` versioned blob, openDate
  structurally unpersistable.
- Confirmed scope: store/service (FE-2), drawer (FE-3), brush (FE-4)
  coverage correctly belongs to later tasks.
- Fixed: whitespace-only refine `expirations` no longer nukes the set
  (mirrors the wire path's trim+filter); `strikeStep: 0` no longer goes on
  the wire; `saveGeneratorSettings` pins `version` so a caller-crafted bad
  version can't persist.

## Thermo-nuclear

- Two majors, both fixed: the whitespace-only refine list (silent data
  loss) and `strikeStep: 0` wire/refine semantic divergence.
- Minors fixed: `str()` now trims; symbol keys normalize (`' qqq '` ==
  `'QQQ'`); `isInvertedRange` shared rather than inlined; header's "pure
  functions" claim corrected.
- Accepted nits: query-vs-refine type vocabulary split (`C|P|BOTH` vs
  `call|put`) mirrors wire-vs-response contracts — commented; the AND-chain
  predicate list noted as a future predicate-table refactor candidate, not
  required now.
- Tests assessed clean: external-behavior assertions, typed `record()`
  factory, real jsdom `localStorage`, no type-erased fixtures, no
  no-asserts, no setTimeout.
- Test gaps closed: whitespace refine list, `strikeStep:0` wire, symbol
  case normalization, `isInvertedRange` truth table, wrong-version save,
  throwing-storage degradation.

## Test results

- Focused: 31/31 (utils + settings specs).
- Full suite: 4,845/4,845, 281/281 suites.
- `tsc --noEmit`: only 3 pre-existing errors in unrelated files
  (`scripts/bulk-swing-sweep.ts` ×2, `indicator-config-dialog.component.ts`).

## Second pass (post-fix audit)

A full re-read of the post-fix code found no new findings requiring change.
Accepted residuals: `copyAxisFields`' internal cast (safe-by-construction
boundary sanitizer), `sanitizeQuery` keeps inverted blob ranges (loads →
visible endpoint 400 beats silent drop), `strList` stores untrimmed entries
(consumers trim at use). Verdict unchanged: **PASS**.
