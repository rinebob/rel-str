**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Issue:** #1335  
**Topic Parent:** #1243  
**Task:** #1515  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# CODE-REVIEW — #1515 BUG: Pinned chip dims other series — pin should be a chip bookmark, not a chart highlight

## Verdict: **PASS** (two passes)

## Round 2 — remediation-delta re-check (2026-11-15)

Scoped to the Round-1 fix delta (~30 lines + spec changes), not a full
three-axis re-run — the diff is small enough that three more agents
would be review theater.

**Zero new findings.** Verified directly:

- **Stale-language sweep complete** — a targeted grep across
  `savant-trader` for residual pin→highlight phrases ("stays lit",
  "pin.*highlight", "dim every", "no lit line", "fall.*pin") returns
  only the new bookmark specs/comments and unrelated word collisions.
  The two remaining "dim" mentions are correct: `chartHighlight`'s
  bound-hidden-hover rationale and the series-set highlight guard —
  both hover paths, not pin.
- **`loadPlotted` equality guard** — `pinned && !next[pinned] ? null
  : pinned` mirrors the adjacent hover guard exactly; the survival
  spec (`a pin survives a set reload when its contract does`) pins it.
- **`loadContractInternal` release** — `const pinned` and the pin
  patch line both removed; the comment correctly explains the pin
  stays because the failed *focused* load never touched the plotted
  record. Hover release retained and still needed.
- **Worker error path** — pin release kept (error chips can't be
  unpinned by click); the comment no longer falsely claims to mirror
  `loadContractInternal` for the pin.
- **DOM spec** — exercises real bindings end to end: click →
  `.pinned`+`push_pin` on / `.highlighted` off; hover on the pinned
  chip still highlights; click again → unpin. The actual user-facing
  contract is now asserted at the template seam.

**Converged — no further pass warranted.** Everything left standing is
a documented trade-off from Round 1, not an open question.

## Round 1

Three-axis review (Standards / Spec / Thermo-nuclear) of the working
tree diff. Zero critical, zero major. All three axes independently
converged on the same conclusion: the fix is correct and minimal, and
the real finding was **vocabulary drift** — ~8 comments and 2 spec
titles still described the removed pin→highlight contract — plus two
pin-state asymmetries that were only defensible under the old
semantics. All remediated in-gate and re-verified.

## The change

- `plotted-contracts-feature.ts` — `highlightedContractId` forwards
  **hover only** (`hoveredContractId()`, still gated on no
  `chartFocusContractId`). The `?? pinnedContractId()` fallback is gone.
- `option-chart.component.ts` — `chartHighlight` gate retained: a
  hovered bound-hidden chip must still not reach the chart (spec'd).
- `option-chart.component.html` — chip title `'Click to pin highlight'`
  → `'Click to pin'`.
- Bookmark UI unchanged — `.pinned` class + `push_pin` icon already
  rendered the bookmark; pin state, toggling, and release guards all
  stay.

## Findings — all remediated in-gate

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| F1 | MINOR | ~8 stale comments still described pin→highlight (`pinnedContractId` field doc, `togglePinnedContract` doc, `onChipClick` doc, `onChipEnter` doc, release-path rationales, series-builder input doc, 2 spec titles) — the exact vocabulary confusion this bug was | **FIXED** — full comment sweep; pin = chip-strip bookmark, hover = only chart-highlight path |
| F2 | MINOR | `loadPlotted` nuked the pin unconditionally while hover was preserved-if-surviving — every re-emit destroyed a valid bookmark on a surviving contract | **FIXED** — equality-guarded like hover (`pinned && !next[pinned] ? null : pinned`); new spec pins the survival |
| F3 | MINOR | `loadContractInternal` error path released a pin when a *focused* load failed — the pin always points at a plotted chip whose record the foreign/focused failure never touched | **FIXED** — pin release dropped (hover release kept — a stranded hover still dims the set) |
| F4 | MINOR | The user-facing bookmark contract (`.pinned` + `push_pin` render, `.highlighted` absent) had zero DOM-level coverage — this was a UI-semantics bug that escaped signal-level specs | **FIXED** — new DOM spec in `option-chart-dom.spec.ts`: click → `.pinned`/`chip-pin-icon` on, `.highlighted` off; hover on the pinned chip still highlights; click again → off |

## Axes summaries

- **Standards:** fix is correct/minimal; exhaustive consumer trace
  confirms no other pin→chart path exists; `chartHighlight` gate and
  all release guards verified still load-bearing. Findings were the
  comment drift + the `loadPlotted` asymmetry.
- **Spec:** every acceptance intent met — pin is chip-local, hover
  forwards, reworked specs cover bookmark-survives-bound, click
  pin/unpin, hover-still-lights, bound-hidden gating. Flagged the DOM
  binding coverage gap (F4).
- **Thermo-nuclear:** no functional bug or structural regression;
  state model is now cleanly disjoint (`pinned`=bookmark,
  `hovered`=pointer, `highlighted`=gated hover). Flagged the
  `loadContractInternal` pin release (F3) and the vocabulary trail.

## Documented minors / awareness (not defects of this task)

- Dual "pin" vocabulary on the page — chip bookmark (`push_pin`) vs.
  the data-window's "pinned to corner" tooltip mode. Pre-existing,
  established; flagged only.
- `focusPlotted`/`clearChartFocus` have no production callers
  (spec-only); the focus gate still guards a real state path via
  `loadContract`. Pre-existing.
- Historical docs (`1243-1479-1389-UAT`, `1243-1551-1514-UAT`)
  describe pin lighting lines — doc drift from the old behavior;
  #1515 is the resolution of the former's own filed finding.

## Test evidence

- Focused suites (option-chart + options-contract-chart +
  plotted-contracts): **255/255**
- Full suite: **313 suites / 5,660 tests**
- `tsc --noEmit`: clean on all touched files (unrelated pre-existing
  errors in `portfolio-dashboard.store.spec.ts` — foreign session work)
