**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** full-tool-discovery  
**Issue:** #680  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #792  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# CODE-REVIEW — #792 Observation page: surface all 76 tools

## Verdict: PASS

One nit-level finding (silent-continue on an already-gated path). No
critical or major findings.

## Scope under review

Retroactive review — the implementation landed in the working tree
before the ticket existed (#792's body documents this). Diff under review:

| File | Change |
|---|---|
| `functions/src/rh-agent-mcp/tools/robinhood-tools.ts` | +56 — 27 tools into the observation allowlist: new Crypto (8), Alerts (6), SEC Filings (4) groups + additions to A&P/Market Data/Options/Scanners/Orders; safety flags |
| `observation-dashboard.model.ts` | +45 — `ACCOUNT_NUMBER_PARAM_NAMES` (name-driven rhs detection), `inferPropertyType` → `json` for object/object-array, `cleanArgsForExecution` JSON.parse |
| `observation-dashboard.model.spec.ts` | +91 — json parse/passthrough, inferPropertyType, jsonArgsValid, rhs dropdown |
| `observation-tool-form.component.html` | +11 — `json` arg-type textarea case |
| `observation-tool-form.component.ts` | +3 — Crypto/Alerts/SEC Filings in `TOOL_CATEGORY_ORDER` |

Foreign diffs in the worktree (options/#960 client work, MCP session
infra, portfolio files from other sessions) were excluded from scope.

## Standards

Clean. The diff follows the file's existing conventions exactly —
same `Set<string>` group pattern, same safety-flag sets, same arg-type
inference structure, same spec style. Placement is correct: tool
groupings live in `robinhood-tools.ts` (the catalog of record), form
rendering in the tool-form, arg semantics in the model.

- `inferPropertyType` correctly handles union types (`['null','array']`,
  `['null','object']`) and array `items.type` — only string arrays keep
  the comma-separated input; object arrays and bare objects get `json`.
- `useRhsAccountNumber` is right in both directions verified against the
  canonical doc: `rhs_account_number` by name (all 6 crypto tools) and
  `account_number` only for the two tools whose schema documents rhs
  semantics (`get_pnl_trade_history`, `get_realized_pnl`). No other tool
  with an `account_number` param expects an rhs value — checked every
  param table in `rh-mcp-tools-*.md`.
- `resolveDefaultAccountNumber` maps the selected brokerage account →
  its `rhs_account_number` for rhs params, falling back to the brokerage
  number when rhs is absent — acceptable (accounts without rhs numbers
  aren't crypto-capable anyway).

## Spec (vs #792 ACs)

| AC | Evidence | Result |
|---|---|---|
| `listObservationTools()` returns all 76 tools across 9 categories | `TOOL_GROUPS` = 9 groups; per-set counts 7+15+7+8+6+4+8+11+10 = **76**, matching the live `tools/list` catalog | met |
| Financial mutations → type-the-name; mutations/simulations → click-confirm | `FINANCIAL_MUTATION_TOOLS` gains `place/cancel_crypto_order`, `exercise/cancel_option_exercise`; alert CRUD → `MUTATION_TOOLS`; `preview_crypto_order`, `preview_scan` → `SIMULATION_TOOLS`. Gates are pre-existing (form :119-124 `financialMutation()` → `confirmationText() === toolName`) | met |
| `rhs_account_number` params get the dropdown resolving rhs | name-driven `useRhsAccountNumber` + `resolveDefaultAccountNumber`; spec asserts `values['rhs_account_number'] === 'RHS-1'` | met |
| Object/array-of-object params render JSON textarea; malformed JSON blocks execute | `@case ('json')` textarea + `jsonArgsValid` gate in `execute()` + `JSON.parse` in `cleanArgsForExecution` | met |
| Jest model specs cover the new inference/validation/account-field detection | 25/25 pass (`observation-dashboard.model.spec.ts`); `tsc --noEmit -p tsconfig.app.json` clean | met |

Bonus catch worth noting: the old code would have rendered `legs`
(option-order) as a single-line string input — the `json` type fixes a
latent wrong-wire-format bug.

## Thermo-nuclear

Nothing. Flat sets, a param-name set, and one type-inference branch —
the right shape for this layer. No new abstractions to challenge.

## Findings

| Severity | Finding |
|---|---|
| nit | `cleanArgsForExecution` `catch { continue }` silently drops a malformed `json` arg if the path runs without the `jsonArgsValid` gate (model.ts:421-428). Documented in-comment and unreachable via `execute()` — noted, not blocking. |

## Tests

- `observation-dashboard.model.spec.ts` — 25/25 pass
- `npx tsc --noEmit -p tsconfig.app.json` — clean
