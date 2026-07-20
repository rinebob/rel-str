# Thermo-Nuclear Code Quality Review — Robinhood MCP Observation Dashboard Rollout

**Review date:** 2026-07-19  
**Scope:** Uncommitted working-tree changes vs. `HEAD`  
**Reviewer:** Cascade

---

## Summary

The rollout implements the full 49-tool MCP observation surface (backend registry, JSON Schema validation, frontend grouped selector, enum/date inputs, and mutation confirmation gating). After a first-pass review, the most serious structural issues were fixed: tool grouping is now domain-based instead of rollout-phase-based, the confirmation-flow bug was fixed, and the hand-rolled JSON Schema validator was replaced with `ajv`.

A few smaller cleanups remain before the change is fully clean.

---

## Blockers / High-Priority Fixes (resolved)

### 1. Tool registry was organized by arbitrary rollout phase

**Finding:** `functions/src/rh-agent-mcp/tools/robinhood-tools.ts` grouped all 49 tools into `PHASE_0_TOOLS` ... `PHASE_7_TOOLS`, exposed `phase` in the public tool definition, and derived category and mutation flags from the phase number.

**Why it mattered:** Rollout phase is a scheduling detail, not a domain concept. Tying mutation status and UI grouping to phase numbers makes the code brittle whenever the rollout schedule changes.

**Fix applied:**
- Replaced phase sets with domain sets: `ACCOUNT_AND_PERFORMANCE_TOOLS`, `MARKET_DATA_AND_RESEARCH_TOOLS`, `OPTIONS_TOOLS`, `SCANNER_TOOLS`, `WATCHLIST_TOOLS`, `ORDER_TOOLS`.
- Removed `phase` from `RobinhoodToolDefinition`.
- Categories are derived from the domain groups.
- Mutation/simulation/financial flags are explicit sets, not derived from phase numbers.

---

### 2. Confirmation button was permanently disabled

**Finding:** In `ObservationToolFormComponent`, `canExecute()` returned `false` when a mutation/simulation tool needed confirmation but had not yet been acknowledged. Because the button's `[disabled]` binding used `canExecute()`, the user could never click **Confirm** to reveal the confirmation panel.

**Fix applied:** `canExecute()` now returns `true` in the unacknowledged confirmation state, so the first click reveals the panel and the typed confirmation gates the actual execution.

---

### 3. Hand-rolled JSON Schema validator

**Finding:** `functions/src/rh-agent-mcp/tools/schema-validation.ts` implemented custom type coercion, array/object traversal, enum handling, and `additionalProperties` logic.

**Why it mattered:** It duplicated shape-inference logic with the frontend, was incomplete compared to a real validator, and was a maintenance liability.

**Fix applied:** Replaced the file with a thin wrapper around `ajv` using `coerceTypes`, `removeAdditional`, and `useDefaults`.

---

## Remaining Cleanup (resolved)

1. **Drop the `RobinhoodToolName` union in `robinhood-tools.ts`.** Done.
2. **Cache compiled AJV validators.** Done (`WeakMap` keyed by schema).
3. **Inline `normalizeToolName` or delete it.** Done — removed the wrapper, exported `stripServerPrefix`.
4. **Move confirmation state into a small state machine.** Done — replaced boolean `confirmationAcknowledged` with `'idle' | 'confirming'`.
5. **Delete `parseInteger` in the form component.** Done.
6. **Fix or skip the environment-sensitive API test.** Done — test now injects a repository that returns no credential.
7. **Cache enriched observation tool list.** Done.
8. **`allErrors: true` in AJV.** Done.
9. **Connection errors were uncaught in `executeObservationTool`.** Fixed by moving `connectLocalRobinhoodMcpSession` inside the `try` block and making the API injectable with a failing repository.

---

## Smaller Notes

- Date-format validation is not enforced because `ajv-formats` is not installed. Frontend date inputs already produce valid ISO dates, so this is acceptable for now.

---

## Second-Pass Review

After the cleanups:

- `robinhood-tools.ts` is clean: domain groups are the single source of truth, the `RobinhoodToolName` union is gone, the tool list is cached, and mutation/simulation/financial flags are explicit sets.
- `schema-validation.ts` is a thin `ajv` wrapper with a `WeakMap` cache and `allErrors: true`.
- `robinhood-tool-executor.ts` now catches connection errors correctly and strips the server prefix via the shared helper.
- `robinhood-observation-api.ts` accepts optional executor options for tests.
- The frontend confirmation state is now `'idle' | 'confirming'` instead of a boolean flag.
- The credentials-unavailable API test injects a failing repository and asserts the `AUTH` category.

### Minor notes after the second pass

- The mutation/simulation/financial sets in `robinhood-tools.ts` could be derived from the domain groups, but keeping them explicit makes intent clear.

## Verdict

The rollout is functionally correct and the structural issues from the thermo-nuclear review have been resolved. All targeted backend and frontend tests pass, the API builds, and the local observation server is running. The change is ready to merge.
