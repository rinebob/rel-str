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

---

## Thermo-Nuclear Code Quality Review — Review 2

### Review 2 — 2026-07-24 (FE changes: signal refactor, listContracts$, backtest fullscreen)

**Scope:** Uncommitted FE changes — `option-chart.component.ts/.html` (signal conversion), `options-contract.service.ts` (`listContracts$()`), `constants.ts` (callable enum), `partner.types.ts` (re-exports), `backtest-dashboard.component.ts` (fullscreen toggle)
**Reviewer:** Cascade (automated)

**Summary:** The signal conversion is correct and well-executed. The `listContracts$()` method follows the existing service pattern faithfully. One minor finding, one carry-over from pre-existing code.

**Verdict: Approve with minor notes.**

---

#### 1. Prior Findings — Resolution Check

**1.1 S4 (file exceeds 400 lines)** ✅ RESOLVED (in partnerListContractsV2 review)

`partner-proxy.ts` was decomposed into 3 files in the refactoring covered by `REVIEW-partnerListContractsV2-stub.md` Review 2. The `options-contract-proxy.ts` file (377 lines) is under threshold and will drop to ~230 when deprecated code is removed.

**1.2 S7 (method call in template)** ✅ RESOLVED

`lengthLabel` was converted from a method to a `computed()` signal in Review 1. This review extends the signal pattern to the remaining builder fields (`symbol`, `expiration`, `type`, `strike`), completing the migration. The template now uses `[ngModel]` + `(ngModelChange)` with `signal.set()` — no method calls in templates.

---

#### 2. New Findings

**2.1 `occIdInput` not converted to signal — inconsistent with builder fields** ⏳ MINOR

`option-chart.component.ts:60`:
```ts
occIdInput = 'QQQ240719C00450000';
```

The builder fields (`symbol`, `expiration`, `type`, `strike`) were converted to signals, but `occIdInput` remains a plain property. It uses `[(ngModel)]` two-way binding in the template (line 77) and is written to by `onBuildChange()`. This is intentionally not a signal because:
- It's a two-way bound input field (user can type freely)
- It doesn't participate in any `computed()` chain
- Converting it to a signal would require `[ngModel]` + `(ngModelChange)` which adds verbosity for no reactivity benefit

**Assessment:** Acceptable — the inconsistency is justified. `occIdInput` is a form input buffer, not reactive state. No change needed.

**Status:** Minor — no action required.

---

**2.2 `OptionsContractService` class reference — dead code** ⏳ CARRY-OVER (pre-existing)

`option-chart.component.ts:57`:
```ts
readonly OptionsContractService = OptionsContractService;
```

This assigns the class itself to a component property, presumably for static method access from the template (`OptionsContractService.parseOccId()`). However, the template does not reference it. The `parseOccId` static method exists on the service but is not called from this component or its template.

**Assessment:** Pre-existing — not introduced by this diff. Speculative Generality smell (Fowler). Should be removed when the component is next touched.

**Status:** Carry-over — remove when convenient.

---

**2.3 `onBuildChange()` side-effect pattern** ✅ ACCEPTABLE

`option-chart.component.ts:107-110`:
```ts
onBuildChange(): void {
  const id = this.builtOccId();
  if (id) this.occIdInput = id;
}
```

This method is called from `(ngModelChange)` event handlers in the template. It reads the `builtOccId` computed (which depends on the signal builder fields) and writes to `occIdInput`. An alternative would be an `effect()` that syncs `occIdInput` from `builtOccId`, but that would create a loop since `occIdInput` is also user-writable via the OCC ID input field. The current approach — sync only on builder field changes — is correct.

**Assessment:** Acceptable — the side-effect is scoped to builder field changes and avoids a feedback loop.

---

#### 3. Structural Assessment

| Aspect | Assessment |
|--------|------------|
| Signal conversion correctness | ✅ `builtOccId` computed correctly reads from signal fields |
| Template binding pattern | ✅ `[ngModel]` + `(ngModelChange)` + `signal.set()` — no method calls in template |
| `listContracts$()` pattern consistency | ✅ Mirrors `getHistoricalOptionsContract$()` — same `defer`/`from`/`inCtx`/`map` shape |
| Validation in service | ✅ Defensive validation mirrors backend callable (symbol required, expiration/strike filter) |
| Type safety | ✅ `httpsCallable<GetListContractsRequest, PartnerListContractsV2Response>` — fully typed |
| Shared types | ✅ Re-exported from `partner.types.ts`, sourced from `@options-contract/contracts` |
| Backtest fullscreen toggle | ✅ Clean `ngOnInit`/`ngOnDestroy` lifecycle usage |
| No `any` introduced | ✅ |
| No `cors` changes | ✅ N/A for FE |

