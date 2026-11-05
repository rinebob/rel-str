**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1359  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1363  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# Code Review — Task #1363: Chunk stepper + timeline + mini-controls

**Verdict: PASS — three rounds.** Three axes (Standards / Spec /
Thermo-nuclear) on the task change set; round 1 found one major + a tail
of minors/nits, all remediated in-gate. Round 2 verified every
remediation correct. Round 3 (full re-run on the final diff) found
minors only, all remediated or explicitly deferred — converged.

## Scope

Uncommitted working-tree diff, 11 files (+1 new component dir): picker
Chunks tab (stepper live-drive, timeline, add-chunk, size select), page
mini-controls strip, `sendSteppedChunk`/`sendChunkAt`/`canStepPrev`/
`canStepNext` + `CHUNK_SIZE_OPTIONS` on the session layer, and specs for
all of it.

## Pass 1 — findings & disposition

### Major — remediated in-gate

- **Emit-on-step protocol duplicated at 3 call sites** (TN). "Cursor moves
  before `currentChunk` is read" was an implicit contract re-implemented
  in `stepChunk`, `jumpToChunk` (picker), and `onListChunkStep` (page).
  **Fix:** the ordering now lives in the store once — `sendSteppedChunk(dir)`
  / `sendChunkAt(i)` compose shared factory-local primitives
  `moveCursorTo` (clamp + persist) and `emitCurrentChunk` (lines +
  lastEmitted); `step`/`setChunk`/`sendChunk` were refactored onto the
  same primitives. Every UI call site is a one-liner.

### Minor — remediated in-gate

- **Mini-controls grew an already-oversized page** (both axes).
  `option-chart.component.ts` (~1.1k) and `.scss` (~1.05k) crossed 1k
  pre-diff; the strip is a self-contained dumb surface.
  **Fix:** extracted `ListMiniControlsComponent`
  (`components/contract-list-mini-controls/`) — outputs `send`/`openPicker`
  via `output<T>()`; the page binds them to `emitSessionLines`/
  `openListPicker` and keeps the strip's styles in the child.
  Side benefit: the strip is now render-spec-able (see Spec gap below).
- **Step-bound predicate written 4× across two templates** (Standards+TN).
  **Fix:** `canStepPrev`/`canStepNext` store computeds; both templates
  delegate.
- **`timeline` view-model heavier than needed** (TN). A `chunkOf` Map +
  `Set` + `sort` reproduced index math — and the Map keyed by `entryDate`
  could collide. **Fix:** chunks partition `pickRows` sequentially, so
  `chunkIdx = floor(i / chunkSize)` and `inChunk = chunkIdx ===
  chunkInfo().index`; span reads `currentChunk()[0]`/`at(-1)` directly.
- **Bespoke `Date.parse` math duplicated `daysBetween`** (TN).
  **Fix:** canonical `daysBetween` from `shared/utils/date.util.ts`;
  `pct` clamped 0–100; span width `Math.min(100 - left, max(0.5, …))` —
  a doc-end single-day chunk can't overflow the track.
- **Dead `meta ??` fallback** (TN). `pickDocMeta` is required by doc
  validation, so the row-derived fallback was unreachable and contradicted
  the store's named-error contract. **Fix:** explicit `!meta` bail.
- **`CHUNK_SIZE_OPTIONS` in the store while `DEFAULT_CHUNK_SIZE` lived in
  the settings util** (Standards). **Fix:** moved beside the default in
  `contract-list-session-settings.ts` — one home for chunk constants.
- **"All" had different semantics on adjacent surfaces** (Standards) —
  select-only in the picker toolbar vs select-and-emit on the page strip.
  **Fix:** extracted handler renamed `sendAll` with the semantics
  documented; the button label stays `All` per the IMPL.

### Spec coverage gap — closed in-gate

- "Mini-controls render only with an active session; `i/n` reflects
  cursor" was un-testable at page level (the page spec suite is
  class-level by convention — no render harness exists for
  `OptionChartComponent`). The extraction makes the strip a light
  standalone component: new rendered spec covers the render-gate,
  `i/n`, disabled bounds, step-emit, `All`, silent resize, and the
  `openPicker` output.

### Nits — remediated in-gate

