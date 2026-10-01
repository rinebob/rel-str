**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** full-tool-discovery  
**Issue:** #675  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Domain:** RH-MCP  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-29  

> **2026-09-29 amendment.** Task 1 (manifest loader) and task 2 (drift check) shipped. Live server = **76 tools**; bundled catalog regenerated from live the same day (`.rh-mcp-tool-catalog.json`). The runner must validate the manifest against the **live** `tools/list` — the old catalog lacks `place_option_order.direction`, `create_scan.columns`, etc., and the strict unknown-arg check would falsely reject them. The read sweep expands to the ~20 newly-added read tools; newly-added mutation classes are deferred (see PRD amendment).  

# IMPL — BE: Full RH MCP Tool Discovery

Implements PRD `657-658-659-PRD-rh-mcp-robinhood-mcp-full-tool-discovery.md`. Single area: **BE** (all work is `functions/`-side Node tooling + doc assembly; no FE, no shared contracts).

## 1. Architecture

```mermaid
flowchart LR
  M[probe-manifest.json<br/>id, tool, args, gate, group] --> Runner[run-probe-manifest.ts]
  Runner -->|listTools| MCP[robinhood-trading MCP]
  Runner -->|diff| Cat[.rh-mcp-tool-catalog.json] --> Drift[captures/00-drift.json]
  Runner -->|callTool per probe| Exec[executeObservationTool]
  Exec --> Redactor[robinhood-response-redactor]
  Redactor --> Cap[captures/{probe-id}.json<br/>+ meta: latency, args, success, category]
  Gate{gate=mutation?} -.per-call confirm.-> Runner
  Cap --> Doc[assemble-discovery-doc.ts]
  Drift --> Doc
  Doc --> Out[Discovery doc + coverage matrix]
```

Three moving parts, all under `functions/src/rh-agent-mcp/diagnostics/`:

| Component | Job |
|---|---|
| **Probe manifest** (`probe-manifest.json` or `.ts`) | The single source of truth: every probe = `{ id, tool, args, group, gate: 'read' \| 'mutation', note }`. Doc assembly reads it — coverage can't drift from what actually ran. |
| **`run-probe-manifest.ts`** | Batch runner: fetches live `tools/list` → drift diff → iterates manifest in order → `read` probes run sequential-unattended → `mutation` probes halt for an interactive y/n per call → writes `captures/{id}.json` (redacted response + args + latency + success/category). `--only <id>` / `--group` / `--dry-run` filters for step-through sessions; resume-from-id. |

### Pacing model (not a straight serial run)

- **`read` probes** — strictly one call at a time (~300 ms spacing, tunable); auto-pause on any `success:false`, on 429/`Retry-After` (jittered 1s→30s backoff then ask), or on a failed shape capture; checkpoint pause + summary **between domain groups**; cursor pages followed sequentially within a probe.
- **`mutation` probes** — hard stop before every call: prints exact args, waits for `y`/`n`/`abort` (no `--yes-all`). After a `place_*` expected to fill, the runner polls `get_*_orders` until the order leaves `new`/`queued`/`confirmed` (timeout → ask) before the next probe — also required since RH allows one open order per position. `abort` prints the recovery checklist (open orders to cancel, positions to flatten) before exit.
- **Between sessions** — Phase-2 sessions are separate invocations; nothing runs unattended across session boundaries.
| **`assemble-discovery-doc.ts`** | Reads manifest + captures + live schema → emits per-tool sections (params table from live `inputSchema`, response field-tree w/ nullability, links to capture files, notes) + the 49-row coverage matrix. Generator output is a draft; hand-written notes overlay via manifest `note` fields and a curated notes file. |

## 2. Existing seams (reuse, don't rebuild)

| Existing | Reuse |
|---|---|
| `executeObservationTool(tool, args, {extraFields})` | The call path — already wraps `callTool` + redaction + success/category envelope. Runner calls this per probe. |
| `run-tool-observation.ts` | The single-call CLI precedent — the manifest runner is its batch sibling; keep it standalone rather than refactoring. |
| `robinhood-response-redactor.ts` | Redaction before any capture hits disk. Manifest's `redactFields` extends `extraFields` per probe (e.g. `account_number`). |
| `robinhood-tools.ts` bundled catalog | Drift baseline: live `tools/list` vs `.rh-mcp-tool-catalog.json`. |
| Credential bundle + `connectLocalRobinhoodMcpSession` | Auth — already solved locally; runner needs `NODE_OPTIONS` IPv4 preload. |

