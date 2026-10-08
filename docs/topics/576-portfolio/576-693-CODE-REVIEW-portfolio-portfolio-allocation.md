# Code Review — Task #693: CHORE: Revisit bucket-detail form factor

**Topic:** #576 Portfolio Allocation  
**Task:** #693 — CHORE: Revisit bucket-detail form factor (dialog → refactor TBD)  
**Reviewer:** Devin + three-axis review (Standards / Spec / Thermo-nuclear sub-agents)  
**Date:** 2026-10-06  
**Verdict:** PASS — one major + two spec-detail findings remediated during review, verified green afterward.

## Scope reviewed

- `allocation-buckets-table.component.ts` — expandable rows (stats strip +
  positions mini-table) replace the modal detail-dialog trigger
- `allocation-buckets-table.component.spec.ts` — 9 new expansion tests
- `allocation.types.ts` — shared `isUnassignedRow` / `fmtQty` / `positionPnl`
  helpers (extracted during review)
- `allocation-positions-table.component.ts` — delegates to `isUnassignedRow`
  (remediated) + `.num` header alignment (task ride-along)
- `allocation-bucket-detail-dialog.component.ts` — retained unwired per spec;
  helpers now delegate to shared utils (remediated)

## Standards axis

- **No hard violations.** No `as any`/`as never`, typed fixtures, `jest.fn`,
  OnPush + signals throughout, no new SDK calls — expansion reads the same
  `positionsRows`/`bucketRows`/`selectedAccount` selectors the Positions tab uses.
- **[major → remediated] Duplicated can't-diverge predicate.** The
  unassigned-membership predicate (`bucketId === null || unresolved === true`)
  existed in three places with a documented must-agree contract
  (`allocation.types.ts:55`): the store's `unassignedStats` fold, the Positions
  tab's `isUnassigned`, and the new `positionsFor`. Extracted
  `isUnassignedRow()` into `allocation.types.ts`; both components now call it.
- **[minor → remediated] Per-render re-filter.** `positionsFor`/`totalsFor`
  re-scanned all `positionsRows` ~5× per expanded row per CD cycle. Replaced
  with a `positionsByRowKey` `computed` — one grouping pass, map lookups per row.