---

#### 4. Approval Bar Assessment

- **Structural regression?** No — improvement (signals improve reactivity).
- **Missed simplification?** No — the pattern is clean and consistent.
- **Unjustified file-size explosion?** No — minimal additions.
- **Spaghetti growth?** No.
- **Hacky abstraction?** No.
- **Architecture-boundary leak?** No — types correctly sourced from shared.
- **Dead code?** One carry-over (`OptionsContractService` class ref, pre-existing).

**Recommendation:** Approve. Optionally remove the dead `OptionsContractService` class reference (2.2) when convenient.

---

## Standards + Spec Review — Review 2

### Review 2 — 2026-07-24 (FE changes)

**Scope:** Uncommitted FE changes
**Reviewer:** Cascade (automated)
**Standards sources:** `rel-str-coding-guidelines.md`, `rh-agent-coding-guidelines.md`, `angular-developer.md` (referenced from Review 1)
**Spec source:** `docs/adr/ADR-002_options-contract-viewer.md`

#### Standards

##### Prior Findings Resolution

| Prior Finding | Status |
|---------------|--------|
| S1 (cors: true) | ✅ Fixed (Review 1) |
| S2 (duplicated types) | ✅ Fixed (Review 1) |
| S3 (any in catch) | ✅ Fixed (Review 1) |
| S4 (file exceeds 400 lines) | ✅ Resolved (partnerListContractsV2 review) |
| S5 (duplicated OCC parser) | ✅ Fixed (Review 1) |
| S6 (dead code — colors/index) | ✅/⏳ Fixed/intentional (Review 1) |
| S7 (method call in template) | ✅ Fixed (Review 1) — extended to all builder fields in this review |
| S8 (stale JSDoc) | ✅ Fixed (Review 1) |

##### New Findings

**S9. Dead class reference** ⏳ MINOR *(Fowler: Speculative Generality)*

`option-chart.component.ts:57`: `readonly OptionsContractService = OptionsContractService;` — class reference not used in template. Pre-existing, not introduced by this diff.

**Status:** Minor — remove when convenient.

##### No New Violations

- ✅ No `any` introduced
- ✅ No method calls in templates (signal conversion completes the fix)
- ✅ No type mirroring — shared types from `@options-contract/contracts`
- ✅ No hardcoded credentials
- ✅ `OnPush` change detection maintained
- ✅ Signal-based reactivity follows Angular best practices

##### Baseline Smells

- **Duplicated Code** (judgement call): `listContracts$()` mirrors `getHistoricalOptionsContract$()` structure. With only 2 methods, abstracting a helper would be premature. Acceptable.
- **Speculative Generality** (judgement call): `listContracts$()` has no callers yet. User-directed pre-wiring per ADR-002. Acceptable.
- **Mysterious Name** (judgement call): `onBuildChange()` — adequately clear within component context. No change needed.

#### Spec

**Spec source:** `docs/adr/ADR-002_options-contract-viewer.md`

##### Requirements Met

**P1. Signal-based FE state** ✅

ADR says: *"FE state. NgRx SignalStore + service. Component is UI-only."*

The builder fields are now signals, and `builtOccId` is a `computed()` that reacts to them. The component remains UI-only — no data fetching or business logic. The store manages contract data, loading, and error states. ✅

**P2. `listContracts$()` service method** ✅

ADR says: *"Frontend `listContracts$()` method in `options-contract.service.ts`"*

Implemented with matching validation, typed callable, and consistent pattern. ✅

**P3. `LIST_OPTIONS_CONTRACTS` callable name** ✅

ADR says: *"Callable `listOptionsContracts` in `functions/src/options-contract.callables.ts`"*

`CallableName.LIST_OPTIONS_CONTRACTS = 'listOptionsContracts'` — matches. ✅

**P4. Shared types re-exported** ✅

ADR says: *"Shared types... in `shared/options-contract-contracts.ts`"*

`ListContractsV2Contract`, `PartnerListContractsV2Response`, `GetListContractsRequest` re-exported from `src/app/core/models/partner.types.ts`. ✅

