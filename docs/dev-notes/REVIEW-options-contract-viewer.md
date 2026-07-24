# Code Reviews — Options Contract Viewer

Review log for the options contract viewer feature. Each section is appended to as new reviews are run.

---

## Thermo-Nuclear Code Quality Reviews

### Review 1 — 2026-07-23

**Scope:** All uncommitted changes for the options contract viewer feature (7 modified files, 5 new files)  
**Reviewer:** Cascade (automated)

**Summary:** The feature is well-structured at a macro level — clean separation between page, chart component, store, and service. However, there are several structural issues that should be addressed before merging.

**Verdict: Changes requested.** 3 structural findings, 2 decomposition findings, 3 boundary/type findings.

#### 1. Structural Code-Quality Regressions

**1.1 Duplicated OCC ID parser — two implementations with drift risk** ✅ FIXED

`parseOccContractId` in `functions/src/partner-proxy.ts:511-526` and `parseOccId` in `src/app/features/rh-agent/services/options-contract.service.ts:60-78` implement the same regex and parsing logic with slightly different return shapes:

- Backend returns `{ symbol, expiration, type: 'CALL' | 'PUT', strike }`
- Frontend returns `{ symbol, contractID, expiration, type: 'call' | 'put', strike }`

The regex (`/^([A-Z]+)(\d{6})([CP])(\d{8})$/`), date extraction, and strike division are identical. This is a classic Duplicated Code smell. If the OCC format changes or a bug is fixed in one, the other will silently drift.

**Remedy:** Extract the parser into the shared boundary (e.g., `shared/` directory) and import from both sides, or at minimum document the duplication with a cross-reference.

**Fix applied:** Created `shared/options-contract-contracts.ts` with canonical `parseOccContractId` + `ParsedOccContractId` interface. Both backend (`partner-proxy.ts`) and frontend (`options-contract.service.ts`) now import from `@options-contract/contracts`. Path alias added to both `tsconfig.json` and `functions/tsconfig.json`.

**1.2 Duplicated request/response types across FE/BE boundary** ✅ FIXED

Three types were duplicated between `functions/src/types/partner.ts` and `src/app/core/models/partner.types.ts`:

- `HistoricalOptionsContractV2Observation` (identical shape)
- `PartnerHistoricalOptionsContractV2Response` (identical shape)
- `GetHistoricalOptionsContractRequest` (defined in both `options-contract.callables.ts` and `partner.types.ts`)

The existing `# TODO(sync)` comment acknowledged this, but the project guidelines explicitly say: *"Do not mirror types between frontend and backend. If both sides need a type, place it in a side-effect-free shared location."*

**Remedy:** Move shared DTOs to `shared/` or a side-effect-free package. The `shared/robinhood-mcp-contracts.ts` pattern already exists in this repo.

**Fix applied:** All three types moved to `shared/options-contract-contracts.ts`. Both `functions/src/types/partner.ts` and `src/app/core/models/partner.types.ts` now re-export from `@options-contract/contracts`. The callable file imports directly from shared. `# TODO(sync)` comments removed.

**1.3 `cors: true` on production callable** ✅ FIXED

`functions/src/options-contract.callables.ts:23` used `{ region: 'us-central1', cors: true }`. The coding guidelines explicitly flag this: *"Do not use `cors: true` on production callables. Maintain a single, explicit CORS allowlist."*

**Remedy:** Use the same `ALLOWED_ORIGINS` pattern as other callables in the codebase.

**Fix applied:** Replaced `cors: true` with `cors: RH_AGENT_ALLOWED_ORIGINS` imported from `./rh-agent-cloud-function/rh-agent-cors`.

#### 2. Missed Opportunities for Dramatic Simplification

**2.1 `applyYAxisViewport` effect — 30 lines of repetitive axis-finding boilerplate** ✅ FIXED

The effect at `options-contract-chart.component.ts:149-188` finds each axis by name and sets min/max individually. This is 6 nearly identical blocks:

