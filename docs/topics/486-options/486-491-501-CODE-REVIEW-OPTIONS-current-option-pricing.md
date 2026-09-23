# Code Review — #501 CALLS/PUTS/BOTH layout + per-side strike orientation

**Topic:** Current option pricing  
**Topic Slug:** current-option-pricing  
**Thread:** Today's option pricing view  
**Thread Slug:** today-option-pricing-view  
**Issue:** #491  
**Thread Parent:** #487  
**Topic Parent:** #486  
**Task:** #501  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

**Verdict: PASS** — both majors remediated during review; full suite green
(1721 tests / 125 suites), option-chain scope green (436 tests / 20 suites
including pct-change), `tsc` clean for all touched files (one unrelated
pre-existing error in `swing-analysis/symbol-nav.component.ts` — user's
in-progress work, out of scope).

Scope: `option-chain.component.*` (CALLS/PUTS/BOTH toggle, orientation
buttons), `components/chain-grid.component.*` (compact pct-change-parity
cells, DOW/DTE headers, ATM-diff sub-labels, gated ATM scroll),
`utils/chain.utils.*` (`StrikeOrientation`, shared `normalizeOptionType`),
`option-chain.store.ts` (`chainContracts`, loading-flag semantics), plus
dedupe touches in `pct-change.utils.ts` / `pct-change-grid.component.ts` /
`shared/options-common.ts` / `shared/utils/date.util.ts` /
`savant-trader/utils/{contract-observation,option-grid}.utils.ts`.

## Standards

**Remediated during review:**

- **[major → fixed]** Duplicated helpers — `normalizeSide` → shared
  `normalizeOptionType` in `shared/options-common.ts` (pct-change's
  `normalizeType` now delegates); `chainContracts` moved to
  `savant-trader/utils/contract-observation.utils.ts` and re-exported from
  `pct-change.utils.ts`; `daysBetween` lifted to `shared/utils/date.util.ts`;
  `formatAtmDiff` extracted to `savant-trader/utils/option-grid.utils.ts`
  (both grids delegate; dead `atmPctDiff` removed).

**Open (minor/nit):**

- **[minor]** `cellEnter`/`cellLeave` outputs + `cellById` map are speculative
  generality — zero consumers until the hover-popup task (#502-ish). Kept as
  documented forward work.
- **[minor]** `cellById` re-walks the model; `ChainGridModel` could carry a
  `cellsById` map instead.
- **[minor]** `source` stored as unvalidated `string | null` — pct-change
  narrows to `'gcs' | 'live'`.
- **[nit]** `MAX_WALK_BACK_DAYS = 7` vs hardcoded "last 7 days" copy in the
  template.
- **[nit]** `fixture.componentInstance['store']` bracket access in the
  integration spec.
- **[nit]** `isValidIsoDate`-style regex duplicated between
  `session-resolution.utils` and the store's manual-date guard.

## Spec

**Remediated during review:**

- **[major → approved divergence]** #501 asked for a *shared strike column*
  BOTH layout; user approved the implemented two-pane calls-left/puts-right
  design in-app. Issue #501 body updated to record the divergence.
- **[major → implemented]** Per-side strike orientation toggles — added
  `callOrientation`/`putOrientation` signals, `▼/▲` flip buttons per pane
  (independent in BOTH, single toggle in single-type mode), `orientation`
  param on `buildChainGrid`, and ordering specs in `chain.utils.spec.ts` +
  `option-chain.component.spec.ts`.

**Accepted as-in:**

- CALLS/PUTS render a single grid; default orientation high-strike-at-top
  (desc sort, spec'd in `chain.utils.spec.ts`).
- Scope creep reviewed and accepted: ATM centering/highlight, DOW/DTE
  two-line headers, QQQ default + auto-load, `#eef4fb` ATM row tint.
- **[minor]** `scrollIntoView({block:'center'})` may scroll the outer page,
  not just `.grid-scroll` — verify in QA.

## Thermo-nuclear

**Remediated during review:**

- **[major → fixed]** `afterRenderEffect` re-scrolled on every model
  rebuild (prior-snapshot landing would yank scroll). Now keyed on
  `session|atmStrike|firstRow|rowCount` — fires once per distinct model
  identity, re-centers on orientation flip.
- **[major → fixed]** `loading` conflated session + prior fetch; spinner
  held until prior landed (or hung forever if it never emitted). Now
  clears when the session snapshot lands; prior fills the chg column
  behind it.

**Open (minor/nit):**

- **[minor]** `buildChainGrid` runs twice (calls + puts); a single-pass
  `buildChainGrids()` would halve the iteration.
- **[minor]** Store is `providedIn: 'root'` — state survives navigation.
  Intentional (matches filter persistence) but noted.
- **[minor]** Hand-mocked store in the component spec won't compile-fail
  on new store members.
- **[nit]** `onSymbolInput` Event cast; missing specs for `loadToday`,
  in-flight cancel, and the bars-error path.

## Test results

- `npx jest` (full): **1721 passed / 125 suites**, 0 failures.
- `npx jest src/app/features/savant-trader/pages/option-chain`: **436
  passed / 20 suites** (pattern also covered pct-change suites, which
  exercise the deduped helpers).
- `tsc -p tsconfig.app.json` / `tsconfig.spec.json`: clean except one
  unrelated pre-existing error in user's `symbol-nav.component.ts`.

## Deferred to later tasks

- Heatmap/color gradient on cells (explicitly deferred by user).
- Hover popup machinery consumers (#502 territory).
- Filter panel `|delta| <= 0.6` default (IMPL).
