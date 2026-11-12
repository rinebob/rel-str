# Code Review — FE: AVWAP settings dialog + leg-semantics rework

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** indicator-lib-st-anchored-vwap  
**Issue:** #835  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #1459  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

Gate review for task #1459 (FE: AVWAP settings dialog — toolbar button + params moved out of the sandbox strip). The reviewed diff also contains the sibling #1466 engine-semantics work (one line per ZigZag leg, shared trigger dots, gap-open dots, per-set persist mode); both were reviewed together as one change set.

## Verdict: FAIL

Major findings exist. Fix and re-run `/proj review 261 1459`.

## Test results

- Full jest suite: **308/308 suites, 5480/5480 tests pass** (90s).
- Spec axis: all six #1459 acceptance criteria verified MET (toolbar button always visible, `DsDialogService.open`, every `avwap-*` control incl. `historyStart` + clear, `onParam`/`paramOverrides` persistence path unchanged, `avwap-params` strip removed, ZigZag strip untouched).

## Major findings

1. **Engine re-derives the surviving-pivot chain that `computeZigZagPivots` already computes.** `walkPivots` (`st-zigzag.pivots.ts:84-119`) overwrites replaced pivots in place, so `computeZigZagPivots().pivots` *is* the surviving-vertex chain. `legsForSet` (`st-anchored-vwap.engine.ts:228-242`) re-implements the superseded-drop from the `AnchorEvent` stream anyway. Swapping to `computeZigZagPivots` removes the `AnchorEvent`/`replaced` model from the AVWAP path entirely — a structural simplification, not cosmetic.
2. **The causal contract doc is stale.** `st-anchored-vwap.engine.ts:4-9` still claims lines draw "from its anchor's confirmation bar … so the output at bar t depends only on bars 0..t" — lines now back-fill to the trigger bar, which can precede the vertex's depth confirmation, and a segment can vanish when its vertex is superseded (the invariants spec was already rewritten to permit this). The header and `types.ts` `endBar` doc must state the new contract explicitly.
3. **Implicit lockstep pairing in `setSegments`.** `st-anchored-vwap.engine.ts:147-153` pairs vertices to triggers by matching `isHigh` in order. It is sound only under the unstated invariant "each vertex's trigger precedes every later same-side vertex's trigger" — an earlier same-side vertex that never triggered silently steals the later one's `TriggerPoint`. Add the source pivot's `barIndex` to `TriggerPoint` and pair by index.

## Minor findings

- Dead code: `.avwap-history`/`.date-anchor` SCSS (`flex-chart-sandbox.component.scss:116-141`); `[class.active]` binding on the settings button has no matching rule (`.avwap-settings-btn` undefined, `.active` exists only under `.interval-btns`) — enabled highlight is a no-op; `avwapHistoryDate` + `parseIsoDateLocal` import (sandbox `.ts:183-186`); `confirmed` field on `AnchoredVwapLegSet` has zero production consumers.
- `as unknown as Event` casts in new spec code (`flex-chart-sandbox.component.spec.ts:579-580, 925`) — documented ban; real `Event` dispatch works (dialog spec `:149`).
- `cdkFocusInitial` in the dialog template without `A11yModule` in `imports` (`avwap-settings-dialog.component.ts:52,156`) — directive never instantiates; silent no-op.
- `avwapDialogRef` never closed in `ngOnDestroy` — overlay can outlive the component.
- Dialog hardcodes `data.values()['historyStart']` (`:137`) and drops all `input==='date'` params from `groups` (`:317`) — a second date param would silently vanish.
- Legacy `showZigZag` fallback divergence (`indicator.ts:228-232`): a persisted `showZigZag:false` hides legs while the per-set Legs checkbox renders ON.
- `isFiniteNum(bar.open)` fallback (`st-zigzag.triggers.ts:80-82`) can emit the level outside the bar's range — the anomaly the gap fix exists to remove.
- File sizes: `flex-chart-sandbox.component.ts` 621 lines (>400 smell, grew ~33); `flex-chart-sandbox.component.spec.ts` 958 (near 1k); `avwap-settings-dialog.component.ts` 361 (>300 target).
- Stale docs/comments: "fixed 16 series" (`flex-chart.component.html:205`, `chart-data-adapter.service.ts:430`, `st-anchored-vwap.indicator.ts:98,267`); FE TEST doc still describes `mat-datepicker`, params-panel-enabled-only rendering, and `showZigZag` — all removed/renamed.
- `[marker]="line.marker"` binds `undefined` for 17/18 series; Syncfusion runtime tolerance unverified.

