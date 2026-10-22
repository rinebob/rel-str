**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #996  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1016  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# CODE REVIEW — #1016 review-list UI removal

## Verdict

**PASS** — two remediation rounds. Round 1 resolved two majors (thermo
axis); round 2 re-ran all three axes, verified every remediation, and
resolved the remaining minors. No new majors in round 2.

## Round 2 (all three axes — no new majors)

**Standards:** all 9 round-1 items verified landed. New minors, all fixed:
- Stale jsdoc "status to REVIEW" on `signal-review.component.ts:117`
  `onMarkForReview` → honest session-local wording; matching stale section
  header in `chart-review.component.ts` updated.
- Spec mock provided `unlistedSymbols` but the service reads
  `untriagedSymbols()` — both mocks renamed to the consumed member.
- Unmarked dead template branch `chart-review.component.html` (`@if
  viewportMode === 'signals'` metrics strip) got its `#1016` marker.

**Spec:** all 8 acceptance checks PASS (zero live review-list refs, rules
ACL gone, pin spec asserts non-reintroduction, static `disabled` on all
five controls, ALL-union fix correct, session-local store coherent,
remaining `reviewSymbols` consumers intentionally inert). New minors:
- "Queued for review" label rendered on every browsed symbol → mode-aware
  (`'signals' ? 'Queued for review' : 'From list'`).
- signals+ALL branch (returns `reviewSymbols` — retained semantics)
  unpinned → spec case added.

**Thermo-nuclear:** both round-1 majors + all minors verified; verdict
"approve". One substantive new minor, fixed:
- `selectedSymbolStatus` fed only durable `occurrenceStore.statusForSymbol`
  (ACCEPT/REJECT/PENDING), so the still-live Watch button's
  `[class.selected]="status() === 'WATCH'"` could never light. Now falls
  back to `triageStore.screeningStatuses()[symbol]` when no durable
  decision exists — Watch shows its selected state.
- `'ALL'` made mode-aware (`signals` → `reviewSymbols`, `browse` → union)
  so the retained queue semantics stay correct if re-enabled.

Deferred per scope discipline (trivia on intentionally-retained
scaffolding): `signal-list.component.html` "Enter a symbol above to
review" empty-state copy; commented persistence blocks that can't
recompile verbatim; `setScreeningStatus` not uppercasing (all callers
pass normalized symbols).

**Round-2 verification:** focused suites 62/62 pass (viewport spec now 3
tests incl. signals+ALL pin); `tsc` clean on touched files.

## Round 1

## Scope

Task: remove all FE readers/writers of `savant-trader/data/review-list` and
any functional "needs review" UI. **User scope override** (recorded during
implementation): keep the Signal Review and Chart Review pages intact —
disable unsupported controls, comment out the broken persistence code,
retain the page scaffolding for future repurposing. The literal test-plan
line "no dead needs-review UI visible" is therefore satisfied as
"visible-but-disabled with `#1016` markers", not "removed".

## Files changed

- `core/common/constants.ts` — `Collection.ST_REVIEW_LIST` removed
- `services/triage.service.ts` — **deleted** (sole review-list reader/writer)
- `index.ts` — `TriageService` export removed
- `stores/triage.store.ts` — inject + all persistence calls removed;
  `loadReviewFlags`/`reviewFlagsLoading`/`reviewFlagsError`/`loading`
  deleted outright (double dead code); `markForReview` no longer
  dual-writes `screeningStatuses[REVIEW]`; `markGroupForReview` now
  normalizes symbols (`toUpperCase`); `viewportMode` initial → `'browse'`
- `stores/group.store.ts` — `loadReviewFlags()` call → breadcrumb comment
- `services/chart-review-viewport.service.ts` — `'ALL'` filter now unions
  every list's members (was the flagged queue → permanently empty)
- `services/chart-review-viewport.service.spec.ts` — ALL-branch
  expectation rewritten + union/dedupe case pinned
- Disabled controls (static `disabled` + `#1016` comment): flag button
  (`symbol-acr-actions`), Review pill + clear-flags (`signal-review-header`),
  viewport toggle + new-symbols (`review-header`)
- `review-header.component.ts` — `viewportMode` input default → `'browse'`;
  toggle tooltip no longer promises a click action
- `#1016` breadcrumbs on retained dead chains: `signal-review.facade.ts`
  (`markForReview`, `clearReviewFlags`), `chart-review.component.ts`
  (`addSymbolsToReview`, `toggleViewportMode`)
- `firestore.rules` — `savant-trader/data/review-list` ACL removed; the
  global `match /{document=**}` deny at :601 makes no-match airtight
- `docs/DATA-MAP.md` — live-collection row marked removed-in-#1016 (data
  pending #1013); merge-candidate bullet updated
