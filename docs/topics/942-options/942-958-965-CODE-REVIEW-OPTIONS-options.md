**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #958  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #965  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# Code Review — #965 Chain-page copy-contract button

## Scope reviewed

Uncommitted working-tree diff (`git diff HEAD -- src/app/features/savant-trader/pages/option-chain/`):

- `components/chain-cell-popup.component.ts` — the popup became interactive: copy button writes `cell().contractID` to `navigator.clipboard`, `check`/`content_copy` feedback icon, `MatSnackBar` on failure, `pointer-events: auto`.
- `components/chain-grid.component.ts` + `.html` — the hover bridge that makes an interactive popup reachable: icon-leave schedules a `POPUP_HIDE_DELAY_MS` (250ms) close instead of instant teardown; popup `mouseenter`/`focusin` cancels, `mouseleave`/`focusout` reschedules; `DestroyRef` + model-rebuild cancellation.
- Both spec files.

The concurrently-edited dialog/option-ticket layout files (`gallery-ticket-dialog`, `option-order-ticket`, `equity-price.service`, mcp quote fields) are a separate workstream the user directed into the QA pass — not reviewed here.

## Verdict: PASS (after in-review remediation, 2 rounds)

Round 1: two majors (convergent Spec+Thermo keyboard/focus defect; Standards test-determinism) + minors/nits — all remediated and spec-pinned.
Round 2 (re-review of the remediated surface): one convergent medium + four lows — all remediated; round-3 audit of the new seams found nothing further.

## Round 2 — re-review findings & resolutions

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| MEDIUM | Thermo + Spec (convergent) | **Asymmetric focus guard.** `onIconLeave` scheduled the hide unconditionally; only `onPopupLeave` checked `containsFocus()` — pointer drifting off the icon while the copy button held focus destroyed the focused element → focus to `<body>`, Escape unreachable. The r1 comment even claimed this was covered | `containsFocus()` hoisted into `schedulePopupHide()` — the single choke point both leave-paths route through; `onPopupLeave` simplified to a bare call |
| MEDIUM | Spec | **Guard path untested.** Keyboard specs dispatched synthetic `focusin` — `activeElement` was never the icon, so the icon's real `focusout` (the event the `.chain-popup-panel` guard exists for) never fired; deleting the guard left every spec green | Specs now call real `icon.focus()` — Enter → `focusCopyButton` fires the genuine `focusout` with `relatedTarget` = copy button through `DelegatedCellHover.focusOut` → `onIconLeave`; spec also asserts icon `mouseout` while focus inside leaves the popup open |
| low | Thermo | **Copy race** — `writeText` in flight during an A→B cell hop let the stale continuation flag `copied` on the new cell | `copyId` captures `cell()` before `await`, bails on mismatch |
| low | Thermo | **Escape bound only inside the popup** — an icon-focused user (popup open via `focusin`) got nothing from Escape | `keydown.escape` added to the icon binding → `closePopup()` (refocus correctly skipped — focus is on the icon, not the popup) |
| low | Standards + Thermo | **Space asymmetric with Enter** — Space's native button `click` only re-fired `onIconEnter`; focus stayed on the icon | `keydown.space` → `onIconActivate($event)` with `preventDefault()` (suppresses the native delegated-click re-open) |
| low | Standards | `'.chain-popup-panel'` / `'.popup-icon-btn'` literals duplicated across template, guards, refocus | `POPUP_PANEL_CLASS` (bound via `[cdkConnectedOverlayPanelClass]`) + `ICON_SELECTOR` statics |
| nit | Spec | Pure-keyboard discovery still needs a prior pointer act to arm the icon | Pre-existing `DelegatedCellHover` scope (`revealIcon` unused); out of #965's AC |
| nit | Thermo | Focused-icon-destroyed-on-cell-leave leaves focus on `<body>` with popup open | Carried from r1 — same pre-existing `DelegatedCellHover` mechanism; out of scope |