- **[nit → remediated] Helper drift across the two detail surfaces.** `pnlOf`
  was verbatim-duplicated in the retained dialog; `fmtQty` existed twice with
  *different* signatures (the dialog's dropped the null/finite guard). Both
  consolidated into `allocation.types.ts` next to `fmtDollars`.
- **[nit → remediated]** Template inlined `row.bucket?.id ?? row.kind` instead
  of `rowKey(row)`; fixture `bucketName` diverged from the store derivation
  ('Unknown bucket' for dangling ids); `row.bucket!.id` re-asserted after
  narrowing (gone with the map rewrite).
- **[accepted] Retained dialog = dead code.** `rel-str-coding-guidelines` §3
  frowns on keeping unused code "for later", but the spec *requires* retaining
  the component + spec for possible portfolio-page reuse — the documented
  spec overrides the baseline smell.
- **[accepted] File size.** Component now ~370 lines (over the 300 target,
  under the 400 strong-smell line) — the expansion panel is inline-template
  weight; extraction would scatter a ~40-line cohesive block.

## Spec axis — acceptance criteria

| AC | Result |
|---|---|
| Name click toggles inline panel, aria-expanded, second click collapses | PASS |
| Stats strip (target, exposure, drift, realized/unrealized, open/closed) + mini-table (instrument, qty, MV, cost, unrealized) | PASS — **[remediated]** strip showed only `targetDollars`; spec §4 wants `targetPct→targetDollars`, now renders `25% → $900` |
| Unassigned row expands to unattributed positions | PASS — incl. dangling attributions |
| Retired rows expand inside the collapsed retired section | PASS |
| Cash row has no expand affordance | PASS — kind-guarded, no button |
| Multiple rows expanded at once; state keyed per row id | PASS — `expandedIds` keyed by `rowKey` |
| Empty bucket → explicit empty state | PASS — "No positions" |
| Name click no longer opens the detail dialog; no trigger on the page | PASS — `openDetail`/import removed, spec asserts `dialog.open` not called; zero production references remain |
| Dialog component files retained | PASS |
| Existing behavior preserved (create/edit/retire/delete, ≥100% warn, retired toggle, live re-derivation) | PASS — position-move test proves re-derivation |
| **Spec §4 styling** — expanded `<td>` light background + left border | **[remediated]** background was present, left border missing — added `border-left: 3px solid #ddd` |

**Spec deviations accepted:**

- Data source: spec §2 suggested `store.bucketDetail(...).positions`; impl
  filters `positionsRows()` by `bucketId` — functionally equivalent, simpler,
  and the grouped map now derives both tabs from one fold. `bucketDetail`
  stays live via the retained dialog + `order-ticket.component.ts`.
- Spec cited `position.unrealizedPnl` — no such field on
  `AllocationPositionInput`; impl correctly derives `marketValue − costBasis`
  (same fold as `computeBucketStats`).
- Ride-alongs beyond the listed ACs: mini-table totals `<tfoot>`,
  `.pos`/`th.num` alignment, `fmtQty` in the retained dialog. Consistent with
  the Thread #751 dense-table direction; noted for QA awareness.

## Thermo-nuclear axis

- **[major → remediated]** the predicate triplication above.
- **[minor → remediated]** the grouped-map computed above (fixes the lazy
  re-filter for free, not for speed — verdict was "acceptable but lazy").
- **[minor → accepted] `expandedIds` staleness.** Bucket ids are
  `{accountNumber}_{slug}` so cross-account collision is impossible; stale
  ids are inert strings and `'unassigned'` staying open across accounts is
  harmless-to-desirable. Intent now documented on the field comment.
- **[cosmetic → noted] Unassigned strip shows "Drift $0.00".**
  `unassignedStats` hardcodes `drift: 0`; QA can decide whether to hide it.
- **Verified:** `colspan="10"` correct (10 `<th>`s; every row variant sums to
  10); `aria-expanded` on both expand buttons; chevron matches the
  retired-toggle convention; tests are external-behavior/testid-driven with
  no `as never`, no no-assert tests, no `setTimeout` async.

## Test results

- **Task suites green:** `allocation-buckets-table` (13), `allocation-positions-table`,
  `allocation-bucket-detail-dialog` — 41/41 pass post-remediation; tsc clean on
  the feature.
- **Full suite caveat:** `npx jest` = 2824 tests pass; **4 suites fail to
  compile — all in `savant-trader` gallery specs** (`allOccurrences` missing on
  `GalleryCard` fixtures). These are a concurrent in-flight refactor unrelated
  to this task's diff — the task's own suites are green. Flagged, not fixed:
  the refactor is still moving. Full suite must be green before `/proj ship`.

## Verdict

**PASS.** All acceptance criteria met; every planned test exists and passes;
the single major (can't-diverge predicate triplication) and both spec-detail
misses (left border, targetPct display) were remediated during review and
re-verified green. Advance to `7_QA`.

## Pass 2 — delta re-review (2026-10-06)

Re-reviewed the remediation diff only (user: "til no new findings, don't go
crazy"):

- `positionsByRowKey` map grouping verified — `isUnassignedRow(p)` sends
  dangling `unresolved` rows to `'unassigned'` (matching the Positions tab),
  attributed rows key on `bucketId` which equals the row's `rowKey`; retired
  buckets are in `alloc.buckets` so their panels still populate. `p.bucketId!`
  is safe — the predicate already excludes null/dangling from that branch.
- `isUnassigned` wrapper method removed from the positions table —
  `.filter(isUnassignedRow)` calls the shared predicate directly (one less
  indirection).
- `fmtQty`/`pnlOf` alias to shared utils consistently across both components.
- `expandedIds` carry-over intent documented on the field.
- Fixture `bucketName` mirrors the store's 'Unknown bucket' derivation.

**No new findings.** 41/41 task tests + tsc clean on the feature post-pass-2.

**Pass-1 caveat resolved:** the 4 gallery-spec compile failures
(`allOccurrences` refactor, in-flight at pass 1) were fixed concurrently —
all 7 gallery suites now pass (137/137).

## Findings for QA

- [ ] Eyeball the expanded panel: stats strip `targetPct → targetDollars`,
  left-border containment, mini-table totals row
- [ ] Unassigned row — is the hardcoded "Drift $0.00" strip line acceptable,
  or should it hide for non-bucket rows?
- [ ] Retired bucket expansion — expand a retired row and confirm historical
  positions render
- [ ] Multi-expand several rows; switch accounts and confirm panels re-derive
  (expansion state is per-account-keyed and intentionally carries over)
- [ ] Empty bucket panel shows "No positions"
- [ ] Full suite green before ship (4 unrelated gallery-spec compile failures
  from the in-flight `allOccurrences` refactor must clear)