##### Scope Creep

**C1. Backtest dashboard fullscreen toggle** ⏳ SEPARATE CONCERN

The `ngOnInit`/`ngOnDestroy` fullscreen toggle on `backtest-dashboard.component.ts` is not related to ADR-002 (options contract viewer). It's a UX improvement to a different feature. This should be a separate commit (it is in the commit plan).

**Status:** Not scope creep against ADR-002 — separate feature, separate commit.

##### Potentially Wrong

No issues found. The signal conversion is mechanically correct — `builtOccId` reads `this.symbol()`, `this.expiration()`, `this.strike()`, `this.type()` which are all signals, so the computed will react to any builder field change. The `onBuildChange()` method is called after `signal.set($event)` in the template, and since signals are synchronous, the computed will already have the updated value.

---

#### Summary

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| **Standards** | 8 prior findings all resolved, 1 new minor (dead class ref, pre-existing) | Dead class reference (S9) |
| **Spec** | 4 requirements met, 1 separate concern (backtest fullscreen), 0 potentially wrong | All met |

**Resolution (2026-07-24, Review 2):**

| Item | Status | Action |
|------|--------|--------|
| S1-S8 (prior) | ✅ All resolved | — |
| S9 (dead class ref) | ⏳ Minor | Remove `OptionsContractService` class reference when convenient |
| P1-P4 (spec) | ✅ Met | — |
| C1 (backtest fullscreen) | ✅ Separate commit | Not ADR-002 scope |

---

## Thermo-Nuclear Code Quality Review — Review 3

### Review 3 — 2026-07-24 (Contract browser UI)

**Scope:** Uncommitted FE changes — contract search UI in `option-chart.component.ts/.html/.scss` and `options-contract-viewer.store.ts`
**Reviewer:** Cascade (automated)

**Summary:** The contract browser is well-structured — store methods mirror the existing `loadContract` pattern, component handlers are thin, and the template uses signal-based bindings consistently. Two minor findings, both judgement calls.

**Verdict: Approve with minor notes.**

---

#### 1. Prior Findings — Resolution Check

**1.1 S9 (dead class reference)** ✅ RESOLVED

The `readonly OptionsContractService = OptionsContractService;` property and its import were removed in the same session prior to this diff. No longer present.

**1.2 Review 2 findings (2.1, 2.2, 2.3)** — All carry-over or acceptable, no action needed. Not reintroduced.

---

#### 2. New Findings

**2.1 Duplicated date formatting logic** ⏳ MINOR *(Fowler: Duplicated Code)*

`option-chart.component.ts:155-158` (`onSearchContracts`):
```ts
const yy = String(exp.getFullYear());
const mm = String(exp.getMonth() + 1).padStart(2, '0');
const dd = String(exp.getDate()).padStart(2, '0');
filters.expiration = `${yy}-${mm}-${dd}`;
```

`option-chart.component.ts:96-98` (`builtOccId`):
```ts
const yy = String(d.getFullYear()).slice(2);
const mm = String(d.getMonth() + 1).padStart(2, '0');
const dd = String(d.getDate()).padStart(2, '0');
```

The `mm` and `dd` formatting is identical. The `yy` differs (full year vs 2-digit). Extracting a `formatDateParts(date)` helper would remove the duplication, but with only 2 call sites and the `yy` difference, this is a judgement call. Acceptable for now; extract if a third call site appears.

**Assessment:** Judgement call — acceptable with 2 sites. Extract if a 3rd appears.

**Status:** Minor — no action required now.

---

**2.2 `searchContracts` store method duplicates service validation** ⏳ MINOR *(Fowler: Duplicated Code)*

`options-contract-viewer.store.ts:257-265`:
```ts
const sym = String(symbol || '').trim().toUpperCase();
if (!sym) { ... }
if (!filters?.expiration && filters?.strike == null) { ... }
```

`options-contract.service.ts:70-77` (`listContracts$`):
```ts
const sym = String(symbol || '').trim().toUpperCase();
if (!sym) return throwError(...);
if (!filters?.expiration && filters?.strike == null) return throwError(...);
```

The store re-validates what the service already validates. The store's validation produces user-facing error messages via `patchState`, while the service's validation produces RxJS errors. Both are needed for the current architecture (store for UI state, service as guard), but the logic is duplicated.

