# Thermo-Nuclear + Code Review: Options Chart Session (2026-07-26)

**Review date:** 2026-07-26
**Scope:** All uncommitted changes (working tree vs HEAD)
**Files changed:** 13 files, +463 / -53 lines

## Files Reviewed

- `firestore.rules`
- `functions/src/index.ts`
- `functions/src/options-contract.callables.ts`
- `shared/options-contract-contracts.ts`
- `src/app/core/common/constants.ts`
- `src/app/features/rh-agent/components/options-contract-chart/options-contract-chart.component.html`
- `src/app/features/rh-agent/components/options-contract-chart/options-contract-chart.component.scss`
- `src/app/features/rh-agent/components/options-contract-chart/options-contract-chart.component.ts`
- `src/app/features/rh-agent/pages/option-chart/option-chart.component.html`
- `src/app/features/rh-agent/pages/option-chart/option-chart.component.scss`
- `src/app/features/rh-agent/pages/option-chart/option-chart.component.ts`
- `src/app/features/rh-agent/services/options-contract.service.ts`
- `src/app/features/rh-agent/stores/options-contract-viewer.store.ts`

---

## Part 1: Thermo-Nuclear Code Quality Review

### 1. [HIGH] Duplicated date-padding arithmetic across three call sites

**Problem:** The same "compute padded from/to date range" logic is copy-pasted in three places in `options-contract-viewer.store.ts`:
- `loadContract()` (lines ~275-280)
- `addPadDays()` (lines ~408-415)
- `resetPadDays()` (lines ~424-430, though this one uses unpadded)

All three compute `padMillis`, construct `new Date(data.startDate + 'T00:00:00.000Z')`, add/subtract milliseconds, and call `.toISOString().slice(0, 10)`. This is a textbook Duplicated Code smell.

**Fix:** Extract a helper:
```ts
function paddedDateRange(startDate: string, endDate: string, padDays: number): { from: string; to: string } {
  const padMillis = padDays * 24 * 60 * 60 * 1000;
  const from = new Date(new Date(startDate + 'T00:00:00.000Z').getTime() - padMillis);
  const to = new Date(new Date(endDate + 'T00:00:00.000Z').getTime() + padMillis);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
```
Then `loadContract`, `addPadDays`, and `resetPadDays` all call it.

---

### 2. [HIGH] Duplicated `parseObservations + padObservations` call in `xLabels` computed

**Problem:** In `options-contract-viewer.store.ts`, the `xLabels` computed re-runs the exact same `padObservations(parseObservations(data.series), state.chartPadDays())` pipeline as `observations`, then just maps to `.date`. This means the full parse+pad work runs twice on every change.

**Fix:** Either (a) derive `xLabels` from `observations` by having `withComputed` reference the `observations` computed signal, or (b) extract a shared helper that returns the padded array once and cache it. Option (a) is simplest if the NgRx signal store supports referencing earlier computeds within the same `withComputed` block. If not, a `computed` that calls a memoized helper would work.

---

### 3. [MEDIUM] Duplicated underlying-fetch subscribe pattern across three methods

**Problem:** `loadContract`, `addPadDays`, and `resetPadDays` all contain the same subscribe boilerplate:
```ts
patchState(store, { underlyingLoading: true });
rsBarsService.getDailyBars$(data.symbol, { from, to }).subscribe({
  next: (bars) => patchState(store, { underlyingBars: bars, underlyingLoading: false }),
  error: () => patchState(store, { underlyingBars: [], underlyingLoading: false }),
});
```

**Fix:** Extract a private helper method `fetchUnderlying(symbol, from, to)` that encapsulates the loading state toggle and subscribe pattern.

---

### 4. [MEDIUM] `console.log` left in `ngOnInit`

**Problem:** `option-chart.component.ts` line ~151:
```ts
console.log('[OptionChart] ngOnInit, loading index for:', sym);
```
This is debug logging that should not ship to production.

**Fix:** Remove the `console.log` line.

---

### 5. [MEDIUM] `formatExpWithDow` uses local timezone, may show wrong day for edge cases

**Problem:** `option-chart.component.ts`:
```ts
formatExpWithDow(exp: string): string {
  const date = new Date(exp + 'T00:00:00');
  const dow = date.toLocaleDateString('en-US', { weekday: 'short' });
  return `${exp} (${dow})`;
}
```
Uses local time (`T00:00:00` without `Z`), whereas the rest of the store uses UTC (`T00:00:00.000Z`). In timezones behind UTC, this could show the wrong weekday for late-night users. Inconsistent with the UTC convention used elsewhere.

