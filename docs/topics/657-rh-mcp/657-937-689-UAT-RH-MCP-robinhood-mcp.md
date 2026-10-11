**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** rh-mcp-full-tool-discovery  
**Issue:** #937  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #689  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# UAT — Final discovery doc: safety, gaps, envelope (#689)

## Scope

Acceptance for the canonical Robinhood MCP tool discovery resource:
`docs/topics/657-rh-mcp/rh-mcp-tool-discovery-canonical-657-658-689.md`
— a data/docs deliverable, no application code and no UI surface.

Task ACs under test (issue #689):

- AC1 — One doc, domain-group sections matching `robinhood-tools.ts`
- AC2 — Every tool has params + observed response + notes
- AC3 — Gaps documented verbatim; safety class per tool
- AC4 — Redacted captures linked, committed under the topic dir

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str` on the working branch.
- Node deps installed (`functions/`).
- No Robinhood credentials needed — all checks run against committed
  artifacts (manifest, captures, canonical doc, `robinhood-tools.ts`).

## Scenarios

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Complete tool inventory | Count `### ` tool sections in the canonical doc | 76 sections, 76 unique tool names, each with `**Safety:**`, `**Parameters`, and `**Notes:**` |
| 2 | Coverage matrix | Read status column of the coverage matrix | 69 `probed` + 7 `error-only` = 76; zero `missing`/`unprobed` |
| 3 | Capture evidence | Count files in `docs/topics/657-rh-mcp/captures/`; resolve every `captures/*.json` link in the doc | 352 capture files; every link resolves; no unmasked `account_number`/`rhs_account_number` values |
| 4 | Envelope contract | Compare the "Response envelope" section against all 352 capture response shapes | Success = `{data,guide}`; error = `{_meta:{rh_error_category},content,isError}`; third `{category,error}` shape qualified as runner-side VALIDATION |
| 5 | Safety classes match code | Diff doc's classification table + per-tool `**Safety:**` lines against `MUTATION_TOOLS`/`SIMULATION_TOOLS` in `robinhood-tools.ts` | 49 read-only / 8 financial mutation / 15 account write / 4 simulation; zero mismatches |
| 6 | Gap callouts verbatim | Compare quoted errors in the "Gaps & undocumented behaviors" section against the referenced capture files | Multi-leg, stop_market-BTO, naked-STO, crypto-gate quotes byte-match captures |
| 7 | App allowlist section | Compare section text against `TOOL_GROUPS`/`ALL_ENABLED_TOOLS` | States 9 groups, all enabled — matches code (corrected during review) |
| 8 | Drift section | Read drift block; verify direction of `get_equity_technical_indicators` change vs `01-live-tools-list.json` + bundled catalog | 76 live = 76 catalog; residual: live added deprecated `symbol`, dropped `symbols` from `required` |
| 9 | Manifest integrity + tests | `npm run test:rh-agent-mcp-discovery` | 130/130 pass |

## Traceability

| AC | Scenario(s) |
|---|---|
| AC1 | 1, 7 |
| AC2 | 1, 2, 3 |
| AC3 | 5, 6 |
| AC4 | 3 |

## Regression / smoke

- No app code touched — `git status` scope is `docs/topics/657-rh-mcp/` only.
- Discovery test suite green (scenario 9).

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Complete tool inventory | PASS | 76 unique `### ` sections; every one carries `**Safety:**`, `**Parameters`, `**Notes:**` |
| 2 | Coverage matrix | PASS | 69 `probed` + 7 `error-only` = 76; zero `missing`/`unprobed` (`cancel_crypto_order` re-armed to a nil-order_id error probe during review) |
| 3 | Capture evidence | PASS | 354 files = 352 probe captures + `00-drift.json` + `01-live-tools-list.json`; all doc links resolve; zero unmasked account numbers across all captures (sole non-masked value is the intentional bogus `"0"` in `err-positions-bad-acct`) |
| 4 | Envelope contract | PASS | Capture census: `{data,guide}`×296, `{_meta,content,isError}`×53 (all `rh_error_category=invalid_request`), `{category,error}`×2 — matches doc claims; VALIDATION shape documented as runner-side |
| 5 | Safety classes | PASS | Per-tool `**Safety:**` diffed against `MUTATION_TOOLS`/`SIMULATION_TOOLS` in `robinhood-tools.ts`: zero mismatches; table = 49 read-only / 8 financial / 15 account-write / 4 simulation |
| 6 | Gap callouts verbatim | PASS | `opt-place-spread` (multi-leg), `opt-place-stop` (stop_market-BTO), `opt-place-naked` (infinite risk), `cx-place` (crypto gate), `ox-exercise` (not_enough_contracts), `ox-cancel-ex` (no queued exercise) — all byte-verified |
| 7 | Allowlist section | PASS | Doc states 9 groups matching `TOOL_GROUPS` exactly; all in `ALL_ENABLED_TOOLS` (AC's "6" corrected during review — code is authoritative) |
| 8 | Drift direction | PASS | Verified vs live tools/list + catalog: live added deprecated `symbol`, dropped `symbols` from `required`; doc states the correct direction |
| 9 | Manifest + tests | PASS | `npm run test:rh-agent-mcp-discovery` — 130/130 (6 suites, ~0.8s) |

### Refinement pass

Not applicable — no user-facing surface (documentation/captures only).

### Findings

- None blocking. Cosmetic nit accepted at review: 40 `mx-*` probes lack `env` declarations (pre-#686 convention; `requiredEnv` is loader-computed so it's inert).
- Operational residue (not a defect): `MCP-DISCOVERY-TEST-2` watchlist + `MCP-DISCOVERY-TEST` scan must be deleted in-app — no `delete_watchlist`/`delete_scan` tools exist (documented gap).