- Weak oracle — picker specs asserted `onSend` received
  `store.currentChunk().map(…)` (the SUT's own output) → literal
  `['2026-06-12,CCC7', '2026-06-13,CCC8']` assertions.
- Add-chunk spec now asserts union over a pre-checked out-of-chunk day
  (issue AC's "without disturbing other selections"), not just from empty.
- `type="button"` on every new button; `chunkSizeOptions` field placed
  with the class's other fields; ◀▶ text glyphs unified to `dse-icon`
  chevrons across both surfaces; dead `.mono` class dropped (it's
  component-scoped per file, not global).

## Pass 2 — verification

Post-remediation re-review (all three axes' findings checked against the
final diff, plus a regression sweep): every fix verified correct, helpers
defined before use inside `withMethods`, NaN guards spec'd, DI resolution
confirmed (child sits in the page's provider subtree). No new majors.

**New nits:** persisted non-option `chunkSize` renders a blank select
(cosmetic; only reachable via a hand-edited `rs-optlist` blob —
`setChunkSize`'s UI callers only ever pass option values) — **deferred**;
dead `mono` class — **fixed**.

## Pass 3 — fresh full-axis re-run on the final diff

### Minor — remediated in-gate

- **Dead store API** (Standards): `sendChunk` had zero production
  callers after the round-1 refactor — and `step`/`setChunk` were dead
  too (only spec callers). Keeping silent cursor movers also left a
  public API that *invites* the emit-ordering violation round 1 fixed.
  **Fix:** all three deleted; the public surface is now move-then-emit
  only (`sendSteppedChunk`/`sendChunkAt`). Spec call sites rewritten to
  the fused methods (emit is a harmless side-effect in cursor tests).
- **`sendAll` composite protocol in the component** (TN): `selectAll()`
  + `sendSelected()` was the same mutate-then-emit ordering contract
  round 1 removed — living in `ListMiniControlsComponent`.
  **Fix:** store `sendAll()` = `setSelection(pickDates())` +
  `emitSelected()` (shared with `sendSelected`); the component is a
  pure relay again.
- **Timeline re-derived the partition rule** (TN): `floor(i /
  chunkSize)` restated `partition()`'s contract in the component.
  **Fix:** ticks derive from `store.chunks().flatMap` — the tick→chunk
  binding is the store's own partition, immune to rule changes.
- **Zero-width chunk pill at doc end** (Spec): `width: min(100 - left,
  …)` collapses to `0` when a remainder-1 chunk's only pick lands on
  `lastDate` (`left = 100`). **Fix:** clamp `left` to `100 - width`
  instead — a doc-end sliver stays visible.
- **Unused `CommonModule` import** in the new mini-controls component
  (Standards) — removed; redundant `aria-label` duplicating the
  wrapping `<label>` — removed.
- **TEST-doc drift** (Spec): "Stepper ▶ calls `sendChunk`" — updated to
  `sendSteppedChunk`.

### Deferred (documented, not blocking)

- **Stepper quartet markup duplicated** across the two surfaces
  (~20 lines: ◀/info/▶/Size with identical bindings — Standards+TN).
  Styling divergence is intentional (dialog vs page strip); extracting
  a third component for 20 template lines is over-abstraction. Drift
  risk noted if a third surface ever lands.
- **Pick/doc fixture duplicated 4×** across specs (TN); 3 of the 4
  copies predate this task and `savant-trader/testing/scan-fixtures.ts`
  sets the extraction convention — a `contract-list-fixtures.ts`
  cleanup is a good follow-up but widens this diff into specs it
  doesn't own.

## Test results

- Full suite: **298 suites / 5,191 tests — all green**
- Task sweep: **12 suites / 185 tests — all green**
- Post-round-3 focused re-run: **4 suites / 93 tests — all green**
- AOT `ngc -p tsconfig.app.json` (`strictTemplates`): clean (re-run
  after pass-3 edits)

## Accepted residuals / deferred notes

- `option-chart.component.ts`/`.scss` remain >1k (pre-existing debt;
  this change removed ~30 lines net rather than adding).
- Spec files >400 lines — verbose-by-nature, consistent with suite norms.
- Mini-controls `All` emits the whole selection through the same
  `LARGE_LIST_WARN_THRESHOLD` confirm path as any send — intended
  (IMPL's All-send boundary note).
- "Size (5/10/20/50 stepper)" is a `<select>` on both surfaces —
  functionally equivalent control-kind deviation, noted for QA.
- Picker Send still uses `sendSelected()`; the stepper's `sendSteppedChunk`
  doesn't supersede it (different payloads — selection vs chunk).