**Fix:** Use `new Date(exp + 'T00:00:00.000Z')` and `toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })`.

---

### 6. [LOW] `SA_PROJECT_ID` env var fallback hides missing config

**Problem:** `options-contract.callables.ts`:
```ts
const SA_PROJECT_ID = process.env.SA_PROJECT_ID || 'alpha-vantage-proxy-api';
```
Silent fallback to a hardcoded project ID. If the env var is missing in a different environment, this will silently target the wrong project.

**Fix:** Acceptable for now since the fallback is the correct production value, but worth a `logger.info` at cold start to confirm which project ID is being used.

---

### 7. [LOW] `getSaFirestore` singleton pattern is clean but could use `getApps` check simplification

**Problem:** The `getSaFirestore` function manually checks `getApps().find(a => a.name === appName)` before initializing. This is correct but verbose.

**Fix:** Minor — the pattern is fine and defensive. No action needed unless the codebase has a canonical Firebase init helper.

---

### 8. [LOW] `firestore.rules` — redundant nested match blocks

**Problem:** The new `options-file-index` rules define read/write on the parent match block AND on the two child match blocks (`ts-expirations`, `ts-strikes`). The child rules are redundant since the parent already covers all subpaths.

**Fix:** Either keep only the parent rule, or keep the child rules and remove the parent's blanket read/write. The current form is not wrong, just redundant.

---

## Part 2: Code Review (Standards + Spec)

### Standards Axis

No repo-level `CODING_STANDARDS.md` or `CONTRIBUTING.md` found. Reviewing against the Fowler smell baseline.

#### S1. [JUDGEMENT] Duplicated Code — date padding arithmetic
Same as thermo finding #1. Three copies of the same date-math logic.
**Smell:** Duplicated Code

#### S2. [JUDGEMENT] Duplicated Code — underlying fetch subscribe
Same as thermo finding #3. Three copies of the same subscribe pattern.
**Smell:** Duplicated Code

#### S3. [JUDGEMENT] Duplicated Code — parseObservations + padObservations double execution
Same as thermo finding #2. The `xLabels` computed duplicates the `observations` pipeline.
**Smell:** Duplicated Code

#### S4. [JUDGEMENT] Shotgun Surgery — `chartPadDays` touches 4 files for one feature
Adding padding required changes to store (state + 3 methods), chart component (input + effect + axis), page component (template binding + buttons), and SCSS. This is expected for a cross-cutting feature, but the store changes could be more cohesive if the padding logic lived in a single helper.

