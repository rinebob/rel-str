**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1537  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1546  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1546 FE: Instance table (columns, sort/filter, position join, start/stop)

## Verdict: **PASS**

Three axes (Standards / Spec / Thermo-nuclear) ran in parallel, plus a
serial second pass over the union of findings. All three ACs met; nine
minors fixed in-cycle; the remainder are documented waives/deferrals.
Full suite green post-fixes: 317 suites / 5893 tests (51 strategy-manage
specs: service 10, store 16, component 25). Build clean — zero
warnings/errors on the changed surface.

## Axis summaries

**Standards — PASS-WITH-MINORS.** `updateDoc` usage, `listStrategyPositions$`
consumption, contract reads, toggle transitions, and the triple real-row
guard all verified against the real conventions (`paper-trading`,
`options-strategy-*`, shared contracts, `firestore.rules`). Feature-state
ownership correct: sort/filter signals are view-state and match the
paper-trading convention of keeping them component-local. File sizes well
under guidance (component 205 → 224 lines).

**Spec — all three ACs met**, spec-pinned on the rendered surface:
9 columns; sort on every data column + text/run-state/position filters
(open/waiting/flat buckets mirror the cell); `Yes · {status}` / `Waiting`
(ACTIVE-flat) / `No` cell; UNSTARTED→ACTIVE→STOPPED→ACTIVE write path at
service, store, and DOM seams; real disabled at both seams.

**Thermo-nuclear — no criticals/majors.** Called the architecture sound:
absolute-write toggles make the double-click race convergent (same target
state written twice), position fetch-once is defensible v1 (per-mount
refetch; positions mint at most once/day), and the triple real-row guard
is layered, not redundant.

## Findings fixed in-cycle

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | minor (regression) | Removing `variant?.name` for NG8107 dropped F1's malformed-doc crash guard — a doc with a `runState` but no `variant` passes `isLiveManageInstance` and crashes change detection at three sites | `isLiveManageInstance` now requires `typeof d.variant?.name === 'string'` — closes all sites at the seam (service.spec +1) |
| 2 | minor | Sortable `th` missing the convention's a11y/discoverability surface | Full paper-trading parity: `tabindex`/`role="button"`/Enter+Space keydown/`title` hint, `sortRank` badge, `dse-icon` arrow ligatures; `toggleSort` signature ported verbatim (`MouseEvent\|KeyboardEvent\|Event\|boolean` — required for the keydown bindings to typecheck) |
| 3 | minor | Position cell rendered raw enum (`Yes · ASSIGNED_HOLDING_SHARES`); ×N showed only first status | `OPTIONS_POSITION_STATUS_LABELS` + raw fallback; distinct statuses joined ` / ` |
| 4 | minor | `toggleRunState` failure pinned a sticky banner — nothing cleared it outside `load()` (the #1229 bug class) | `clearError()` + banner ✕ dismiss + error cleared at the top of each toggle |
| 5 | minor | `requireUserId`'s `Error('Authentication required')` (message, no `.code`) mapped to "Failed to load strategy instances" | `catchError` checks message too; spec'd |
| 6 | minor | `positionState`/`positionLabel` duplicated the tri-state decision | `positionLabel` derives from `positionState` |
| 7 | nit | `runStateOptions` hand-duplicated `INSTANCE_RUN_STATES` | `['ALL', ...INSTANCE_RUN_STATES]` |
| 8 | minor | Empty state claimed "No {tab} instances yet" when filters hid every row | `hasActiveFilters` → "No instances match the active filters." |
| 9 | nit | Stale `@task` headers / spec-file description (F1 wording) | Updated to cite #1546 |

## Waived / deferred (documented)

- **Position join is fetch-once** — instances stream live but positions
  load per page mount; a noon-pass mint won't appear until revisit.
  Acceptable v1 (≤1 mint/day/instance). Improvement logged for F5:
  `lastFiredAt`/`updatedAt` on the instance doc emit on every mint, so
  the already-live stream could trigger a positions refetch (~10 lines).
- **`positionsFailed` marker** — a failed positions fetch currently shows
  Waiting/No cells as if flat. v1 taste; revisit if UAT flags it.
- **Pending-write disable** — absolute writes are idempotent; double-click
  writes the same state. UX polish for F3–F5, not correctness.
- **`data-testid` adoption** — repo has 582 testids but the page's F1 spec
  style uses class selectors consistently; a cross-page convention
  migration, not this task.
- **Spec mock plumbing** — `Record<string, any>` overrides +
  `(collectionData as any).mockData` and dead `jest.mock` boilerplate:
  pre-existing F1 spec scaffolding; pragmatic, non-blocking.
- **`setRunState` on a legacy-id** — latent; `firestore.rules` owner-scope
  governs and the only caller passes manage ids.
- **Padded-string 'position' sort value** — judo; sorts flats → waiting →
  opens-by-count correctly.
- **"runState badges" (IMPL F2 line item)** — AC requires the column;
  plain text ships. Badge styling deferred.
- **Spec coverage gaps** — non-symbol sorts, id in the text-filter
  haystack, button label text, `aria-sort` values unasserted. Public
  seams are tested; these are assertion-depth additions if ever needed.

## Second pass

Re-checked every finding's capture + the full diff after the in-cycle
fixes: all nine fixes verified in code and specs; no remaining error
paths unexamined (load error, auth variants, positions failure, toggle
failure all have specs); no leftover scaffolding. One new compile error
the fixes introduced (keydown `$event` type) was caught and healed by
porting paper-trading's union signature.

## Third pass (required — pass 2 was not clean)

Because pass 2 surfaced a new defect, a further pass re-read the full
final diff cold. It found two leftovers from the in-cycle refactor,
both fixed and re-verified (51/51 specs, build clean):

- `positionsFor` became dead code once `positionLabel` read the position
  map directly — removed (no remaining callers; grep-confirmed).
- `positionLabel`'s non-open branch re-derived `runState === 'ACTIVE'
  ? 'Waiting' : 'No'` instead of consuming the `positionState` bucket —
  half-applied fix #6, same drift risk it was meant to close. Now
  branches on `positionState` directly.

A fourth pass is not warranted: the pass-3 delta is a deletion plus a
branch reuse, both covered by the green specs; no new surface was added.