## 3. Phases → tasks

### Phase 1 — Probe harness
1. **Manifest format + loader/validator** ✅ #681 — schema-check each entry (known tool name, valid gate, unique ids); strict unknown-arg check; env placeholders.
2. **Drift check** ✅ #682 — live `tools/list` → `captures/00-drift.json` + `captures/01-live-tools-list.json`; catalog regenerated via `refresh-tool-catalog.ts` (76 tools).
3. **Runner** ✅ #683 — `probe-runner.ts` (injectable core) + `run-probe-manifest.ts` (CLI). Sequential iteration, `captures/{id}.json` (manifest args + **redacted** response + latency + success/category + skip reasons), `read` batch mode vs `mutation` interactive gate (`y/n` per call + `abort` → recovery checklist, no bypass flag), `--only`/`--group`/`--from`/`--dry-run`/`--auto`/`--pace-ms`, group checkpoints, settle poll via optional manifest `settle` spec. Live runs inject **live `tools/list`** into the validator; `--dry-run` validates against the catalog. Confirmed mutations dispatch via `executeProbeMutation` (same envelope + redaction as `executeObservationTool`, without the observation allowlist). Non-interactive stdin fails closed ('n').

### Phase 2 — Probe execution (owner-gated sessions)
4. **Read-only sweep** — ~36 original read tools + both `review_*` + the ~20 newly-added read tools (crypto reads, alerts list, SEC filings, historicals, analyst ratings, scanner datapoints…); manifest enumerates every param permutation; cursor-follow ≥1 paginated tool. **Requires extending `ALL_ENABLED_TOOLS` for the new reads** — `executeObservationTool` rejects non-allowlisted names. Unattended-batchable.
5. **OOMA equity matrix** — the E1–E9 / X1–X8 probe list from PRD US4. Gated per call.
6. **NFLX option matrix** — PRD US5: single-leg, debit + credit vertical call spreads, naked call, CSP. Gated per call.
7. **Error probes** — invalid symbol, missing required field, bogus `order_id` cancel, oversell.

### Phase 3 — Doc + verification
8. **Doc assembler** — manifest + captures + live schema → per-tool sections + coverage matrix skeleton (new domain sections for post-July groups).
9. **Discovery doc** — hand-finish: safety classifications, gap callouts (no `trailing_stop`, no `delete_watchlist`/`delete_scan`, multi-leg verdict, sell-to-open requirements, `direction` semantics), envelope section, links to captures; deferred new mutations marked `deferred`.
10. **Verify script** — `scripts/verify/rh-mcp-tool-inventory-*.ts`: every live tool present in doc, every tool has params + ≥1 response block or `deferred` marker, matrix row count = live tool count; README + run-all registration.

## 4. Decisions

- **Manifest is canonical.** A probe isn't "done" until its capture file exists; the coverage matrix is generated from manifest×captures join, so missing probes show as gaps — they can't be silently skipped.
- **Mutation gate is per-probe, not global.** No `--yes-all` for `gate: 'mutation'` entries — each prints its args and waits for `y`, `n` (record skipped), or `abort`.
- **Captures are evidence, committed.** `docs/topics/657-rh-mcp/captures/*.json` — redacted before write; account numbers never persisted (manifest injects `account_number` via env var at runtime, never stored in the manifest file itself).
- **One resting order at a time** — the equity/option manifests are ordered so every `place_*` probe is immediately followed by its `cancel_*` (or fill→close) pair.
- **`stop_market` direction semantics** get explicit probe pairs (above/below market, both sides) since the schema doesn't document them.
- **Multi-leg**: schema has no `maxItems` on `legs` — probe it rather than trusting the "Exactly one leg" prose.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Rate limiting during the read sweep | Sequential + spacing; honor 429/Retry-After; resume-from-id |
| A resting order fills before cancel (moving market) | Limit prices chosen to rest (bid for buys, +2% for sells); abort procedure flattens; owner watching the app |
| `place_option_order` CSP needs level-3/margin the account lacks | Rejection *is* the answer — captured verbatim |
| Live schema differs from bundled catalog | ✅ Realized 2026-09-29 — 76 vs 49 tools; catalog regenerated (stamped 2026-09-30); runner injects live list into validation |
| Manifest `account_number` leaks into repo | Env-injected at runtime; redactor strips from captures; verify script greps captures for account-number-shaped strings |