**Assessment:** Judgement call — the dual validation is a consequence of the store/service split. The store needs to set `searchError` state synchronously (before the observable would error), so skipping store validation would mean the error only appears after the round-trip. Acceptable.

**Status:** Minor — no action required.

---

**2.3 No subscription cleanup on `searchContracts`** ⏳ MINOR

`options-contract-viewer.store.ts:269`:
```ts
optionsContractService.listContracts$(sym, filters).subscribe({ ... });
```

The subscription is not stored or cleaned up. If the user navigates away while a search is in-flight, the `next`/`error` callbacks will fire on a destroyed store. This mirrors the existing `loadContract` method (line 220), which also doesn't clean up its subscription. The store is `providedIn: 'root'` (singleton), so it's never actually destroyed during the app lifecycle — the callbacks would fire but `patchState` on a root store is safe.

**Assessment:** Acceptable — consistent with existing `loadContract` pattern. The root store lifecycle means there's no real leak. If the store were ever scoped to a component, this would need a `takeUntilDestroyed`.

**Status:** Minor — no action required (consistent with existing pattern, root store is singleton).

---

#### 3. Structural Assessment

| Aspect | Assessment |
|--------|------------|
| Store method pattern consistency | ✅ `searchContracts` mirrors `loadContract` — same validate → patchState → subscribe pattern |
| Component handler thinness | ✅ `onSearchContracts` reads signals, builds filters, delegates to store. `onSelectContract` sets input, clears search, delegates to `onLoad` |
| Template signal bindings | ✅ All search-related reads use `store.searchLoading()`, `store.searchError()`, `store.searchResults()` — no method calls in template |
| Template control flow | ✅ `@if` blocks for loading/error/results — consistent with existing template patterns |
| `track` on `@for` | ✅ `track contract.contractId` — correct unique key |
| Type safety | ✅ `ListContractsV2Contract` fields (`contractId`, `expiration`, `strike`, `type`) match template access |
| Graceful degradation | ✅ Error chip displays when endpoint unavailable — no crash |
| No `any` introduced | ✅ |
| `OnPush` compatibility | ✅ All state reads via signals — CD will trigger correctly |
| SCSS pattern consistency | ✅ Uses `var(--mat-sys-*)` with fallbacks, matches existing styles |

---

#### 4. Approval Bar Assessment

- **Structural regression?** No — extends existing patterns cleanly.
- **Missed simplification?** Date formatting duplication (2.1) — borderline, acceptable with 2 sites.
- **Unjustified file-size explosion?** No — +206 lines across 4 files, proportional to the feature.
- **Spaghetti growth?** No — store owns state, component is UI-only, template is declarative.
- **Hacky abstraction?** No.
- **Architecture-boundary leak?** No — types from shared contracts, service wraps callable, store wraps service.
- **Dead code?** No.

**Recommendation:** Approve. No blocking issues.

---

## Standards + Spec Review — Review 3

### Review 3 — 2026-07-24 (Contract browser UI)

**Scope:** Uncommitted FE changes — contract search UI
**Reviewer:** Cascade (automated)
**Standards sources:** Fowler code smells baseline (no repo-level coding standards docs found)
**Spec source:** `docs/adr/ADR-002_options-contract-viewer.md`

#### Standards

##### Prior Findings Resolution

| Prior Finding | Status |
|---------------|--------|
| S1-S8 (Review 1) | ✅ All resolved |
| S9 (dead class ref, Review 2) | ✅ Resolved (removed in this session) |

##### New Findings

**S10. Duplicated date formatting** ⏳ MINOR *(Fowler: Duplicated Code)*

`option-chart.component.ts:155-158` and `:96-98` share `mm`/`dd` formatting logic. Two call sites with a `yy` difference. Judgement call — extract if a 3rd site appears.

**Status:** Minor — no action required now.

**S11. Duplicated validation in store + service** ⏳ MINOR *(Fowler: Duplicated Code)*

`options-contract-viewer.store.ts:257-265` duplicates `options-contract.service.ts:70-77` validation. Both needed for synchronous UI error vs async RxJS error. Judgement call.

**Status:** Minor — no action required.

##### No New Hard Violations

- ✅ No `any` introduced
- ✅ No method calls in templates
- ✅ No type mirroring — shared types from `@options-contract/contracts`
- ✅ `OnPush` change detection maintained
- ✅ Signal-based reactivity throughout
- ✅ `track` on `@for` loop