## Round 1 findings & resolutions

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| MAJOR | Spec + Thermo (convergent) | **Keyboard path was non-functional.** `focusout` on the icon scheduled the 250ms teardown, but the CDK overlay mounts at `document.body` — outside the grid's tab order — so Tab could never reach `.copy-btn` before the popup died; the spec comment claiming "the grace window lets Tab reach the copy button" described a mechanism that didn't work. Bonus edge: pointer drifting off the popup while the button held focus destroyed the focused element → focus dumped to `<body>` | Icon `keydown.enter` → `onIconActivate()` → rAF → `popup.focusCopyButton()` (programmatic focus, no tab-order dependency). `onIconLeave(to)` cancels the close when `to` is inside `.chain-popup-panel`. `onPopupLeave` skips scheduling while `popupCmp().containsFocus()`. `Escape` → `closePopup()`, which returns focus to the armed icon behind a `suppressFocusOpen` guard (the refocus `focusin` would otherwise reopen the popup). Specs: Enter focuses the button, focused popup survives pointer-leave, focusout closes, Escape closes + refocuses |
| MAJOR | Standards | **Real-time `setTimeout` sleeps in specs** (~2.8s wall clock; 400-vs-250ms margin was timing-fragile) — violates guidelines §10 deterministic-primitives rule | All grace assertions moved to `jest.useFakeTimers()` + `advanceTimersByTime`, keyed on exported constants (`ChainGridComponent.POPUP_HIDE_DELAY_MS`, `POPUP_COPIED_MS`) instead of invisible margins. Fake timers enabled only after overlay attach (`whenStable` deadlocks against the rAF-based CDK attach — documented in the spec helper) |
| minor | Thermo | **`copied` leaked across cells** — icon-A→B hop within the grace reuses the popup instance, so cell B showed cell A's `check` for up to 1.5s | `effect` on `cell()` resets `copied` + clears the timer on re-input; spec pins the reset |
| minor | Standards + Thermo | Popup's 1.5s revert `setTimeout` was not destroy-scoped (grid's own timer is `DestroyRef`-disciplined) | Stored handle cleared on `DestroyRef.onDestroy` and on re-copy |
| minor | Thermo | No `aria-live` on the success state — screen readers heard nothing on copy | `role="status"` visually-hidden live region announces "Contract id copied" |
| minor | Thermo | Coverage gaps in the new lifecycle | Added: destroy-with-pending-hideTimer, Enter→focus, focus-guarded leave, Escape/refocus |
| minor | Spec | Snackbar + check-icon feedback unrequested ("one-liner UI") | Kept — defensible UX, spec-pinned; noted as justified creep |
| nit | Both | Fixture `QQQ251016C00600000` encoded 2025-10-16 while its display `expiration` said 2026-10-16 | Fixture → `QQQ261016C00600000`; round-trip expectation back to 2026-10-16 |
| nit | Standards | `Object.defineProperty(navigator,'clipboard',…)` ×3 | `mockClipboard()` helper |
| nit | Standards | `hoverCell.set(null); hoverOrigin.set(null)` pair in 3 sites | `resetHover()` (effect-safe) + `closePopup()` (focus-aware) helpers |
| nit | Spec | IMPL-948 lists the affordance at `pages/option-chain/option-chain.component.*`; it landed in `components/chain-cell-popup` + `chain-grid` | As-built correction deferred to ship-time docs pass |

## Not findings

- `DelegatedCellHover` unchanged — its `onIconLeave(to)` contract was already `relatedTarget`-aware; pct-change's own consumer untouched.
- Timer discipline otherwise correct: `schedulePopupHide` self-cancels (no double-schedule), `clearHoverOnModel` cancels + clears anchor, destroy clears the timer — no leak/stale-closure paths.
- AC2 contract verified end-to-end: the spec captures the exact `writeText` argument and round-trips it through the real `parseOptionPaste`.

## Test results

- Option-chain tree: **20 suites, 482/482 pass** (includes the new keyboard/escape/destroy/copied-reset coverage + r2 real-focus/icon-leave guards).
- `tsc --noEmit`: clean.
- Focused run incl. dialog + option-ticket + equity-price + mcp-client + gallery-view suites: **294/294**.
- Full suite (`npx jest`): 3776 pass, 43 fail across 2 suites — **both pre-existing baselines unrelated to this diff**: `order.component.spec.ts` ~42 (`Functions` provider not stubbed — known baseline), `shared/screenshot-capture-contracts.spec.ts` 1 (spec stale against #746's shipped `PositionType` expansion; `shared/` untouched by this diff).

## Acceptance criteria

| AC | Status |
|---|---|
| A copy control is reachable from the contract detail surface | **Met** — pointer (hover bridge) and keyboard (Enter → programmatic focus) |
| Clipboard payload is the raw OCC id; paste resolves via `parseOptionPaste` | **Met** — spec round-trips the captured payload through the real parser |