```ts
const underlyingAxis = findAxis('underlyingAxis');
if (underlyingAxis) { underlyingAxis.minimum = ranges.underlying.min; ... }
const ivAxis = findAxis('ivAxis');
if (ivAxis) { ivAxis.minimum = ranges.iv.min; ... }
// ... 4 more
```

**Code-judo move:** Define a config map `{ axisName: rangeKey }` and iterate:

```ts
const AXIS_MAP: Record<string, keyof typeof ranges> = {
  underlyingAxis: 'underlying', ivAxis: 'iv',
  greeksAxis: 'delta', gammaAxis: 'gamma', volumeAxis: 'volume',
};
for (const [name, key] of Object.entries(AXIS_MAP)) {
  const axis = findAxis(name);
  if (axis) { axis.minimum = ranges[key].min; axis.maximum = ranges[key].max; }
}
```

This deletes ~20 lines and makes adding/removing axes a one-line change.

**Fix applied:** Implemented the `AXIS_MAP` loop pattern as suggested.

**2.2 `computeMinMax` and `computeUnderlyingMinMax` — near-duplicate logic** ✅ FIXED

`computeMinMax` (lines 35-63) and `computeUnderlyingMinMax` (lines 65-93) share the same structure: clamp range, iterate, find min/max, handle degenerate cases. The only difference is the data source (observations array vs underlying array) and the field access pattern.

**Remedy:** Unify into a single function that accepts a value-accessor callback, or have `computeUnderlyingMinMax` delegate to a shared inner loop.

**Fix applied:** Extracted shared `computeRangeMinMax` function that accepts an accessor callback. Both `computeMinMax` and `computeUnderlyingMinMax` now delegate to it.

#### 3. File-Size and Decomposition Concerns

**3.1 `partner-proxy.ts` is ~675+ lines and growing** ⏳ DEFERRED

This file was already large before this feature added 162 lines. It now contains:
- Partner API call functions
- OCC ID parsing
- Length-to-days mapping
- Contract resolution by length
- Time-until-expiration parsing

The coding guidelines say: *"Target under 300 lines per file. If a file crosses 400 lines, treat it as a strong smell."*

**Remedy:** Extract the options-contract resolution logic (`targetDaysFromLength`, `parseTimeUntilExpiration`, `resolveContractIdByLength`, `parseOccContractId`) into a focused helper file like `functions/src/options-contract-resolver.ts`.

**Status:** Deferred to a later pass along with other file-size refactoring.

**3.2 `options-contract-chart.component.ts` at 340 lines — approaching threshold** ⏳ DEFERRED

The component mixes chart configuration (axis definitions, palettes, zoom settings), viewport computation logic (min/max helpers, effects), and event handlers. The two module-level helper functions (`computeMinMax`, `computeUnderlyingMinMax`) are 60 lines of pure logic that don't need to live in the component file.

**Remedy:** Extract viewport computation helpers to a separate utility file. The axis configs could also be extracted to a constants file.

**Status:** Deferred to a later pass along with other file-size refactoring.

#### 4. Type and Boundary Cleanliness

**4.1 `any` in catch block** ✅ FIXED

`functions/src/options-contract.callables.ts:50`: `catch (e: any)` — the guidelines say *"Do not use `any` index signatures"* and prefer explicit types. Use `catch (e: unknown)` with `e instanceof Error` narrowing.

**Fix applied:** Changed to `catch (e: unknown)` with `e instanceof Error` narrowing for message and stack fields.

**4.2 Unused `thetaColor` and `vegaColor`** ⏳ KEEP (intentional — not yet implemented)

`options-contract-chart.component.ts:196-197` define `thetaColor` and `vegaColor` but no series uses them. The guidelines say: *"Do not keep unused enum values, functions, or subcollection logic 'for later.'"*

**Remedy:** Remove until theta/vega series are actually added.

**Status:** User decision — keep for upcoming theta/vega series implementation.

**4.3 Unused `index` field on `ParsedObservation`** ✅ FIXED

