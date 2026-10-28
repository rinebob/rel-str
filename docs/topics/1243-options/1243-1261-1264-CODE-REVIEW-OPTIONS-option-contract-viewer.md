**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1261  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1264  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

## Scope

`options/chart` page input + plotted-set chips + progress: textarea pair input dispatching `parsePlottedEntries` → `loadContract` (single bare ID) or `loadPlotted`, rejection notice, chips strip (swatch/label/spinner/error/×/click-to-focus), `Loaded X / Y` progress, >50 confirm dialog, `plottedSeriesColor` export.

Diff reviewed: working tree vs HEAD (`e7e2a853`), 5 files, ~600 lines. Three axes run in parallel; majors remediated in-cycle and re-verified.

## Findings & resolutions

### Remediated in-cycle (would have been majors)

| Finding | Severity | Resolution |
|---|---|---|
| Stale `chartFocusContractId` survived `loadPlotted` — pasting a set while a single contract was focused left the chart on the old contract under the new chips | Major (spec F1) | `loadPlotted` clears `chartFocusContractId` unconditionally — Load always means "show this set" (`plotted-contracts-feature.ts:162-170`); regression spec added (loadContract → paste list → set renders) |
| Chip swatch index diverged from series palette once any contract errored — chips indexed the full list, series the non-error list | Major (spec F2 / standards #1) | `chipColorIndex` computed maps contractId → position among non-error contracts — the same set the chart palette indexes (`option-chart.component.ts:500-506`); spec updated to assert contract→color |
| `<span role="button">` nested inside `<button>` — invalid content model, keyboard-inaccessible remove | Major (standards #2) | Chip restructured: non-interactive `.plotted-chip` wrapper containing sibling `.chip-main` (focus) and `.chip-remove` (×) real buttons with `aria-label` (`html:415-446`) |

### Remediated minors/nits in-cycle

- `LARGE_LIST_WARN_THRESHOLD` declared inside the import block → moved below imports.
- Dead `MatDialogModule` component import → removed (service is root-provided; dialog component imports its own module).
- Rejection notice not announced to AT → `role="alert"`.
- `rejectionReasonLabel` `default` branch masked `invalid-contract` → exhaustive 3-case switch.
- `onSelectCatalogContract` fire-and-forget → `void this.onLoad()`.
- Load button/textarea enabled during a plotted batch → disabled while `plottedLoadProgress` is non-null (prevents stacked confirm dialogs and conflated progress).
- Error chips showed a misleading palette swatch → swatch hidden for `status === 'error'`.

### Deferred (nit/scope — not blocking)

- `option-chart.component.ts` at ~790 lines, over the guideline's 400-line smell threshold (pre-existing; chips strip is a future `PlottedChipsComponent` extraction candidate — flagged, not required).
- `ConfirmDialogComponent` imported cross-feature from `option-chain-pct-change/` (second copy exists under `portfolio-dashboard/`); a shared-location move is a future cleanup.
- Clicking a `loading` chip fires a second fetch via `focusPlotted` — harmless retry; tooltip could distinguish.
- Mid-flight `plottedLoadProgress` non-null state is spec-verified for shape but not asserted incrementally; rejection-notice DOM itself is signal-level tested only.

### Confirmed correct / clean

- Dispatch logic matches real contracts; catalog row-click chain (`occIdInput` → `onLoad` → single bare ID → `loadContract`) intact.
- `firstValueFrom(afterClosed())` correct; ESC/backdrop → `undefined` → treated as decline.
- `rejectedEntries` as page-local signal — correct placement (transient form feedback).
- Specs exercise real store + real parser with mocks only at service seams; jest conventions followed.
- Enter no longer submits (textarea newline) — deliberate; noted.
- Chip↔series hover wiring intentionally absent — #1265 scope.
- `displayWindow` default `lifetime` retained — user override during #1263 QA supersedes the task text's `position`; flagged as deliberate, not a defect.

## Test results

| Suite | Result |
|---|---|
| Page + stores focused | PASS — 22 suites, 448 tests (incl. new dispatch/chip/stale-focus specs) |
| Full repo suite | PASS — 269/269 suites, 4639 tests |
| `tsc --noEmit -p tsconfig.app.json` | clean |
| `ng build --configuration development` | clean (template check) |

## Pass 2 — 2026-10-27

Re-review of the remediation delta (the thermo-nuclear axis had already verified most fixes on disk; this pass covered the remainder plus the pass-1 fixes' own side effects):

- **New finding (minor, fixed):** the `plottedLoadProgress` disable gate covered the in-flight window but not the dialog-open window — two rapid Loads could still stack confirm dialogs. Added `this.dialog.openDialogs.length` re-entrancy guard in `onLoad` (`option-chart.component.ts:550`); spec stub updated with `openDialogs: []`.
- Verified: unconditional `chartFocusContractId` clear in `loadPlotted` is correct and unreachable for empty input (page guards `entries.length === 0`); error-swatch hide, `role="alert", exhaustive switch, `void this.onLoad()`, `MatDialogModule` removal, const placement — all trivially correct.
- Focused suite re-run: 22 suites / 448 tests PASS, `tsc` clean.

No new critical or major findings. Remaining open items are the deferred nits listed above.

## Verdict

**PASS** — no open critical or major findings after in-cycle remediation across two passes. Every #1264 acceptance criterion is met; spec-axis per-criterion table all Met (criterion 8 "mostly met" upgraded: notice rendering covered at signal + build/template level, DOM rendering accepted as thin).

## Next

`/proj qa 1243 1264` — UAT doc already staged at `1243-1264-UAT-OPTIONS-option-contract-viewer.md` (rename to include the QA issue # when created).
