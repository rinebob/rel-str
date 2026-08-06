# Code Review: Option Chart Sidenav Refactor

**Date:** 2026-07-27  
**Reviewer:** Cascade (thermo-nuclear + /code-review)  
**Branch:** working tree (uncommitted, against HEAD `8029fa2`)  
**Scope:** 4 files changed, +102 / -180 lines (net -78 lines)  
**Spec:** No formal spec — iterative user-directed UI refinements

## Files Changed

| File | Lines (after) | Delta |
|------|--------------|-------|
| `option-chart.component.ts` | 257 | -13 |
| `option-chart.component.html` | 305 | -52 |
| `option-chart.component.scss` | 495 | -17 |
| `contract-catalog-feature.ts` | 218 | +4 |

## Changes Summary

1. Removed `lengthBucketButtons` computed + `onLengthBucketClick` method — replaced by unified Length dropdown
2. Removed `deltaFilterActive`, `ivFilterActive`, `minObsFilterActive` computed properties — Delta/IV/MinObs range filter UI deleted
3. Enhanced `lengthGroups` computed to include contract counts in option labels (e.g., "1 Month (12)")
4. Added `onLengthChange` method — sets both `contractLength` and `contractLengthBucket`, re-queries catalog
5. Added "Both" option to Call/Put toggle — `catalogType` changed from `'C' | 'P'` to `'C' | 'P' | null`
6. Placed Expiration + Strike dropdowns side-by-side in `.exp-strike-row` (60/40 split)
7. Added `dense-select-panel` overlay CSS for all three dropdowns (12px font, themed hover/selected)
8. Widened control panel from 260px to 312px
9. Removed `.bucket-filters` and `.range-filters` SCSS blocks

---

## Thermo-Nuclear Code Quality Review

### Structural Findings

#### 1. MODERATE — Duplicated type-to-catalogType mapping (Duplicated Code)

**File:** `option-chart.component.ts:172, 199`

The expression `this.type() === 'put' ? 'P' : this.type() === 'both' ? null : 'C'` is duplicated verbatim in `ngOnInit` and `onQueryCatalog`. A third variant exists at line 84: `this.type() === 'put' ? 'P' : 'C'` (in `builtOccId`).

**Remedy:** Extract a private `resolveCatalogType()` method.
**Fix:** ✅ Extracted `resolveCatalogType()` in the component and `toCatalogType()` mapping function in `contract-catalog-feature.ts`. Both `ngOnInit` and `onQueryCatalog` now call `this.resolveCatalogType()`.

#### 2. MINOR — `builtOccId` silently produces a Call ID when type is "Both"

**File:** `option-chart.component.ts:84`

When `type === 'both'`, the `builtOccId` computed falls through to `'C'` (via `this.type() === 'put' ? 'P' : 'C'`). The user sees a Call OCC ID populated in the input field even though they selected "Both." This is a silent fallback that could confuse.