`options-contract-viewer.store.ts:59`: The `index` field was populated by `parseObservations` but no longer used by any chart series (all now use `xName="date"`). This is dead data.

**Remedy:** Remove `index` from `ParsedObservation` and `parseObservations`.

**Fix applied:** Removed `index` from `ParsedObservation` interface and `parseObservations` function.

#### 5. Legibility and Maintainability

**5.1 `computeGaps` heuristic is incorrect for single-day gaps** ✅ FIXED

`options-contract-viewer.store.ts:107-121`: The function only counts gaps when `dayDiff > 3` (i.e., longer than a weekend). A missing Wednesday (Tuesday→Thursday, dayDiff=2) would not be counted. The comment says "rough estimate" but the logic misses the most common gap pattern.

**Fix applied:** Rewrote `computeGaps` to iterate each calendar day in the gap and count only missing weekdays (excluding Sat/Sun). Now correctly detects single-day gaps (e.g., Tue→Thu = 1 missing weekday) while not counting weekend days.

**5.2 JSDoc says "category axis" but code uses `DateTimeCategory`** ✅ FIXED

`options-contract-chart.component.ts:5`: The JSDoc said "Uses a category axis (not date axis)" but the implementation uses `DateTimeCategoryService`. The ADR also said "category axis." Both have been updated.

**Fix applied:** Updated JSDoc to say "DateTimeCategory axis" and updated ADR-002 to reflect the actual axis type.

#### Approval Bar Assessment

- **Structural regression?** Yes — duplicated OCC parser and types across boundary.
- **Missed simplification?** Yes — `applyYAxisViewport` and min/max helpers have clear code-judo moves.
- **Unjustified file-size explosion?** `partner-proxy.ts` is above 400 lines and this PR adds more.
- **Spaghetti growth?** No — the new code is reasonably organized.
- **Hacky abstraction?** No.
- **Architecture-boundary leak?** Yes — `cors: true` and type mirroring violate documented standards.

**Recommendation:** Address 1.1, 1.2, 1.3, 2.1, 3.1, 4.1, 4.2, 4.3 before merge. The rest are recommended but not blocking.

**Resolution (2026-07-23):** Fixed: 1.1, 1.2, 1.3, 2.1, 2.2, 4.1, 4.3, 5.1. Deferred: 3.1, 3.2 (file-size refactoring — later pass), 4.2 (theta/vega colors — intentional, upcoming feature), 5.2 (doc alignment — later pass). Also fixed S7 from the Standards review (method call in template → `computed()` signal).

---

## Standards + Spec Reviews

### Review 1 — 2026-07-23

**Scope:** All uncommitted changes for the options contract viewer feature  
**Reviewer:** Cascade (automated)  
**Standards sources:** `rel-str-coding-guidelines.md`, `rh-agent-coding-guidelines.md`, `angular-developer.md`  
**Spec source:** `docs/adr/ADR-002_options-contract-viewer.md`

#### Standards

##### Hard Violations

**S1. `cors: true` on production callable** ✅ FIXED *(rel-str-coding-guidelines §7, rh-agent-coding-guidelines §7)*

> "Do not use `cors: true` on production callables. Maintain a single, explicit CORS allowlist."

`functions/src/options-contract.callables.ts:23` used `{ region: 'us-central1', cors: true }`. Other callables in the codebase use a restricted `ALLOWED_ORIGINS` allowlist. This is a security smell.

**Fix applied:** Replaced with `cors: RH_AGENT_ALLOWED_ORIGINS` from `./rh-agent-cloud-function/rh-agent-cors`. *(Also fixed in thermo review 1.3.)*

**S2. Duplicated types across FE/BE boundary** ✅ FIXED *(rel-str-coding-guidelines §2, rh-agent-coding-guidelines §2)*

> "Do not mirror types between frontend and backend. If both sides need a type, place it in a side-effect-free shared location."