#### S5. [JUDGEMENT] Middle Man — `expiration` and `strike` computed wrappers
`option-chart.component.ts`:
```ts
readonly expiration = computed(() => this.store.selectedExpiration());
readonly strike = computed(() => this.store.selectedStrike());
```
These are identity wrappers — they add a signal layer with no transformation. Same pattern that was flagged and fixed in the chart-review thermo review (finding #5).
**Fix:** Assign directly: `readonly expiration = this.store.selectedExpiration;`

#### S6. [JUDGEMENT] Mysterious Name — `nullObs` factory in `padObservations`
The inner function `nullObs` creates a full null-valued `ParsedObservation`. The name is adequate but could be `createEmptyObservation` for clarity. Minor.

### Spec Axis

No formal spec/PRD found for this session's work. The work spans multiple user requests across the session:

1. **Fix Firestore dropdowns** — populate expirations/strikes via cross-project callable
2. **Cross-filtering** — selecting expiration filters strikes and vice versa
3. **Sidebar width increase** — +25% width
4. **Horizontal scrollbar fixes** — eliminate overflow
5. **Vertical scrollbar consolidation** — single scrollbar in sidebar
6. **Volume/OI panel on by default**
7. **OI axis separation** — separate opposed axis for Open Interest
8. **Day of week in expiration dropdown**
9. **Chart date padding** — add +20d/+50d buttons to extend visible range

All nine items appear implemented in the diff. Checking for gaps:

#### SP1. [OBSERVATION] `resetPadDays` does not reset `chartPadDays` before fetching
`resetPadDays` sets `chartPadDays: 0` then fetches with `data.startDate`/`data.endDate` (unpadded). This is correct behavior. No issue.

#### SP2. [OBSERVATION] No loading indicator for pad operations
Clicking `+20d` or `+50d` triggers `underlyingLoading: true`, which shows the existing "Loading underlying..." spinner. This is adequate feedback.

#### SP3. [OBSERVATION] `loadContract` clears `underlyingBars` to `[]` on start, causing a flash
When loading a new contract, `patchState(store, { loading: true, error: null, contractData: null, underlyingBars: [] })` clears everything. The chart will briefly show empty before the new data loads. This is pre-existing behavior, not introduced by this session's changes.

---

## Summary

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| Thermo-Nuclear | 8 (2 HIGH, 3 MEDIUM, 3 LOW) | #1: Duplicated date-padding arithmetic across 3 call sites |
| Standards | 6 judgement calls | S1/S2/S3: Three instances of Duplicated Code |
| Spec | 3 observations (no issues) | All 9 user requests appear implemented |

### Recommended Action Items (priority order)

1. **Extract `paddedDateRange` helper** — eliminates thermo #1 / standards S1
2. **Extract `fetchUnderlying` helper** — eliminates thermo #3 / standards S2
3. **Fix `xLabels` double-parse** — eliminates thermo #2 / standards S3
4. **Remove `console.log`** in `ngOnInit` — thermo #4
5. **Fix timezone in `formatExpWithDow`** — thermo #5
6. **Remove identity wrappers** for `expiration`/`strike` — standards S5
7. **Remove redundant child rules** in `firestore.rules` — thermo #8 (optional)

---

# Round 2: Post-Fix Review (2026-07-26)

**Scope:** Re-review of all uncommitted changes after applying fixes for thermo #1, #2, #3, #4, #8, finding #5, and spec S5. Also includes user's manual change (DateTimeCategory → Category axis with `onAxisLabelRender` for date formatting).
**Files changed:** 13 files, +478 / -74 lines

## Fix Verification

### Thermo #1 — Extract `paddedDateRange` helper ✅ FIXED
- New standalone `paddedDateRange()` function at line 126 of `options-contract-viewer.store.ts`
- Used by `loadContract`, `addPadDays`, and `resetPadDays` — all three call sites now call the shared helper
- No remaining copies of the date-math arithmetic

### Thermo #2 — Fix `xLabels` double-parse ✅ FIXED
- Split into a second `withComputed` block (line 258) so `xLabels` references `state.observations()`
- `xLabels` is now a simple `.map((obs) => obs.date)` — no re-parse
- Single parse+pad pipeline runs once per change

### Thermo #3 — Extract `fetchUnderlyingBars` helper ✅ FIXED
- Defined as a local function inside `withMethods` (line 264), capturing `rsBarsService` and `store` from closure
- All 3 call sites use `fetchUnderlyingBars(symbol, from, to)` — no subscribe boilerplate duplication

### Thermo #4 — Remove `console.log` ✅ FIXED
- Debug `console.log` removed from `ngOnInit` in `option-chart.component.ts`

### Thermo #8 — Remove redundant firestore.rules child blocks ✅ FIXED
- Removed redundant `ts-expirations` and `ts-strikes` child match blocks
- Parent `match /options-file-index/{symbol}` covers all subpaths

### Finding #5 — Fix timezone consistency ✅ FIXED
- `formatExpWithDow`: now uses `new Date(exp + 'T00:00:00.000Z')` with `timeZone: 'UTC'`
- `onAxisLabelRender`: same UTC fix — `new Date(args.text + 'T00:00:00.000Z')` with `timeZone: 'UTC'`
- Both now consistent with the UTC convention used throughout the store

### Spec S5 — Remove identity wrappers ✅ FIXED
- `expiration` and `strike` now assign store signals directly: `readonly expiration = this.store.selectedExpiration`
- `formatExpWithDow` made `private`, replaced in template by `expirationOptions()` computed signal
- Template uses `@for (opt of expirationOptions(); track opt.value)` — no method calls in template

---

## Part 1: Thermo-Nuclear Code Quality Review (Round 2)

### T2-1. [LOW] `withMethods` uses function-returning-object pattern instead of arrow-object

**Problem:** `withMethods` was changed from `=> ({ ... })` to `=> { function fetchUnderlyingBars() {...} return { ... }; }` to allow the inner function. This is correct and necessary, but the closing `};` on line 434 has an extra semicolon after the object literal inside the return statement. Not a bug, just slightly unusual style.

**Status:** Acceptable — the pattern is required to define the closure. No action needed.

### T2-2. [LOW] `console.error` remains in `loadContractIndex` error handler

**Problem:** `options-contract-viewer.store.ts` line 381:
```ts
console.error('[loadContractIndex] error:', err);
```
This is an error-path log, not debug logging. Acceptable for production error visibility, but inconsistent with the removal of `console.log` in thermo #4. If the codebase has a canonical error-logging pattern, this should use it instead.

**Status:** Acceptable — error logging in catch blocks is standard practice. No action needed unless a canonical logger exists.

### T2-3. [LOW] `SA_PROJECT_ID` env var fallback (unchanged from round 1)

**Problem:** Still present in `options-contract.callables.ts`. The hardcoded fallback `'alpha-vantage-proxy-api'` is the correct production value.

**Status:** Acceptable for now. Could add a cold-start `logger.info` to confirm which project ID is used.

### T2-4. [INFO] No file crosses 1,000 lines

All changed files remain well under 1,000 lines. The store is the largest at ~437 lines. No decomposition concerns.

### T2-5. [INFO] No new ad-hoc branching or special-case conditionals

The padding logic is cleanly extracted into `paddedDateRange` and `padObservations`. No spaghetti growth detected.

### T2-6. [INFO] No unnecessary wrappers or casts

The `expirationOptions` computed is a legitimate transformation (maps string array to `{value, label}` array), not an identity wrapper. `fetchUnderlyingBars` encapsulates real shared logic.

---

## Part 2: Code Review — Standards + Spec (Round 2)

### Standards Axis

No repo-level coding standards docs found. Reviewing against Fowler smell baseline.

#### S2-1. [PASS] Duplicated Code — date padding arithmetic
**Resolved.** Single `paddedDateRange` helper used by all 3 call sites.

#### S2-2. [PASS] Duplicated Code — underlying fetch subscribe
**Resolved.** Single `fetchUnderlyingBars` closure used by all 3 call sites.

#### S2-3. [PASS] Duplicated Code — parseObservations + padObservations double execution
**Resolved.** `xLabels` derives from `state.observations()` via a second `withComputed` block.

#### S2-4. [PASS] Middle Man — identity wrappers
**Resolved.** `expiration` and `strike` assign store signals directly. `formatExpWithDow` is now private, used only by the `expirationOptions` computed.

#### S2-5. [JUDGEMENT] Duplicated Code — `formatExpWithDow` date formatting duplicates `onAxisLabelRender` logic
**Observation:** Both `formatExpWithDow` (in `option-chart.component.ts`) and `onAxisLabelRender` (in `options-contract-chart.component.ts`) parse a `YYYY-MM-DD` string as UTC and format it with `toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })`. The logic is nearly identical:
```ts
// formatExpWithDow
const date = new Date(exp + 'T00:00:00.000Z');
const dow = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

// onAxisLabelRender
const date = new Date(args.text + 'T00:00:00.000Z');
args.text = date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
```
They produce different output formats (one adds weekday, the other formats as month/day), so they're not exact duplicates. However, the UTC date parsing pattern is repeated. A shared `formatUtcDate(dateStr, options)` helper could eliminate the duplication, but this is a judgement call — the two functions serve different purposes and live in different components.

**Status:** Minor. Not a blocker. Could extract a shared helper if more date-formatting sites appear.

#### S2-6. [PASS] Mysterious Name — `nullObs` factory in `padObservations`
Still present but adequate. `nullObs` creates a null-valued observation. Name is clear in context.

#### S2-7. [PASS] No new Shotgun Surgery
The `chartPadDays` feature touches 4 files, but this is expected for a cross-cutting feature (store state + chart input + UI buttons + styles). The store changes are now cohesive thanks to the extracted helpers.

### Spec Axis

No formal spec/PRD. All 9 user requests from the session appear implemented:

1. ✅ Firestore dropdowns via cross-project callable
2. ✅ Cross-filtering (expiration↔strike)
3. ✅ Sidebar width increase (220px → 290px)
4. ✅ Horizontal scrollbar fixes
5. ✅ Vertical scrollbar consolidation
6. ✅ Volume/OI panel on by default
7. ✅ OI axis separation (separate opposed axis)
8. ✅ Day of week in expiration dropdown (via `expirationOptions` computed)
9. ✅ Chart date padding (+20d/+50d/Reset with underlying fetch extension)

#### SP2-1. [OBSERVATION] `initVisibleRange` uses `padDays` from chart input, not from observations length

The `initVisibleRange` effect sets `{ min: -pad, max: obs.length - 1 + pad }`. Since `observations` already includes the padded null entries, `obs.length` is `baseCount + 2*pad`. So the actual visible range is `{ min: -pad, max: baseCount + 2*pad - 1 + pad }` = `{ min: -pad, max: baseCount + 3*pad - 1 }`. This means the visible range extends beyond the data by an extra `pad` on the right side.

**Wait** — let me re-check. The `padDays` input to the chart component is `store.chartPadDays()`. The `observations` input is `store.observations()` which already has `2*pad` padding entries. So `obs.length = baseCount + 2*pad`. The visible range is `{ min: -pad, max: baseCount + 2*pad - 1 + pad }` = `{ min: -pad, max: baseCount + 3*pad - 1 }`. But the actual data indices are `0` to `baseCount + 2*pad - 1`. So the visible range extends `pad` indices beyond the data on the right.

**However**, the `padDays` input and the `observations` input both derive from `store.chartPadDays()`. The observations already include the padding. So `min: -pad` goes `pad` indices before index 0 (which is already the first padded date), and `max: obs.length - 1 + pad` goes `pad` indices beyond the last padded date. This means the visible range is wider than the data by `pad` on each side — showing empty space beyond even the padded dates.

**This may be intentional** (the user wanted "padding on either side" of the options data, and the padded observations provide the underlying line context, while the extra visible range provides empty space). But it could also be a bug where the visible range should be `{ min: 0, max: obs.length - 1 }` since the padding is already in the observations.

**Status:** Potential issue. The visible range may be double-padding. Needs user confirmation — if the chart shows too much empty space beyond the underlying line, the fix is to change `initVisibleRange` to `{ min: 0, max: obs.length - 1 }` since observations already include padding.

#### SP2-2. [PASS] `loadContract` retains padding across contract changes
`loadContract` uses `paddedDateRange(data.startDate, data.endDate, store.chartPadDays())` — padding is preserved.

#### SP2-3. [PASS] `resetPadDays` fetches unpadded range
`resetPadDays` calls `fetchUnderlyingBars(data.symbol, data.startDate, data.endDate)` — correct unpadded fetch.

---

## Summary (Round 2)

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| Thermo-Nuclear | 6 (0 HIGH, 0 MEDIUM, 3 LOW, 3 INFO) | T2-2: `console.error` in error handler (acceptable) |
| Standards | 7 (6 PASS, 1 JUDGEMENT) | S2-5: Minor date-formatting duplication across components |
| Spec | 3 (1 OBSERVATION, 2 PASS) | SP2-1: Potential double-padding in visible range |

### Fix Status

| Original Finding | Status |
|-----------------|--------|
| Thermo #1 (duplicated date math) | ✅ Fixed |
| Thermo #2 (xLabels double-parse) | ✅ Fixed |
| Thermo #3 (duplicated fetch subscribe) | ✅ Fixed |
| Thermo #4 (console.log) | ✅ Fixed |
| Thermo #5 (timezone) | ✅ Fixed (also fixed in `onAxisLabelRender`) |
| Thermo #8 (redundant rules) | ✅ Fixed |
| Spec S5 (identity wrappers) | ✅ Fixed (also moved to computed in template) |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| SP2-1 | OBSERVATION | `initVisibleRange` may double-pad — visible range extends beyond padded observations by `pad` on each side. Needs user confirmation. |
| S2-5 | JUDGEMENT | Minor date-formatting duplication between `formatExpWithDow` and `onAxisLabelRender`. Not a blocker. |

### Approval

**Thermo:** ✅ No structural regressions. No missed simplification opportunities. No file-size concerns. No spaghetti growth.

**Standards:** ✅ All round 1 smells resolved. One minor judgement call on date-formatting duplication.

**Spec:** ⚠️ One observation (SP2-1) needs user confirmation on whether the visible range behavior is intentional.
