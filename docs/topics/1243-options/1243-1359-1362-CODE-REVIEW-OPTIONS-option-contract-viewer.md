**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1359  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1362  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# Code Review — Task #1362: Picker dialog — rows tab + lines preview

**Verdict: PASS — two rounds.** Three axes (Standards / Spec / Thermo-nuclear)
on the task change set; round 1 found one critical + one major, remediated
in-gate. Round 2 (same three axes on the remediated diff) found one new
major + one converged minor, also remediated in-gate; remaining items are
documented accepted residuals.

## Pass 2 — re-review findings & disposition

Second run of all three axes on the post-round-1 diff. Prior remediations
verified correct on every axis; these are the new findings.

### Major — remediated in-gate

- **Dialogs outlive the page** (TN). `DsDialogService` is root-scoped and
  `ngOnDestroy` closed nothing — browser Back with the picker open left a
  zombie overlay whose `onSend` still ran `emitSessionLines` against the
  destroyed component and the root viewer store (plots loaded invisibly;
  remount showed a plotted set with an empty textarea).
  **Fix:** `ngOnDestroy` calls `dialog.closeAll()`; spec asserts the
  picker cannot survive destroy.
- **Picker stacking** (all three axes converged). `openListPicker` had no
  dedupe — a `?list=` nav while the picker was open stacked a second live
  picker on the same session store.
  **Fix:** a `pickerRef` tracks the open dialog — `openListPicker`
  no-ops while one is live (the open picker already reflects the store);
  `afterClosed` clears the ref so close→open still works. Two specs pin
  the no-stack and close-frees-reopen semantics.

### Minor — remediated in-gate

- Orphaned `/** Load dispatch… */` JSDoc — the `loadConfirmOpen` flag was
  inserted between the doc and `onLoad`; reordered so each comment
  attaches to its target.
- Spec clipboard restore was conditional and post-assert → `try/finally`
  with unconditional restore (delete when originally absent).
- Store mutators accepted `NaN` — `selectStride`/`randomPick`/`setChunk`/
  `setChunkSize`/`step` could empty the selection or write `NaN` into
  `chunkCursor` (FE-4's stepper seam; `contract-list-session-settings.ts`
  already guards). Each now no-ops on non-finite input; +2 specs.
- `emitLinesToChart` wrote `occIdInput` before `onLoad`'s confirm-guard
  could bail → guard moved ahead of the write.
- `applyList` didn't reset `lastEmitted` — a fresh doc kept the prior
  list's emitted lines in state; now cleared; +1 spec.
- `onTabKeydown`'s hardcoded `order = ['rows','lines']` was a FE-4 trap
  (inserting the stepper tab would map `undefined`); order now derives
  from the tab DOM ids — no handler change needed when tabs are added.
- `⇄`/`↻` glyph drift between docs/spec/template — normalized to `↻`
  (sibling convention).
- Spec nits: `dialogData` re-declared the contract inline →
  `ContractListPickerData`; stray `contractId!` removed; provenance date
  pipe renders `'UTC'` (no day-shift near midnight); action buttons got
  `type="button"`.

### Disproved / accepted residuals

- **Escape on a stacked confirm does NOT close the picker behind it** —
  spec-flagged concern; TN verified `OverlayKeyboardDispatcher` dispatches
  Escape to the topmost overlay only and breaks. Not a bug.
- Send is not single-flight-gated (a second send can start during a
  plotted load) — consistent with the generator send and the manual Load
  path; the store's re-reads make it converge; progress-counter noise is
  cosmetic. Accepted as-consistent.
- `aria-controls`→`@if`'d panel idrefs and no roving `tabindex` — the
  repo's `dse-tabs` convention (siblings match); accepted.
- Send label counts rows while the >50 confirm counts unique contracts —
  consistent with paste semantics; accepted.
- Pluralization (`1 lines`, `Send 1 rows`) — literal spec format; accepted.

## Pass 1 — scope

