# Round 2 Review — Observation Dashboard Fixes

**Date:** 2026-07-20  
**Scope:** Working tree vs `HEAD` (`107b2b6`) after the first thermo-nuclear + two-axis review fixes. 14 tracked files plus 2 new untracked files (`observation-dashboard.model.spec.ts`, `tsconfig.observation-dashboard.spec.json`).  
**Reviewer:** Cascade

---

## Thermo-Nuclear Code Quality Review

The original blockers from round 1 are resolved: `extractNextCursor` is no longer speculative, `isPlainObject` is shared, option ticker helpers live in the model, `isSymbolField` is explicit, and the redactor has a documented allowlist. The remaining findings are smaller structural cleanups.

### 1. `observation-result-panel.component.ts` has dead code

**File:** `src/app/features/rh-agent/pages/observation-dashboard/observation-result-panel.component.ts` (lines 40-42)

`formatJson()` is no longer called after the template switched to `formatResult()`. Keeping it violates the RH Agent guideline against dead code and makes the component's public API misleading.

**Preferred fix:** Remove `formatJson()`.

---

### 2. `extractCursorToken` still has an ambiguous pass-through fallback

**File:** `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.ts` (lines 72-106)

The function now explicitly parses absolute URLs and query strings, then falls back to returning the trimmed input as a "plain token". That fallback is correct for a bare base64 cursor, but it will also return the whole string for a relative URL or query string that has no `cursor` parameter (e.g. `?state=active`). The contract is cleaner than before, but the pass-through path still conflates three different shapes.

**Preferred fix:** Make the pass-through path conditional: if the trimmed value contains `?` or `&` but does not contain `cursor=`, return `undefined`; otherwise return it as a bare token.

---

### 3. `rh-select-menu.component.html` duplicates option button markup

**File:** `src/app/features/rh-agent/components/rh-select-menu/rh-select-menu.component.html` (lines 10-31)

The same `<button mat-menu-item>` structure is repeated for grouped options and flat options. This is a small but real duplication that will drift when badges, tooltips, or selection styling change.

**Preferred fix:** Extract an `ng-template` for the option button and render it from both loops.

---

### 4. Symbol normalization lives in two layers

**Files:**
- `src/app/features/rh-agent/pages/observation-dashboard/observation-tool-form.component.ts` (lines 132-135)
- `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.ts` (lines 366-381)

`updateArgValue()` normalizes symbol fields before emitting, and `cleanArgsForExecution()` normalizes them again before sending. The behavior is idempotent, but the symbol-field concept is implemented twice — once in the UI component and once in the execution-boundary model.

**Preferred fix:** Keep normalization as a single concern. Either emit raw values from the form and rely solely on `cleanArgsForExecution()`, or move `isSymbolField`/`normalizeSymbolValue` into a clearly-named boundary helper and call it from one place.

---

### 5. PRD promise for symbol normalization does not match the explicit field set

**File:** `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.ts` (lines 345-354)

The PRD Additional Features section says symbol normalization applies to fields named `symbol`, `symbols`, or **any field ending in `_symbol`**. The code uses an explicit set: `symbol`, `symbols`, `chain_symbol`, `underlying_symbol`. The catalog currently only contains those `_symbol` fields, so the behavior is correct today, but the spec and code have different contracts.

**Preferred fix:** Update the PRD to list the explicit symbol-field names so the spec matches the implementation, or make `isSymbolField` suffix-aware if the broader promise is intentional.

---

## Regular Code Review (Two-Axis)

### Standards

**Good:**
- All RH Agent files remain under the 400-line guideline (`model.ts` is 393, `component.ts` is 223, `tool-form.ts` is 192, `result-panel.ts` is 63).
- `isPlainObject` is exported and shared; duplicated helpers are removed.
- `TOOL_CATEGORY_ORDER` is a named module-level constant.
- `rebuildArgsForTool` is documented and its parameter renamed to `preservedValues`.
- The redactor has a clear top-level security comment and explicit `SAFE_IDENTIFIER_FIELDS` allowlist.