Three types were duplicated:
- `HistoricalOptionsContractV2Observation` — `functions/src/types/partner.ts:128-144` vs `src/app/core/models/partner.types.ts:60-76`
- `PartnerHistoricalOptionsContractV2Response` — `functions/src/types/partner.ts:147-157` vs `src/app/core/models/partner.types.ts:79-94`
- `GetHistoricalOptionsContractRequest` — `functions/src/options-contract.callables.ts:8-12` vs `src/app/core/models/partner.types.ts:95-99`

The `# TODO(sync)` comment acknowledged this but the guidelines say to use a shared location, not a comment.

**Fix applied:** All three types moved to `shared/options-contract-contracts.ts`. Both FE and BE now re-export from `@options-contract/contracts`. *(Also fixed in thermo review 1.2.)*

**S3. `any` in catch block** ✅ FIXED *(rel-str-coding-guidelines §5)*

> "Do not use `any` index signatures to hide shape mismatches."

`functions/src/options-contract.callables.ts:50` used `catch (e: any)`. Should be `catch (e: unknown)` with `instanceof Error` narrowing.

**Fix applied:** Changed to `catch (e: unknown)` with `e instanceof Error` narrowing. *(Also fixed in thermo review 4.1.)*

**S4. File exceeds 400 lines** ⏳ DEFERRED *(rel-str-coding-guidelines §1, rh-agent-coding-guidelines §1)*

> "Target under 300 lines per file. If a file crosses 400 lines, treat it as a strong smell."

`functions/src/partner-proxy.ts` is ~675+ lines. This PR adds 162 lines to an already-large file. The options-contract resolution logic should be extracted to a separate file.

**Status:** Deferred to a later pass along with other file-size refactoring. *(Overlaps with thermo review 3.1.)*

##### Judgement Calls (Baseline Smells)

**S5. Duplicated Code — OCC ID parser** ✅ FIXED *(Fowler: Duplicated Code)*

`parseOccContractId` in `partner-proxy.ts:511-526` and `parseOccId` in `options-contract.service.ts:60-78` implement the same regex with different return shapes. Same logic shape in two files.

**Fix applied:** Both now import from `shared/options-contract-contracts.ts`. *(Also fixed in thermo review 1.1.)*

**S6. Dead code — unused colors and index field** ✅ PARTIALLY FIXED *(Fowler: Speculative Generality)*

- `thetaColor` and `vegaColor` at `options-contract-chart.component.ts:196-197` are defined but never referenced by any series. **Status:** Kept intentionally — user confirmed these are for upcoming theta/vega series implementation. *(Overlaps with thermo review 4.2.)*
- `index` field on `ParsedObservation` at `options-contract-viewer.store.ts:59` is populated but no longer used (all series now use `xName="date"`). **Fix applied:** Removed from interface and `parseObservations`. *(Also fixed in thermo review 4.3.)*

**S7. Method call in template** ✅ FIXED *(angular-developer.md §"ABSOLUTE RULE")*

> "NEVER call component methods in Angular templates."

`option-chart.component.html:90` called `lengthLabel(contractLength)` — a method call in the template that runs on every change detection cycle. Should be a `computed()` signal.

**Fix applied:** Converted `lengthLabel` from a method to a `computed()` signal. Converted `contractLength` from a plain property to a `signal()` so the computed reacts to changes. Updated template to use `lengthLabel()` and `contractLength()` with `[ngModel]`/`(ngModelChange)` binding.

**S8. Stale JSDoc** ✅ FIXED *(Fowler: Mysterious Name)*

`options-contract-chart.component.ts:5` said "Uses a category axis (not date axis)" but the code now uses `DateTimeCategoryService`. Misleading documentation.

**Fix applied:** Updated JSDoc to reference DateTimeCategory axis. Updated ADR-002 to match. *(Overlaps with thermo review 5.2.)*

#### Spec

**Spec source:** `docs/adr/ADR-002_options-contract-viewer.md`

##### Requirements Missing or Partial

**P1. Bid/Ask series removed but ADR says they should be present** ✅ RESOLVED