##### Baseline Smells

- **Duplicated Code** (judgement call): Date formatting (S10) and validation (S11). Both acceptable for reasons noted above.
- **Speculative Generality** (judgement call): `clearSearch()` method is pre-wired for future "clear" button — but it's already used by the results header close button and by `onSelectContract`. Not speculative.
- **Mysterious Name** (judgement call): `onSearchContracts` and `onSelectContract` — clear and descriptive. No issue.

#### Spec

**Spec source:** `docs/adr/ADR-002_options-contract-viewer.md`

##### Requirements Met

**P1. Contract discovery (partnerListContractsV2)** ✅

ADR says: *"SA is implementing a new endpoint `partnerListContractsV2` that returns available option contract IDs... filterable by expiration, strike, and type. This solves the current discovery gap where the viewer requires a known OCC contract ID."*

The contract browser UI directly addresses this discovery gap. Users can now search for available contracts by symbol + expiration/strike/type filters, select from results, and load — without needing to know the OCC ID in advance. ✅

**P2. Frontend `listContracts$()` method usage** ✅

ADR says: *"Frontend `listContracts$()` method in `options-contract.service.ts`"*

The store's `searchContracts` method calls `optionsContractService.listContracts$()` — the pre-wired service method is now consumed. ✅

**P3. FE state via NgRx SignalStore** ✅

ADR says: *"FE state. NgRx SignalStore + service. Component is UI-only."*

Search state (`searchLoading`, `searchError`, `searchResults`, `searchedSymbol`) lives in the store. Component handlers are thin delegators. Template reads from store signals. ✅

**P4. Filter parameters match ADR** ✅

ADR says: *"filterable by expiration, strike, and type"*

`onSearchContracts` builds filters from builder fields: `expiration` (from date picker → `YYYY-MM-DD`), `strike` (from number input), `type` (from call/put toggle → `C`/`P`). All three filters supported. ✅

##### Scope Creep

No scope creep detected. All changes are within ADR-002's contract discovery scope.

##### Potentially Wrong

**W1. `if (stk) filters.strike = stk;` — falsy zero strike** ⏳ MINOR

`option-chart.component.ts:160`:
```ts
if (stk) filters.strike = stk;
```

If `strike()` is `0`, `if (stk)` is falsy and the strike filter is omitted. A strike of 0 is unlikely for real options but technically valid. The store validation uses `filters?.strike == null` (correct null check), but the component gate uses truthiness.

**Assessment:** Edge case — strike 0 is not a real-world scenario for equity options. The service validation would catch it anyway (if expiration is also missing and strike is 0, the `strike == null` check in the service would pass since `0 != null`). Low risk.

**Status:** Minor — could use `if (stk != null)` for correctness, but practically harmless.

---

#### Summary

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| **Standards** | S9 resolved, 2 new minor (S10 duplicated date fmt, S11 duplicated validation) — both judgement calls | S10/S11 — Duplicated Code (judgement calls) |
| **Spec** | 4 requirements met, 0 scope creep, 1 minor potentially wrong (W1 falsy zero strike) | W1 — falsy zero strike edge case |

**Resolution (2026-07-24, Review 3):**

| Item | Status | Action |
|------|--------|--------|
| S9 (dead class ref) | ✅ Resolved | Removed in this session |
| S10 (duplicated date fmt) | ✅ Fixed | Extracted `formatDateParts()` private helper |
| S11 (duplicated validation) | ✅ Fixed | Removed store validation — service `throwError` fires synchronously on subscribe |
| 2.3 (no subscription cleanup) | ⏳ No action | Consistent with existing `loadContract` pattern; root store is singleton |
| P1-P4 (spec) | ✅ Met | — |
| W1 (falsy zero strike) | ✅ Fixed | Changed `if (stk)` to `if (stk != null)` |

---

## Thermo-Nuclear Code Quality Review — Review 4

### Review 4 — 2026-07-27 (Contract navigation: prev/next buttons)

**Scope:** Uncommitted FE changes — contract navigation feature in `option-chart.component.ts/.html/.scss` and `options-contract-viewer.store.ts`
**Reviewer:** Cascade (automated, Dr. John Reed persona)
**Files changed:** 4 files, +100 / -7 lines

