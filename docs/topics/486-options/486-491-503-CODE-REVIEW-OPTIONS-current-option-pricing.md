# Code Review — Task #503: Filters, header, date controls, states

**Topic:** #486 Current option pricing
**Topic Slug:** `current-option-pricing`
**Issue:** #491 (FE Blueprint)
**Task:** #503 Filters, header, date controls, and empty/error states
**Topic Parent:** #486
**Domain:** OPTIONS
**Type:** CODE-REVIEW
**Status:** Complete (PASS, 2nd pass; 1st pass FAIL)
**Created:** 2026-09-24
**Last Updated:** 2026-09-24

Reviewed the uncommitted diff for task #503: `option-chain.component.{ts,html,scss}`,
`option-chain.component.spec.ts`, `option-chain.integration.spec.ts`,
`option-chain.store.ts`, `utils/session-resolution.utils.ts`, `utils/chain.utils.ts`.

Three axes ran in parallel (Standards, Spec, Thermo-nuclear). First-pass
verdicts were **FAIL / PASS-with-majors / FAIL**; all critical and major
findings were fixed and re-verified within this review cycle.

## Acceptance criteria

| # | Criterion | Verdict | Notes |
|---|---|---|---|
| 1 | Delta band defaults \|Δ\| ≤ 0.6 | MET (documented deviation) | Superseded by explicit user request — ships unbounded-by-default; deviation commented on #503 |
| 2 | Datepicker + manual entry + Today | MET | `mat-datepicker` via invisible rendered anchor input; manual Enter commit; Today → `store.loadToday()` |
| 3 | Header: company info, closes, date, source | MET | `companyName` from `SymbolListStore.profilesBySymbol`; close/prior/%, resolvedDate, source label |
| 4 | No-data (7-day) + fetch-error states | MET | Auto-mode names the window; manual picks now name the requested date; errors name the actually-failed candidate date |
| 5 | Invalid manual date → validation, no fetch | MET | Shared `isValidIsoDate` (round-trip check catches Feb 31); inline `role="alert"` message; store backstop guard |

## Findings — first pass

### Critical
None.

### Major
- **[FIXED] Datepicker popup anchored to viewport (0,0)** — `type="hidden"`
  input gives `getConnectedOverlayOrigin()` an all-zeros rect (Material 20
  `datepicker.mjs:3049,3559`). Replaced with a rendered, zero-size,
  uninteractive `.date-anchor` (`position:absolute; opacity:0`) inside a
  `position:relative` `.date-control` — real rect at the control.
- **[FIXED] Strike-range + expiration-window filters missing** (Spec axis,
  PRD US-7) — added `strikeGte`/`strikeLte` to `ChainGridFilter`,
  `buildChainGrid`, page signals, header inputs, and specs. Expiration
  window is covered by the column picker's per-expiration + DTE-band
  selection (documented deviation — no contiguous from/to date inputs).
- **[FIXED] Manual-mode no-data message didn't name the picked date** —
  page state now renders `No chain data found for {date}` when a manual
  session resolves empty; auto mode still names the 7-day window.

### Minor
- **[FIXED] Impossible calendar dates passed validation** — `Date.parse`
  normalizes `2026-02-31` → Mar 3. Added shared `isValidIsoDate()` in
  `session-resolution.utils.ts` (round-trip check); used by both the
  component's inline validation and the store's `loadChain` guard.
- **[FIXED] Error label didn't name the actual failed date** — added
  `SessionFetchError` carrying the candidate date; `resolveSession$` wraps
  fetch errors; store renders `{failedDate}: {msg}`.
- **[FIXED] Invalid label semantics** — `<label>` wrapped two inputs + a
  toggle; now a `div.date-control` with `aria-label` on the visible input.
- **[FIXED] `source` label untested; `(dateChange)` wiring unexercised** —
  added specs for source render, anchor↔picker association
  (`MatDatepickerInput._datepicker === sessionPicker`), strike filter,
  cleared-date→Today, dated/auto no-data, impossible-date rejection.
- **[FIXED] Duplicate date validation** — regex+parse lived in component
  and store; now single shared `isValidIsoDate`.
- **[FIXED] `date-error` not announced** — added `role="alert"`.
- **[FIXED] Hardcoded colors** — new styles use `--mat-sys-*` tokens.

### Nit (accepted, non-blocking)
- `(keydown.enter)` now routes through `onDateCommitEvent($event)` —
  typed handler, no `$any`.