**Remedy:** Return `''` when type is `'both'` (can't build a single contract ID for both types).
**Fix:** ✅ Added `if (this.type() === 'both') return '';` guard in `builtOccId` computed.

#### 3. MINOR — Dead CSS classes

**File:** `option-chart.component.scss:463-471, 134`

Three CSS class blocks have no corresponding HTML elements:
- `.contract-strike` (lines 463-466) — not referenced in template
- `.contract-exp` (lines 468-471) — not referenced in template
- `.header-section` (line 134, in `.builder-section, .header-section` selector group) — not referenced in template

**Remedy:** Remove `.contract-strike`, `.contract-exp`, and drop `.header-section` from the shared selector.
**Fix:** ✅ Removed all three dead CSS blocks.

#### 4. MINOR — SCSS file at 495 lines

**File:** `option-chart.component.scss`

The file was 498 lines before this change and is now 495 (net -3 from removing bucket/range filters, adding exp-strike-row + dense-select-panel). The previous review noted this at 498. Not a regression — the change actually reduced the file slightly. The `::ng-deep` Material overrides (dense form fields, dense select panel) account for ~130 lines and are inherently verbose. No action needed unless the file grows further.

#### 5. CLEAN — No file-size regressions

All files are well within limits:
- Component TS: 257 (was 270, guideline: 300)
- Component HTML: 305 (was 337)
- Component SCSS: 495 (was 498)
- Catalog feature: 218 (was 217)

#### 6. CLEAN — No spaghetti growth

The change is primarily **subtraction** — removing buttons, filters, and associated state. The only additions are the `onLengthChange` method (4 lines, clear single responsibility) and the "Both" toggle option (1 line in template + type widening in store). No ad-hoc conditionals were bolted onto unrelated flows.

#### 7. CLEAN — No abstraction regressions

The `lengthGroups` computed was enhanced in-place with count annotations. The spread/map logic is readable and stays within the existing pattern. No new wrappers or indirection layers were added.

### Thermo-Nuclear Summary

- **Structural regressions:** 0
- **Missed simplifications:** 1 (duplicated type mapping — extract `resolveCatalogType()`)
- **Dead code:** 3 CSS classes
- **Silent fallback:** 1 (`builtOccId` producing Call ID for "Both")
- **File size:** No regressions; SCSS slightly improved
- **Verdict:** The change is a net **improvement** — it removes complexity (buttons, range filters, 3 computed properties, ~80 lines of CSS) without adding structural debt. The remaining findings are minor cleanup items.

---

## /code-review: Standards Axis

**Fixed point:** `HEAD` (`8029fa2`)  
**Diff:** `git diff HEAD` — 4 files, +102/-180 lines  
**Standards sources:** `.devin/angular-typescript-rxjs-ngrx-rules.md`, Fowler code smells baseline

### Documented Standard Violations (hard)

None. The change follows existing patterns (SignalStore, computed signals, mat-select panelClass) and does not introduce any new `any`, untyped boundaries, or architecture violations.

### Baseline Smells (judgement calls)

1. **Duplicated Code** — `this.type() === 'put' ? 'P' : this.type() === 'both' ? null : 'C'` appears twice (lines 172, 199). Extract a `resolveCatalogType()` method. (Also finding #1 in thermo-nuclear above.)

2. **Dead Code** — `.contract-strike`, `.contract-exp`, `.header-section` CSS classes have no corresponding HTML elements. Remove them. (Also finding #3 in thermo-nuclear above.)

3. **Primitive Obsession** (pre-existing, not a regression) — ✅ FIXED — Exported `CatalogType` and `ContractTypeFilter` shared types from `contract-catalog-feature.ts` with `toCatalogType()` mapping function. Component now uses `ContractTypeFilter` for its signal type and `toCatalogType()` for the boundary crossing. No inline ternaries remain.

### Standards Summary

- **Hard violations:** 0
- **Judgement calls:** 3 (2 actionable: duplicated mapping, dead CSS; 1 pre-existing: type representation mismatch)
- **Worst issue:** Duplicated type mapping expression

---

## /code-review: Spec Axis

**Spec source:** No formal spec for these changes. They are iterative user-directed UI refinements:
1. "Remove the length bucket buttons, integrate into the Length dropdown with counts and styling"
2. "Remove the Delta/IV/MinObs range filters — not needed here"
3. "Give expiration and strike dropdowns the same styles as length"
4. "Make expiration and strike fit on the same line"
5. "Add a 'Both' option to the put/call toggle"

All five requests appear fully implemented. No requirements are missing or partial. No scope creep detected — the changes are tightly scoped to what was requested.

### Spec Summary

- **Missing/partial:** 0
- **Scope creep:** 0
- **Potentially wrong:** 1 (the `builtOccId` silent Call fallback when "Both" is selected — not explicitly requested behavior, may confuse)
- **Worst issue:** `builtOccId` producing a Call ID when "Both" is selected

---

## Combined Summary

| Axis | Hard/Judgement | Missing/Partial | Scope Creep | Wrong | Worst Issue |
|------|---------------|-----------------|-------------|-------|-------------|
| **Thermo-nuclear** | 0 structural regressions | — | — | 1 silent fallback | Duplicated type mapping |
| **Standards** | 0 hard + 3 judgement (2 actionable) | — | — | — | Duplicated type mapping |
| **Spec** | — | 0 | 0 | 1 | `builtOccId` Call fallback for "Both" |

### Recommended Actions (priority order)

1. ✅ **Extract `resolveCatalogType()` method** — done, also extracted `toCatalogType()` shared mapping function
2. ✅ **Remove dead CSS** — `.contract-strike`, `.contract-exp`, `.header-section` removed
3. ✅ **Fix `builtOccId` behavior for "Both"** — returns empty string (can't build one ID for both types)
4. ✅ **Primitive Obsession** — shared `CatalogType` / `ContractTypeFilter` types with `toCatalogType()` mapping
5. ⏳ **Not addressed:** SCSS file at 485 lines (pre-existing, not a regression)
6. ⏳ **Not addressed:** No unit tests (pre-existing, spec-level gap)

### Approval Status

**Approve with minor cleanup.** No structural regressions, no hard violations, net negative line count. The three findings are minor and non-blocking.