**Summary:** The feature adds prev/next navigation buttons to cycle through cached search results without re-searching. The approach is sound — store tracks `currentSearchIndex`, component exposes computed guards, template renders a positioned nav bar. However, `navigateContract` duplicates the entire `loadContract` fetch+subscribe pipeline, introducing a maintainability risk.

**Verdict: Changes requested.** 1 HIGH finding (duplicated fetch logic), 2 MEDIUM, 1 LOW.

---

#### 1. Prior Findings — Resolution Check

**1.1 S10 (duplicated date formatting)** ✅ RESOLVED (in prior commit)

The user extracted `formatUtcDate` helper in `rh-agent.utils.ts`. Both `formatExpWithDow` and `onAxisLabelRender` now use it. The duplication flagged in Review 3 S10/S2-5 is eliminated.

**1.2 S11 (duplicated validation in store + service)** ✅ RESOLVED (in prior commit)

Store validation was removed; service `throwError` fires synchronously on subscribe.

**1.3 Thermo #4 (console.log in ngOnInit)** ✅ RESOLVED (in prior commit)

Debug `console.log` removed by user.

---

#### 2. New Findings

**2.1 [HIGH] Duplicated contract-fetch pipeline in `navigateContract`** *(Fowler: Duplicated Code)*

`options-contract-viewer.store.ts:335-356` — `navigateContract` duplicates the entire `loadContract` fetch+subscribe flow:
- Parse OCC ID
- `patchState` with loading/contractData/underlyingBars
- `getHistoricalOptionsContract$` subscribe
- `patchState` with result + `fetchUnderlyingBars`
- Error handling

The only differences are:
1. `navigateContract` doesn't pass `length` to the service call
2. `navigateContract` sets `currentSearchIndex: next` (vs `loadContract` which computes `idx` via `findIndex`)
3. `navigateContract` sets `occIdInput` before the call (vs `loadContract` which sets it in the `next` callback)