- Transient per-symbol localStorage write on mid-typing symbol keystrokes
  self-cleans (persist effect removes the key when the set loads empty).
- `loadProfiles()` per visit is session-cached + deduped by design.
- `mat-datepicker-toggle` inside a plain `div` — no label-association
  quirks remain after the label→div change.

## Findings — second pass (scroll-sync rewrite + column picker)

Scope: user-reported calls/puts scroll-sync failures, the DTE-band column
picker, and the fixes for it. Three axes ran again (Standards, Spec,
Thermo-nuclear) over the expanded diff (11 files).

### Mechanism history (what the diff now ships)

- Fractional `scrollTop` sync — **rejected**: panes aren't row-isomorphic
  (different strike sets, ATM trims, orientations), so position ≠ strike.
- Strike-anchored sync — worked but reversed scrollbar direction under
  opposite orientations; replaced by direction-preserving mapping.
- Delta sync — matched the mental model but accumulated clamped
  overscroll at boundaries into a persistent row gap.
- **Final: absolute-from-baseline sync** — `sibPos = sibBaseline +
  (srcPos − srcBaseline)`, recomputed per event. Boundary clamps
  self-heal; echo writes are no-ops (no suppression bookkeeping). Same
  scrollbar direction in both orientation modes (desc calls + asc puts =
  OTM-at-top). Re-sync centers each pane on its own ATM and re-anchors.
- `ChainGridComponent.centered` output — auto-centering re-anchors the
  pair via `resync()`; single producer of the aligned state.
- `scrollToStrike` locates the target row by its own rect
  (`[data-strike]` attr selector) — immune to sticky/offsetParent
  coordinate mixing that broke the earlier `firstTop` math.

### Fixed in second pass

- **[FIXED] Corrupt column-state JSON kept the previous symbol's sets** —
  catch now resets all three sets to all-visible.
- **[FIXED] Baselines stale after model rebuild/orientation flip** —
  `resetSyncOnRebuild` effect clears baselines on any model change;
  `centered` → `resync()` re-anchors.
- **[FIXED] No-ATM sessions never centered** — `atmStrike` null (missing
  underlying close) → middle-row fallback; auto-center uses
  `scrollToStrike` inside `requestAnimationFrame` (layout settled).
- **[FIXED] Band model leaked into shared `option-grid.utils.ts`** —
  moved to feature-local `utils/column-visibility.utils.ts`; band labels
  now match their bounds (`16–30d`, `31–60d`, `61–120d`, `121–365d`).
- **[FIXED] Column-state keys `{b,h,s}` opaque** — persisted as
  `{bands, hidden, shown}` with back-compat read.
- **[FIXED] Duplicate invalid-date literal** — shared
  `invalidIsoDateMessage()`.
- **[FIXED] Util-level test gap** — `isValidIsoDate` round-trip +
  `SessionFetchError.date` contract specs added.

### Accepted (non-blocking)

- `ColumnState` single-signal refactor — current shape defensible.
- `scrollerEl()` DOM reach — pragmatic under `viewChildren`.
- `.date-anchor` diverges from the repo's `[matDatepicker]`-on-input
  idiom — justified (see Design notes).
- Spec reads private `MatDatepickerInput._datepicker` — covers a real
  contract nothing else reaches.

## Test results

- Option-chain + pct-change suites: **20 suites / 474 tests — all green**.
- Full suite: **132 suites / 1812 tests — all green**.
- `tsc --noEmit` clean on `tsconfig.app.json` and `tsconfig.spec.json`.

## Design notes

- The `.date-anchor` pattern (rendered-but-invisible `matDatepicker`
  input) is deliberate: the picker throws without an associated input, and
  a visible `MatDatepickerInput` would (a) reformat `YYYY-MM-DD` through
  the locale adapter and (b) parse ISO text as UTC midnight → off-by-one
  in US timezones. Documented in the template comment.
- `onPickedDate` formats the picker's local-midnight `Date` via local
  parts — never `toISOString`.

## Verdict

**PASS** — all ACs met (AC 1 + expiration-window with documented
deviations); all critical/major findings from both passes fixed and
verified by specs and typecheck; remaining nits accepted as
non-blocking. Scroll sync verified manually in-browser: same-direction
tracking in both orientation modes, boundary-clamp self-heal, ATM
centering on load, Re-sync re-anchor.