## Nits

- Duplicated 9-field `sets` literals in `st-anchored-vwap.indicator.ts:219-247` (identical except `line1`/`line2` prefix).
- Regex-derived param grouping + label stripping in the dialog (`:314-329`) vs an explicit `group` field on `IndicatorParamDef`.
- `input: 'radio'` widens the shared `flex-chart.types.ts` contract for one consumer — the ZigZag strip would emit a broken bare `<input type="radio">` if a radio param ever reached it.
- `confirmations: []` assigned then overwritten (`engine.ts:258,309`) — assign in one place.
- `dsDialog` field naming vs the repo's `dialog` convention (26 other injection sites).

## Next step

Address the three majors plus the dead-code/stale-doc minors, then re-run `/proj review 261 1459`.

## Remediation (2026-11-10)

| Finding | Disposition |
|---|---|
| Major 1 — engine re-derives surviving chain | **Fixed** — `computeAnchoredVwapResult` now calls `computeZigZagPivots` and feeds its `pivots` straight to `computeTriggerPoints` and `legsForSet`; the `AnchorEvent`/`replaced` re-derivation is deleted. Side benefit: confirmation dots now cover all surviving pivots (incl. same-bar pairs), strictly matching the standalone ZigZag |
| Major 2 — stale causal contract | **Fixed** — engine header rewritten to state the bounded-retroactivity contract (trigger can precede depth-confirmation; superseded vertices drop their segment); `types.ts` `endBar`, `confirmations`, and `AnchoredVwapConfirmation` docs updated |
| Major 3 — implicit lockstep pairing | **Fixed** — `TriggerPoint` gained `pivotIndex`; `setSegments` pairs by `(isHigh, pivotIndex)` map lookup instead of positional side-matching |
| Dead SCSS + `.active` binding | **Fixed** — `.avwap-history`/`.date-anchor` rules deleted; added the missing `.avwap-settings-btn` rule so the button is styled and the `.active` highlight actually works |
| `as unknown as Event` casts | **Fixed** — `fakeInput`/`fakeCheck` now dispatch real `change` events on detached inputs (target populated) |
| `cdkFocusInitial` without `A11yModule` | **Kept** — matches the repo's existing dialog precedent (`confirm-dialog` has `imports: []`); a repo-wide a11y fix is out of scope |
| `avwapDialogRef` on destroy | **Fixed** — `ngOnDestroy` closes the dialog |
| `historyStart` hardcodes | **Fixed** — test id, value binding, and group exclusion all key off `data.historyParam.key` |
| `showZigZag` legacy desync | **Resolved by removal** — `sanitizeOverrides` strips undeclared keys at load, so `showZigZag`/`showLine1`/`showLine2` can never reach the runtime path. The legacy map, `avwapValues` resolution, `AVWAP_LEGACY_PARAM_KEYS`, `??` fallbacks in the indicator, and the two specs asserting fallback behavior are all deleted |
| `confirmed` legs field | **Fixed** — removed from `AnchoredVwapLegSet`; specs assert `vertices` directly |
| `isFiniteNum` open fallback | **Fixed** — falls back to the bar extreme nearest the level, keeping the dot on the bar |
| File sizes | **Deferred** — sandbox .ts (~635) and spec (~975) predate this change and grew modestly; decomposition is a separate effort |
| Stale "16 series" + TEST doc | **Fixed** — comments updated to 18 series; FE TEST doc sections rewritten for trigger-bar lines, dialog controls, persist mode |
| Duplicated `sets` literals | **Fixed** — folded into a `([1,2] as const).map` builder (no fallbacks — `buildDefaultConfig` always fills the keys) |
| `dsDialog` naming | **Fixed** — renamed to `dialog` per repo convention |
| `confirmations: []` then overwrite | **Fixed** — assigned once inside `legsForSet` |
| `[marker]` undefined on non-Scatter series | **Verified safe** — unchanged binding; Syncfusion treats an unset marker as invisible; chart behavior visually confirmed pre-review |
| Regex param grouping / `input:'radio'` contract / tuple clump | **Kept** — nits; a `group` field or param-model refactor would widen the shared `IndicatorParamDef` contract for one consumer |

