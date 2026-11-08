**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** options  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1359  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1402  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

## Verdict

**PASS — one round.** Three axes on the scoped diff; zero critical, one
substantive correctness defect (biweekly week-boundary semantics),
converged minors for doc staleness and a `persist()` docId clobber.
Every actionable finding was remediated in-gate and spec-pinned. Focused
suites 137 green; full suite 302/5,308 green post-remediation;
`tsc --noEmit` clean.

## Scope

Uncommitted working-tree diff for #1402 — picker Range-apply bound to
the chart brush (`OptionGroupGeneratorStore.refine().aliveRange`) with
typed date inputs removed; month-parity row banding; DOW/cadence
selection preset (`setDowDays`/`setCadence`/`applyDowPreset` + persisted
`dowDays`/`cadence` in `rs-optlist:{SYMBOL}`); `ListChunkInfo`
start/end dates in the chunk readout; `contract-list-mini-controls`
deleted (4 files); `sendAll` and `setChunk` removed as dead; page keeps
only the `openListPicker` entry point.

Foreign hunks excluded: `option-chart-generator.spec.ts` (entire diff is
#1430's `watchContractList` rename) and the `run-1_QQQ`→`run-1` /
`watchContractLists` hunks inside `option-chart-list.spec.ts` —
#1402's hunks there are only the `dowDays`/`cadence` blob literal, the
`session emit seam` describe retitle, and `step(1)`. All other dirty
files (portfolio, rh-mcp, backtest, scanner, vendor) are other sessions.

## Findings — all remediated in-gate

| Sev | Axis | Finding | Fix |
|---|---|---|---|
| major | Spec + TN | `weekIndex = floor(utcMs/7d)` is Thursday-anchored **epoch** weeks, not the documented alternating weeks — with a Monday anchor + Friday checked, the Friday of the anchor's own calendar week landed in the next block and was skipped (e.g. anchor 06-01 + Mo/Fr skipped 06-05). Invisible for single-weekday sets (7-day spacing makes parity identical) — exactly why no spec caught it | `weekIndex` deleted; `biweekly` is anchor-relative `floor(daysBetween(anchor,d)/7)` blocks — simpler AND correct; multi-weekday Mo+Fr spec pins `{06-01, 06-05, 06-15}` |
| minor | TN | `persist()` derived `docId` from `activeList?.listId` — any pref write while `activeList` is null (e.g. after an explicit load failure, which deliberately preserves the blob) silently nulled the preserved session pointer | `docId` is now state: set by `applyLoadedDoc`/`setSymbol`, nulled only on the restore-wipe path in `fail()`; `persist()` writes `store.docId()`. New spec: pref write after explicit failure keeps `docId` + records the pref |
| minor | Std + Spec + TN | IMPL doc contradicted the shipped code inside the #1402 section and left stale references unmarked: `setChunk`/`step` "survive" (setChunk removed), `sendAll` in the API enumeration + sync-model text, "chart mini-controls" as a live surface, blob shape missing `dowDays`/`cadence`, TEST doc `Last Updated` stale | all amended/struck per the doc's own supersession convention; both doc headers now 2026-11-07 |
| minor | Spec + Std | `clear()` had zero callers anywhere — the same dead-surface judgment that removed `setChunk`/`sendAll`, and this diff had *expanded* it | `clear()` deleted (the `clearListSession` util stays — specs' `afterEach` uses it) |
| minor | TN | `tr.month-alt td` vs `tr.selected td` at equal specificity — selection paint won only by source order; a future reorder or `tr:hover td` rule silently flips it | `tr.month-alt:not(.selected) td` — structural, order-independent |
| minor | TN | Picker hard-injected `OptionGroupGeneratorStore` — a picker opened off the option-chart injector dies NG0201 at construction | `inject(..., {optional: true})` → `chartRange` falls back to `null` (button renders its existing disabled "brush first" state); lifecycle coupling (`genStore.clear()`/symbol swap wipes the bound) documented |
| nit | TN | `chartRange()!.start`/`!.end` non-null assertions in the Range button | `@let bound = chartRange();` — assertion-free binding |
| nit | TN | `setDowDays` `.sort()` was lexicographic (harmless at 1–5, fragile idiom) | numeric `(a,b)=>a-b` |
| nit | TN + Spec | Duplicate spec — `setChunk`→`step` migration left 'step jumps the cursor without emitting' assertion-identical to 'step moves…' | dup deleted |
| nit | Spec + Std | Coverage gaps vs TEST doc: `.cadence-select`→`store.cadence` never exercised; rendered `start → end` in `.chunk-info` never asserted | cadence-select spec (+ off-union guard) added; readout spec now pins `2026-06-01 → 2026-06-11` |

## Accepted-with-reason (no change)

- **`chunkInfo.days` builds a `Set` over `entryDate`** — semantically
  "distinct days in the chunk", not "row count"; if a list ever emitted
  two picks on one date, `days` should still be 1. Keeping.
- **`setCadence(value: string)` guard + cast** — the select can only
  emit the three literals, but the guard keeps the store unreachable
  from an arbitrary string; the `DOW_CADENCES`-membership check is the
  single source.
- **`emitSessionLines` retained** — the issue's "remove wiring" meant
  the strip's `(send)` binding; the picker's `onSend` callback still
  emits through it. The one-hop `onListSend` indirection it calls is
  pre-existing page wiring, not this diff's surface.
- **Store file ~540 lines** — pre-existing size, deepened not created;
  the remaining date helpers are 3 small fns after `weekIndex`'s
  removal — extraction buys little now.
- **`daysBetween(anchor, d)` negative-domain** — rows can't precede the
  first pick row by construction; `floor(negative/7)` parity is moot.
- **Monthly anchor on week-5 (days 29–31)** — months without a week-5
  block yield no picks for that weekday; coherent per the documented
  `ceil(day/7)` semantics.

## Test results

- Focused: `npx jest --testPathPatterns='contract-list|option-chart-list'`
  — **8 suites / 137 tests green** post-remediation (was 135; +2 net:
  multi-weekday biweekly, docId-preservation, cadence-select, rendered
  chunk dates; −1 duplicate).
- Full: `npx jest` — **302 suites / 5,308 tests green**.
- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- AOT (`npm run build` dev config) — clean.

## AC traceability

- **A1** met — `chartRange`→`selectDateRange` inclusive; specs assert
  bounds and marker exclusion; zero `input[type=date]` remain.
- **A2** met — unbound → disabled + "brush the chart first" title; the
  optional inject degrades to the same state off-injector.
- **A3** — deferred (user decision); absence is correct.
- **B1** met — `month-alt` on pick + marker rows; `:not(.selected)`
  keeps selection paint dominant; DS tokens both themes.
- **C1** met — union of checked weekdays, spec'd.
- **C2** met — anchor-relative biweekly blocks (post-fix), monthly
  same-week-of-month; rule documented in code, settings util, and IMPL.
- **C3** met — replace semantics identical to every sibling toolbar op;
  button title discloses "Replace the selection…"; manual toggles
  compose after apply.
- **D1** met — `startDate`/`endDate` from the current chunk's own rows;
  partial tail chunk reports its last pick; rendered + spec'd.
- **D2** met — strip deleted, reopen via `openListPicker`, All+Send in
  picker; `sendAll`/`setChunk`/`clear()` dead-code removals complete.
- **Removals** — zero `rangeFrom`/`rangeTo`/`input[type=date]` refs.
- **Prefs** — `dowDays`/`cadence` in `rs-optlist` (additive, tolerant
  reads, no version bump), prefs≠session boundary spec-pinned.

## Round 2 (post-remediation re-review, all three axes)

All nine R1 remediations verified correct by every axis; the round
surfaced only residue the fixes themselves left behind.

**Round-2 findings → remediation (all applied in-gate):**

- **M2 (thermo, minor → fixed):** the `fail` comment promised
  `docId/selection/cursor` blob preservation, but `emptySession()`
  zeroed selection+cursor — the next pref write would have clobbered
  the saved session's keys. Non-wipe `fail()` now preserves all three
  (inert while `activeList` is null; `applyList` resets on success).
  The docId spec extended to pin `selectionKeys` + `cursor`.
- **M4 (thermo + standards, minor → fixed):** four doc spots the R1
  doc-fix pass missed — IMPL mermaid still drew mini-controls as an
  emit surface; FE-2 blob enumeration omitted `dowDays`/`cadence`;
  IMPL §B still described the month-alt fix as source-order (shipped
  mechanism is `:not(.selected)`); FE-3 footer still claimed "dialog
  stays open" (superseded by #1419 close-first); TEST seam listed
  mini-controls. All amended.
- **M1/M5 (standards, minor → fixed):** dead `MS_PER_DAY` (was
  `weekIndex`'s denominator); lexicographic `.sort()` twin in the
  settings sanitizer → numeric comparator; stale "week index" comment.
- **N1–N3 (thermo, nits → fixed):** 'yearly' guard pinned via direct
  `setCadence('yearly')` (jsdom collapses non-existent options to '');
  non-Monday-anchor biweekly spec added (Wed anchor → Fridays
  `{06-05, 06-19}`); `randomPick` clamps `rng() === 1`.
- **M3 (`loadList` zero prod callers — adjudicated KEEP):** it is the
  fetch-by-id public entry point — the spec suite exercises
  `doLoadList` through it, and `loadListDoc` requires a doc already in
  hand (different signature, not a substitute). JSDoc now says so.
- **Watch items (accepted):** `option-chart.component.ts` at ~1100
  lines — pre-existing growth, tracked under the page-wiring extract
  task; rows-assumed-chronological invariant shared with timeline/
  stride/chunkInfo — R1-accepted, consumer-side.

**Round-2 verification:** focused 8 suites / **138 tests green**;
full `npx jest` 302 / 5,312 green; `tsc --noEmit` clean.

**Final verdict: PASS — converged.** No round 3 needed: every R2
finding was in remediation residue (dead constant, doc drift, spec-pin
gaps), not new design surface; the corrected areas are now covered by
discriminating specs.