- `components/contract-list-picker/contract-list-picker.component.{ts,html,scss,spec.ts}` — full dialog: Rows tab (checkboxes, 7 toolbar ops, no-selection markers, ↻ repeat badges), Lines preview + Copy, loading/error/empty states, Send-stays-open.
- `pages/option-chart/option-chart.component.ts` — `emitSessionLines` + `openListPicker` `data: { onSend }`; `loadConfirmOpen` guard rescope (in-gate fix).
- `pages/option-chart/option-chart-list.spec.ts` — `onSend` callback test + openDialogs-tracking dialog mock (in-gate fix).
- Pre-review diff capture: `.devin/tmp/1362-review-diff.txt` (924 lines; page `.ts` reviewed at working-tree hunks — the rest of that file's diff belongs to a concurrent de-materify session, out of scope).

## Findings & disposition

### Critical — remediated in-gate

- **Send was dead while the picker stayed open** (Spec + TN converged).
  `onLoad`'s re-entrancy guard read `this.dialog.openDialogs.length` —
  meant to block only the >50-confirm stacking case, but it matched *any*
  open dialog. With Send keeping the picker open, the textarea filled and
  `loadPlotted` silently never ran (the old close-then-emit flow masked
  it; would also have broken FE-4's stepper live-drive).
  **Fix:** guard rescoped to a `loadConfirmOpen` flag wrapped around the
  confirm's `afterClosed` await — `openDialogs` no longer gates `onLoad`.
- **The masking test gap** (Spec + TN): the spec's dialog stub hard-coded
  `openDialogs: []`, so no spec could observe an open dialog.
  **Fix:** the mock's `open()` now registers refs into `openDialogs`; the
  `onSend` test asserts `openDialogs.length === 1` *during* the send and
  the plotted contract lands — a real regression pin.

### Major — remediated in-gate

- **Invented DS token names** (Standards): `--ds-danger`, `--ds-border`,
  `--ds-selected`, `--ds-code-bg` don't exist in
  `vendor/savant-ds/styles/_tokens.scss`; every use fell back to light-theme
  hexes, breaking dark mode. **Fix:** `--ds-error`, `--ds-border-subtle`,
  `--ds-border-strong`, `--ds-selection`, `--ds-surface-raised`; badge now
  uses the `--ds-accent-container` / `--ds-on-accent-container` pair.

### Minor — remediated in-gate

- Anonymous `{ onSend }` contract declared at both ends → exported
  `ContractListPickerData` (component) + `satisfies` (page).
- `DOW` constant duplicated `DAYS` (`features/shared/utils/date.util.ts`)
  → imported.
- `copy()` unhandled rejection on clipboard denial → `try/catch` no-op.
- Stale spec header claimed a `lastEmitted` watcher → corrected to `onSend`.
- Missing coverage (TEST doc): lines-tab empty state, `gap` /
  `out-of-range` reason labels → +3 specs (22 total picker tests).
- Clipboard mock now restored after the copy spec.

### Accepted residuals (documented, not defects)

- **`onTabKeydown` is the 5th copy** of the WAI-ARIA tabs handler —
  repo convention is the copy; flagged for FE-4 (inserting the stepper
  tab must extend the `order` array). Untested, same as its 4 siblings.
- `noSelectionLabel` is a second reason→label map beside the sibling
  table's `REASON_LABELS` — the copy differs intentionally (longer
  explanation text for users vs terse markers).
- `applyRandom`/`applyRange` method guards duplicate `[disabled]`
  bindings — one-line defense kept; Enter-key path on the number input.
- `emitSessionLines → onListSend → emitLinesToChart` is a three-hop
  chain — `onListSend` retained as the spec seam and the symmetric name
  beside `onGeneratorSend`.
- `.send-btn` class exists primarily as a test hook — also a legit style
  hook.
- Specs drive `componentInstance.send()`/`activeTab.set()` directly in
  places rather than simulating clicks — acceptable given real-DOM event
  dispatch elsewhere; template wiring is smoke-covered by rendering.
- `option-chart.component.ts` is ~1,075 lines — the change adds ~20;
  the extraction task (#1392) already tracks the oversize file.

### Deviation note (approved)

IMPL planned `store.lastEmitted` + a page `effect` as the Send seam.
A root `effect` deadlocks the zoneless scheduler while Zone.js is still
loaded (NG0914 state; verified: `TestBed.tick()` hangs even with no emit).
Replaced with the explicit `onSend` callback through `DS_DIALOG_DATA` —
all three axes judged this meets AC-6's spirit ("writes emitted lines to
the pairs input and invokes the existing load path; dialog remains open");
`sendSelected()` still records `lastEmitted` for observability.

## Acceptance criteria trace

| AC | Status |
|---|---|
| Opens populated; first-10 checked | ✅ spec-pinned |
| Every toolbar op; composes w/ manual | ✅ all 7 ops + composition specs |
| no-selection greyed/reason/unselectable/never emitted | ✅ spec-pinned |
| Live readout; M = distinct contractIds | ✅ spec-pinned |
| Lines === emit output; Copy → clipboard | ✅ text equality + writeText spy |
| Send → pairs input + load path; stays open; reopen preserves | ✅ post-fix, incl. open-dialog regression pin |
| loading/error/empty distinct | ✅ all three spec'd |

## Test results

- Full suite: **296 suites / 5,148 tests — all green** (post-remediation sweep: 10 suites / 131 tests on the contract-list + option-chart surface).
- Pass 2 post-remediation sweep: **10 suites / 137 tests — all green** (+6 specs: picker dedupe, close-frees-reopen, destroy-closeAll, NaN guards ×2, lastEmitted reset).