Post-remediation: `tsc -p tsconfig.app.json` clean; full jest suite **308/308 suites, 5480/5480 tests**.

## Remediation round 2 (2026-11-10)

| Finding | Disposition |
|---|---|
| Legacy machinery unreachable | **Fixed** — `sanitizeOverrides` drops undeclared keys, so `AVWAP_LEGACY_PARAM_KEYS` / `avwapValues` legacy resolution / indicator `??` fallbacks were dead code — all deleted, along with the specs testing shapes no caller produces |
| `AnchoredVwapLeg.isHigh` doc claimed hue selection | **Fixed** — now documents it as destination-side metadata; legs draw uniform set color |
| `endBar` doc omitted persist mode | **Fixed** — interface doc covers all three end cases: next trigger, last bar while live, last bar under persist |
| Surviving `as unknown as Event` in Trigger Bands spec | **Fixed** — now uses the shared `fakeCheck` helper (real dispatched event) |
| Stale "per-leg hue" comments in remediation edits | **Fixed** — corrected to uniform set color |

Post-remediation: full jest suite **308/308 suites, 5476/5476 tests** (−4 = the two removed legacy-fallback specs).

## Remediation round 3 (2026-11-10)

Round-2 reviewers verified every prior fix. One new MAJOR plus hygiene items:

| Finding | Disposition |
|---|---|
| **MAJOR** — persist mode packs overlapping same-side lines into one series (`k%2` alternation assumed non-overlapping segments) | **Fixed** — fixed contract expanded 18 → 26 keys (4 history slots per side); `k%2` replaced by first-fit interval coloring (`historySlots`): a segment joins the first slot whose contents all end before it starts, so packed series hold one real `y` per bar. Persist overflow **packs** into the oldest slot null-separated rather than evicting — the fan is unbounded (user-confirmed gap: the earlier evict-oldest draft dropped early fan lines). Non-persist tiling still never exceeds 2 slots |
| Orphan confirmation dot — a same-bar collapsed vertex's trigger still lands in `confirmations` | **Kept** — the collapse is a draw-only constraint of the leg chain; the trigger is real and the standalone ZigZag draws the same dot. Dot parity is the stronger contract |
| `endBar + 1` break point can equal the next segment's `startBar` (duplicate index) | **Kept** — on the Category x-axis both points map to the same slot; the null still severs the connector. Spec now asserts the true invariant: indexes non-decreasing, real points unique |
| Stale comments: "a superseded anchor still anchored its segment", "(its side colors the outgoing leg)", "per-leg hues" | **Fixed** — engine `legsForSet` doc, same-bar collapse comment, `AnchoredVwapLineSeries.color` doc, adapter doc corrected |
| Misplaced fake-event JSDoc above `param` helper in sandbox spec | **Fixed** — duplicate removed (original stays at module scope) |
| `TriggerPoint.time`, `AnchoredVwapLeg.isHigh` write-only | **Kept** — `isHigh` documents destination-side identity; `time` is part of the shared trigger shape |
| `computeZigZagAnchorResult`/`AnchorEvent` now spec-oracle only | **Kept** — retained as the invariants spec's independent oracle; removing it would gut the parity checks |
| `MultiColoredLine` + `pointColorMapping` on a uniform-color chain | **Kept** — preserves the per-point color contract the adapter themes |
| `radioValues` `min ?? 0`/`max ?? 0`, `avwapHistoryParam` non-null assert, non-ISO `historyStart` persisting as dead override | **Kept** — dormant/nit; all AVWAP radio defs declare bounds, the history key is declared in the same file, and a malformed date is ignored by the engine |
| Test gap — no spec covered >2 same-side persist segments | **Fixed** — new spec asserts no history series holds duplicate real indexes across persist on/off on a dense random walk |

Post-remediation: full jest suite **308/308 suites, 5477/5477 tests**; `tsc` clean. Remaining findings are minors/nits with documented dispositions — no unresolved majors.

## Verdict (round 3, 2026-11-10)

**PASS** — all six acceptance criteria met (spec axis, re-verified), every round-1/2 major and minor resolved or dispositioned, the round-2 persist-packing major fixed structurally with invariant test coverage, and the full suite green.
