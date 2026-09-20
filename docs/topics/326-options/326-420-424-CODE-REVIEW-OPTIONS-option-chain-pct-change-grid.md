# Code Review: SwingCompareComponent (date list + run builder + run list)

**Topic:** Option Chain Pct Change Grid
**Topic Slug:** option-chain-pct-change-grid
**Issue:** #420 (FE Blueprint)
**Task:** #424
**Topic Parent:** #326
**Domain:** OPTIONS
**Area:** FE
**Status:** Final
**Last Updated:** 2026-09-19

## Reviewed change

- NEW `components/swing-compare.component.ts` — section container: two set pickers, labeled date list, run builder (start select + post-start target checkboxes + type select), run list
- NEW `components/run-section.component.ts` — collapsible run shell; expand calls `ensureSnapshots`; grids land in #425
- NEW `swing-compare.component.spec.ts` (10 tests) + `run-section.component.spec.ts` (5 tests)

## Standards

- Direct `inject(OptionChainPctChangeStore)` matches the feature pattern (page, grid, target-type-selector all do it).
- **Fixed — weak assertion:** the post-start test compared raw `textContent` strings, which would pass under a `>=` bug → asserts exact date list `['2025-04-12','2025-04-15']`.
- **Fixed — `<button>` inside `<summary>`** (a11y: nested interactive controls toggle the disclosure) → header row is a sibling div; `<details>` holds only the grid body.
- **Fixed — missing spec for RunSection** → 5 tests: header, collapsed default, expand→ensureSnapshots, collapse no-op, remove emit.
- **Fixed — unresolved comment** left in spec resolved (frame end only enters `dateList` via a pivot/signal landing on it — by design).
- **Noted:** index-based `Run N` renumbers on removal — acceptable reading of "numbered run"; stable ids exist if per-run numbering is ever wanted.

## Spec

All five acceptance criteria met:

- Labeled date list inside frame — ✓ (gated on `frameSwing` per IMPL)
- Start dropdown + post-start-only target checkboxes — ✓
- Type select defaulted by direction, overridable — ✓ (eager default on start change, manual override preserved until next start pick)
- Add/remove numbered runs — ✓
- Run list renders RunSection per run — ✓

## Thermo-nuclear

- **Major — fixed:** builder draft survived a frame-swing change — `canAddRun` stayed truthy and `addRun` could emit dates outside the new frame. `effect` on `frameSwing()` now resets the draft.
- **Minor — fixed:** null-means-auto `builderType`/`effectiveType` → eager `builderType` set in `onStartChange`; deleted the fallback computed and the silent `CALL` default.
- **Minor — fixed:** RunSection's `fetched` flag dropped — `ensureSnapshots` already dedupes cached/in-flight dates, so every expand calls it harmlessly.
- Draft state as component signals vs store: correct split (ephemeral draft vs durable `runs`).
- **Noted:** RunSection body is a documented #425 placeholder — tech debt referenced by task number.

## Test results

- pct-change suite: **332/332 green** (13 suites); `tsc -p tsconfig.app.json` clean.
- New coverage: hidden-until-frame gating, exact post-start candidates, add-run disabled gate, start-change target reset, frame-change draft invalidation, RunSection expand/collapse/remove.

## Verdict

**PASS** — the one major (draft invalidation) was fixed and tested; remaining items are nits recorded above.