- Specs: `triage.store.spec` (session-local semantics; `resetForRun` now
  sets a flag before asserting survival); `group.store.spec` (dead
  `loadReviewFlags` mock removed); `st-path-cutover-1014.spec`
  (`ST_REVIEW_LIST` moved into the retired-members assertion)

## Axis 1 — Standards (code-review skill)

**No hard violations.** Findings and disposition:

| Finding | Disposition |
|---|---|
| `loadReviewFlags` no-op defended by false "call sites compile" comment | Fixed — method, dead loading state, commented call, and spec mock all deleted; `group.store` keeps a breadcrumb |
| `reviewFlagsLoading`/`reviewFlagsError`/`loading` consumerless | Fixed — deleted with the load path |
| `markForReview` wrote `REVIEW` into the CONSIDER/WATCH-only `screeningStatuses` | Fixed — dual-write dropped; spec now pins "does not write a screening status" |
| Vacuous `resetForRun` spec (asserted empty flags without setting one) | Fixed — test now flags a symbol then asserts it survives a run switch |
| `markGroupForReview` missing `.toUpperCase()` (pre-existing asymmetry) | Fixed |
| `review-header.component.ts` input default `'signals'` contradicted store default | Fixed → `'browse'` |
| Missing `#1016` breadcrumbs on retained dead chains | Fixed (facade + chart-review component) |
| Disabled toggle tooltip promised "click for signals only" | Fixed — static disabled message |
| `DATA-MAP.md` "data deleted in #1013" implied completion | Fixed → "data pending #1013 deletion" |

## Axis 2 — Spec (IMPL §review-list + TEST plan)

**Persistence removal — complete.** Verified: no `Collection.ST_REVIEW_LIST`,
`triage.service.ts` gone, zero live `TriageService` imports, rules ACL
removed, no `savant-trader/data/review-list` literal in `src/`, group.store
reload call gone, DATA-MAP updated.

**UI removal — complete under the override.** All disabled controls use
static `disabled` attributes so handlers cannot fire. The literal "no
visible needs-review UI" is intentionally overridden — controls remain
visible-but-disabled per the user's repurpose directive.

**Behavior gap found and fixed:** `ChartReviewViewportService` `'ALL'`
branch returned `reviewSymbols` — permanently empty after flag-removal,
leaving the chart-review sidebar dead in browse mode (the default). Now
unions every list's members; spec rewritten to pin the union semantics.

Retained-but-unreachable chains (intentional, breadcrumbs added):
`SignalReviewFacade.markForReview`/`clearReviewFlags`, `TriageStore`
mutators, `'signals'` viewport branches + metrics strip, `isReviewed` row
field, `ReviewDecision.REVIEW`/`StatusCounts.REVIEW`.

## Axis 3 — Thermo-Nuclear

Verdict: **approve after resolving two majors** — both resolved.

- **MAJOR (resolved):** `loadReviewFlags` was self-defending dead code —
  its only call site was itself commented out. Deleted method, call-site
  comment → breadcrumb, spec mock.
- **MAJOR (resolved):** `'ALL'` branch ignored mode — same fix as the spec
  axis finding above (union of list members).
- **MINOR (resolved):** REVIEW dual-write into `screeningStatuses` — dropped.
- **MINOR (resolved):** dead loading state — deleted.
- **MINOR (resolved):** stale DATA-MAP bullet, vacuous spec, misleading
  tooltip.

Not issues: commented persistence blocks (honest markers under the
disable-not-delete directive; they will never recompile verbatim since the
service is deleted — deletion is defensible but not required); inert
`ReviewDecision.REVIEW`/`statusCounts.REVIEW` retention consistent with the
directive.

## Test results

- Full suite (`npx jest`): **257 suites / 4,372 tests — all pass**
  (pre-remediation run; no spec-asserted behavior changed by remediation
  except the deliberately rewritten viewport test)
- Post-remediation focused run: **56/56** across `triage.store.spec`,
  `group.store.spec`, `chart-review-viewport.service.spec`,
  `st-path-cutover-1014.spec`, `signal-review.facade.spec`
- Earlier wider run (pre-remediation): 289/289 including
  `signal-review.component.spec` and `utils.spec`
- `tsc --noEmit` clean on all touched files (3 pre-existing errors in
  untouched `bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts`)
- `git diff --check` clean (LF/CRLF warnings only)

## Manual verification for QA

- Signal Review: Review pill greyed at "Review 0"; flag button disabled
  on symbol rows; clear-flags button disabled.
- Chart Review: opens in browse mode; sidebar populated (ALL = union of
  list members, no longer the empty flagged queue); viewport toggle and
  new-symbols button disabled.
- `firestore.rules` change deploys with the next `firebase deploy --only
  firestore` — deny-by-default covers review-list until #1013 deletes data.