**Findings:**
1. **Dead code** — `formatJson()` in `observation-result-panel.component.ts` (see thermo finding #1).
2. **Duplicated markup** — `rh-select-menu.component.html` (see thermo finding #3).
3. **Repeated concept** — symbol normalization in both `tool-form` and `model` (see thermo finding #4).
4. **Test config fragmentation** — the new `tsconfig.observation-dashboard.spec.json` is a pragmatic workaround, but the root `tsconfig.spec.json` still references missing Jest types (`setup-jest.ts`, `@types/jest`). This is a pre-existing project issue, but it means the observation dashboard specs cannot run with the default `ng test`/`tsc -p tsconfig.spec.json` without feature-specific tsconfigs.
5. **Overlay styling coupling** — `src/styles.scss` still owns `.rh-dropdown-menu-item` and `.selected` styles because `mat-menu` overlays live outside component encapsulation. This is understandable, but the coupling between `rh-select-menu` and global styles should be called out in a component comment so future maintainers don't move the styles and break the menu.

### Spec

**Source:** `docs/planning/rh-agent/RH-AGENT-OBSERVATION-DASHBOARD-PRD.md` (Additional features section)

**Implemented and matching:**
- **Pagination cursor autopopulation** — `execute()` calls `extractNextCursor()` and updates `argValues['cursor']`.
- **Symbol field normalization** — `isSymbolField()` + `normalizeSymbolValue()` are used in both the form and `cleanArgsForExecution()`.
- **Default tool selection** — `ngOnInit()` defaults to `get_accounts` if present.
- **Option instrument display helpers** — `formatResultValue()` adds `display_ticker` and `occ_symbol`.
- **Grouped tool selector with metadata** — `toolGroupOptions()` groups by category and includes `description` tooltips.

**Mismatch:**
- The PRD says normalization applies to "any field ending in `_symbol`"; the code normalizes only an explicit set (see thermo finding #5).

**Security / redaction:**
- The redactor now preserves safe identifiers (`id`, `chain_id`, `option_id`, `instrument_id`, `url`, `uuid`, `cursor`, `next`) and redacts PII fields (`account_number`, `ssn`, `first_name`, `email`, `user_id`, etc.) plus plural `emails` / `phone_numbers` / `mobile_number`. This aligns with the PRD's redaction controls and the redaction-philosophy comment, even though the allowlist details are not in the PRD.

---

## Verdict

- **Thermo-nuclear:** Now clean. Round 1's big blockers are gone and the round 2 structural cleanups below have been applied.
- **Standards:** Passes after dead-code removal, markup deduplication, and normalization consolidation.
- **Spec:** Aligned after updating the PRD to match the explicit `isSymbolField` set.

---

## Recommended cleanup task list

- [x] Remove unused `formatJson()` from `observation-result-panel.component.ts`.
- [x] Tighten `extractCursorToken()` so it does not pass through query-string-like values without a `cursor` parameter.
- [x] Deduplicate `rh-select-menu.component.html` option button markup with an `ng-template`.
- [x] Consolidate symbol normalization into `cleanArgsForExecution()` and reconcile the PRD text with `isSymbolField()`.
- [x] Add a comment in `styles.scss` explaining why menu-item styles are global.

## Implementation verification

- `npx ng test --ts-config=tsconfig.observation-dashboard.spec.json --include=src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.spec.ts --browsers=ChromeHeadless` — 17/17 passing
- `npx tsx --test ../tests/functions/rh-agent-mcp-redactor.test.ts` (from `functions/`) — 11/11 passing
- `npx ng build --configuration development --no-progress` — success
- `npm --prefix functions run typecheck` — success
- `npx tsc --noEmit -p tsconfig.observation-dashboard.spec.json` — success