This is the exact same Duplicated Code smell that was fixed in Round 2 (thermo #1, #3) by extracting `paddedDateRange` and `fetchUnderlyingBars`. The fix was applied to `loadContract`, `addPadDays`, and `resetPadDays`, but `navigateContract` was added without using the same pattern.

**Remedy:** Refactor `navigateContract` to delegate to `loadContract` after setting `occIdInput` and `currentSearchIndex`. Since `loadContract` already computes `currentSearchIndex` via `findIndex` against `searchResults`, and `navigateContract` knows the target index, the simplest approach is:

```ts
navigateContract(direction: 1 | -1): void {
  const results = store.searchResults();
  const current = store.currentSearchIndex();
  if (!results.length) return;
  const next = current + direction;
  if (next < 0 || next >= results.length) return;
  const target = results[next];
  patchState(store, { occIdInput: target.contractId });
  store.loadContract(target.contractId);
}
```

This works because `loadContract` already does `results.findIndex((c) => c.contractId === occId)` which will find `next` since `target.contractId === results[next].contractId`. The `length` parameter will be `undefined` (same as the current `navigateContract` which doesn't pass it).

**Wait** — `loadContract` is defined in the same `withMethods` return object. Can `navigateContract` call `store.loadContract()`? In the prior attempt, this caused a TypeScript error: "Property 'loadContract' does not exist on type." The workaround was to inline the logic.

**Alternative remedy:** Extract a private `loadContractInternal(occId, parsed, length, index)` function (like `fetchUnderlyingBars`) that both `loadContract` and `navigateContract` call. This avoids the TypeScript self-reference issue while eliminating the duplication.

---

**2.2 [MEDIUM] `navigateContract` does not pass `contractLength`** *(Fowler: Incomplete Abstraction)*

`navigateContract` calls `getHistoricalOptionsContract$` without the `length` parameter:
```ts
optionsContractService.getHistoricalOptionsContract$(parsed.symbol, parsed.contractID).subscribe({
```

But `loadContract` passes `length`:
```ts
optionsContractService.getHistoricalOptionsContract$(parsed.symbol, parsed.contractID, length).subscribe({
```

If the user selected a contract length (e.g. "1M") and then navigates with prev/next, the length filter is silently dropped. The loaded contract will be the full lifetime series instead of the length-resolved one.

**Remedy:** Pass `store.occIdInput()` or track the selected length in state. However, since `contractLength` is a component-level signal (not in the store), the store doesn't have access to it. Options:
- (a) Move `contractLength` to store state (adds a state field for a UI concern)
- (b) Accept the behavior — navigation loads the full contract, not the length-filtered one
- (c) Add an optional `length` parameter to `navigateContract`

**Assessment:** This may be intentional — when navigating, the user likely wants the full contract, not the length-resolved subset. But it should be documented. If not intentional, it's a bug.

---

**2.3 [MEDIUM] `clearSearch` no longer called on selection — search results persist indefinitely** *(Fowler: Mutable Data)*

Removing `store.clearSearch()` from `onSelectContract` and `onContractSelected` means `searchResults` persists in the store until the next search or explicit clear. This is necessary for the nav feature to work, but has a side effect:

- If the user searches for "QQQ calls @ 450", picks one, then manually types a different OCC ID and loads it, the search results from the previous search are still in the autocomplete dropdown.
- If the user changes the symbol, `onSymbolChange` calls `loadContractIndex` but does NOT clear search results. The old results for the previous symbol will appear in the autocomplete.

**Remedy:** Clear `searchResults` when the symbol changes. Add `store.clearSearch()` to `onSymbolChange` in the component, or clear in `loadContractIndex`.

---

**2.4 [LOW] Nav bar position may overlap Syncfusion legend** *(UX observation)*

The `.contract-nav` is absolutely positioned at `bottom: 8px; left: 8px` of `.chart-content`. The Syncfusion legend is typically at the bottom of the chart. Depending on the legend position and number of series, the nav bar may overlap the legend.

**Assessment:** The user requested "bottom-left, to the left of the legend if possible." The current position is bottom-left of the chart content container. If the legend is centered or right-aligned, there's no overlap. If the legend spans the full width, the nav bar will sit on top of it. The `z-index: 10` ensures the nav bar is clickable, but it may visually clash.

**Status:** Needs visual confirmation. If overlap occurs, consider positioning relative to the legend or adding a semi-transparent background (which the current `surface-container` provides).

---

#### 3. Structural Assessment

| Aspect | Assessment |
|--------|------------|
| Store state addition (`currentSearchIndex`) | ✅ Clean — single number, reset to -1 on search/clear |
| Computed guards (`canGoPrev`/`canGoNext`) | ✅ Correct — check bounds + loading state |
| Template signal bindings | ✅ All reads via signals — `store.currentSearchIndex()`, `store.searchResults()`, `canGoPrev()`, `canGoNext()` |
| `track` on `@for` | N/A — no new `@for` loops |
| Type safety | ✅ `direction: 1 \| -1` — literal union type |
| `OnPush` compatibility | ✅ All state reads via signals |
| SCSS pattern consistency | ✅ Uses `var(--mat-sys-*)` with fallbacks |
| No `any` introduced | ✅ |
| No method calls in template | ✅ — `canGoPrev()` and `canGoNext()` are computed signals, not methods |

---

#### 4. Approval Bar Assessment

- **Structural regression?** Yes — `navigateContract` duplicates `loadContract` fetch pipeline (2.1)
- **Missed simplification?** Yes — `navigateContract` should delegate to shared logic (2.1)
- **Unjustified file-size explosion?** No — +100 lines across 4 files, proportional
- **Spaghetti growth?** No — nav logic is self-contained
- **Hacky abstraction?** No — `currentSearchIndex` is a clean state addition
- **Architecture-boundary leak?** No
- **Dead code?** No

**Recommendation:** Address 2.1 (duplicated fetch pipeline) before merge. 2.2 and 2.3 need user confirmation on intended behavior. 2.4 needs visual check.

---

## Standards + Spec Review — Review 4

### Review 4 — 2026-07-27 (Contract navigation)

**Scope:** Uncommitted FE changes — contract navigation feature
**Reviewer:** Cascade (automated)
**Standards sources:** Fowler code smells baseline, `angular-developer.md` (ABSOLUTE RULE: no method calls in templates)
**Spec source:** `docs/adr/ADR-002_options-contract-viewer.md` (updated with contract navigation decision)

#### Standards

##### Prior Findings Resolution

| Prior Finding | Status |
|---------------|--------|
| S10 (duplicated date formatting) | ✅ Resolved — `formatUtcDate` helper extracted |
| S11 (duplicated validation) | ✅ Resolved — store validation removed |
| Thermo #4 (console.log) | ✅ Resolved — removed |
| S5/Spec S5 (identity wrappers) | ✅ Resolved — `expiration`/`strike` direct assignment |

##### New Findings

**S12. [HIGH] Duplicated Code — `navigateContract` duplicates `loadContract` fetch pipeline** *(Fowler: Duplicated Code)*

Same as thermo 2.1. The entire parse → patchState → subscribe → fetchUnderlying pattern is copy-pasted. This is the most significant finding.

**Status:** Fix recommended — extract shared `loadContractInternal` helper.

---

**S13. [MEDIUM] Mutable Data — search results persist across symbol changes** *(Fowler: Mutable Data)*

Same as thermo 2.3. `onSymbolChange` does not clear `searchResults`. Stale results from a previous symbol will appear in the autocomplete dropdown.

**Status:** Fix recommended — add `store.clearSearch()` to `onSymbolChange`.

---

**S14. [PASS] No method calls in templates**

`canGoPrev()` and `canGoNext()` are `computed()` signals, not methods. Calling them in the template as `canGoPrev()` is correct — computed signals are memoized and only recompute when dependencies change. ✅

---

**S15. [PASS] Signal-based reactivity**

All new state (`currentSearchIndex`) is a signal. All new computeds (`canGoPrev`, `canGoNext`) derive from signals. Template bindings use `()` call syntax. ✅

---

**S16. [PASS] `direction: 1 | -1` literal union type**

The `navigateContract` parameter uses a literal union instead of `number`, preventing invalid values. Aligns with the `angular-developer.md` guideline to prefer enums/interfaces over string unions for cross-file use, but since this type doesn't cross a file boundary, a literal union is acceptable. ✅

---

##### No New Hard Violations

- ✅ No `any` introduced
- ✅ No method calls in templates (computed signals used)
- ✅ `OnPush` change detection maintained
- ✅ No type mirroring
- ✅ No hardcoded credentials

#### Spec

**Spec source:** `docs/adr/ADR-002_options-contract-viewer.md` (updated with contract navigation decision)

##### Requirements Met

**P1. Contract navigation via prev/next buttons** ✅

ADR says: *"After a contract search, prev/next chevron buttons at the bottom-left of the chart allow cycling through search results without re-searching."*

Implemented with `navigateContract(direction)` in the store, `canGoPrev`/`canGoNext` computeds in the component, and chevron buttons in the template. ✅

**P2. Position counter** ✅

ADR says: *"A position counter (`3 / 25`) shows the current index."*

Template displays `{{ store.currentSearchIndex() + 1 }} / {{ store.searchResults().length }}`. ✅

**P3. Search results preserved** ✅

ADR says: *"Search results are no longer cleared on contract selection, preserving the navigation list for the session."*

`clearSearch()` calls removed from `onSelectContract` and `onContractSelected`. ✅

**P4. Store tracks `currentSearchIndex`** ✅

ADR says: *"The store tracks `currentSearchIndex` and exposes `navigateContract(direction)`."*

`currentSearchIndex: number` added to state interface, initialized to `-1`, updated by `loadContract` via `findIndex`, and by `navigateContract`. ✅

##### Scope Creep

No scope creep detected. All changes are within the contract navigation scope described in the ADR.

##### Potentially Wrong

**W1. `navigateContract` drops `contractLength` parameter** ⏳ NEEDS CONFIRMATION

Same as thermo 2.2. When navigating via prev/next, the `length` parameter is not passed to `getHistoricalOptionsContract$`. If the user had selected a contract length, navigating will load the full contract instead of the length-resolved subset.

**Question for user:** Is this intentional (navigation always loads full contract) or a bug (navigation should preserve the selected length)?

---

#### Summary

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| **Standards** | 4 prior findings resolved, 2 new (S12 HIGH duplicated code, S13 MEDIUM mutable data), 3 PASS | S12 — Duplicated fetch pipeline in `navigateContract` |
| **Spec** | 4 requirements met, 0 scope creep, 1 needs confirmation (W1 length drop) | W1 — `contractLength` not passed on navigation |

### Recommended Action Items (priority order)

1. **Extract shared `loadContractInternal` helper** — eliminates S12/thermo 2.1 (duplicated fetch pipeline)
2. **Clear search results on symbol change** — eliminates S13/thermo 2.3 (stale results across symbols)
3. **Confirm `contractLength` behavior on navigation** — W1/thermo 2.2 (intentional or bug?)
4. **Visual check nav bar vs legend overlap** — thermo 2.4 (may need position adjustment)