ADR line 17 previously said:
> "Main pane: option `mark` (primary), `bid`/`ask` (faint bounds), underlying `close` (toggleable, right axis)."

The code removes bid/ask series entirely. The ADR has been updated to reflect this decision — bid/ask removal is now documented as a deliberate choice with rationale (mark is sufficient for validation, faint bounds added visual noise).

**P2. ADR says "category axis" but code uses DateTimeCategory** ✅ RESOLVED

ADR line 13 previously said:
> "The X-axis uses a **category axis** (indexed by observation position), not a date axis"

The code now uses `DateTimeCategoryService` with `valueType: 'DateTimeCategory'` and `labelFormat: 'MMM dd'`. The ADR has been updated to reflect the DateTimeCategory axis.

##### Scope Creep (Not in ADR)

**C1. Contract length selector and backend resolution** ✅ DOCUMENTED

The ADR previously did not mention a "length" input or contract resolution by length. The feature adds:
- A `contractLength` dropdown with 16 options grouped into 4 categories
- Backend `targetDaysFromLength` mapping and `resolveContractIdByLength` function
- Two API calls per load (latest chain + fallback) when length is specified

**Fix applied:** Added "Contract length selector" decision to ADR-002 documenting the feature and its resolution logic.

**C2. Dynamic Y-axis viewport snapping** ✅ DOCUMENTED

The ADR previously did not mention dynamic Y-axis range snapping on zoom/pan/scroll. This is a UX enhancement that goes beyond the original spec.

**Fix applied:** Added Y-axis snapping description to the "Full lifetime fetch" decision in ADR-002.

##### Implemented but Potentially Wrong

**W1. `computeGaps` heuristic misses single-day gaps** ✅ FIXED

`options-contract-viewer.store.ts:116`: `if (dayDiff > 3)` only counts gaps longer than a weekend. A missing trading day between Tuesday and Thursday (dayDiff=2) would not be counted. The ADR says "data quality flags (gaps, NaN IV)" — the gaps flag is not accurately computed.

**Fix applied:** Rewrote to iterate each calendar day in the gap and count only missing weekdays. *(Also fixed in thermo review 5.1.)*

**W2. `0DTE` maps to 0 days in `targetDaysFromLength`**

`partner-proxy.ts:384`: `case '0DTE': return 0;` — a 0DTE contract has `timeUntilExpiration` close to 0, but the resolver picks the contract with `Math.abs(days - 0)` closest to zero. This could match a contract that has already expired (negative days). The resolver does not filter out expired contracts.

#### Summary

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| **Standards** | 4 hard violations, 4 judgement calls | `cors: true` on callable (S1) |
| **Spec** | 2 missing/partial, 2 scope creep, 2 potentially wrong | Bid/ask removal not reflected in ADR (P1) |

**Resolution (2026-07-23):**

| Item | Status | Overlap |
|------|--------|---------|
| S1 (cors: true) | ✅ Fixed | Thermo 1.3 |
| S2 (duplicated types) | ✅ Fixed | Thermo 1.2 |
| S3 (any in catch) | ✅ Fixed | Thermo 4.1 |
| S4 (file exceeds 400 lines) | ⏳ Deferred | Thermo 3.1 |
| S5 (duplicated OCC parser) | ✅ Fixed | Thermo 1.1 |
| S6 (dead code — colors) | ⏳ Keep (intentional) | Thermo 4.2 |
| S6 (dead code — index field) | ✅ Fixed | Thermo 4.3 |
| S7 (method call in template) | ✅ Fixed | — |
| S8 (stale JSDoc) | ✅ Fixed | Thermo 5.2 |
| W1 (computeGaps heuristic) | ✅ Fixed | Thermo 5.1 |
| P1 (bid/ask removal) | ✅ ADR updated | — |
| P2 (category axis in ADR) | ✅ ADR updated | — |
| C1 (length selector) | ✅ ADR updated | — |
| C2 (Y-axis snapping) | ✅ ADR updated | — |
| W2 (0DTE resolver) | ⏳ Deferred (next pass) | — |
