**Topic:** #657 — Robinhood MCP
**Thread:** #658 — Full RH MCP Tool Discovery
**Blueprint:** #680
**Task:** #688 — BE-IMPL: Discovery doc assembler
**QA Issue:** #815
**Type:** UAT
**Status:** Complete
**Date:** 2026-10-06

# UAT — Discovery doc assembler (#688)

## Scope

The assembler joins `probe-manifest.json` × `captures/` × live `tools/list` × drift metadata and emits the canonical discovery doc draft. Deliverables under test:

- `functions/src/rh-agent-mcp/diagnostics/assemble-discovery-doc.ts` (library)
- `functions/src/rh-agent-mcp/diagnostics/run-assemble-discovery-doc.ts` (CLI)
- `tests/functions/rh-agent-mcp-discovery-assembler.test.ts` (12 unit tests, wired into `test:rh-agent-mcp-discovery`)
- `docs/topics/657-rh-mcp/rh-mcp-tool-discovery-canonical-657-658-689.md` (emitted artifact)

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, Node 20+, deps installed in `functions/` (`npm ci` if needed)
- No credentials, network, or market session required — all inputs are committed files
- Inputs must exist: `docs/topics/657-rh-mcp/probe-manifest.json`, `docs/topics/657-rh-mcp/captures/` (235 files incl. `00-drift.json`, `01-live-tools-list.json`)

## Scenarios

### S1 — CLI emits the doc to the pinned path

- Run: `cd functions && npx tsx src/rh-agent-mcp/diagnostics/run-assemble-discovery-doc.ts`
- Expected: console prints `tools=76 probes=<n> captures=233` and `wrote ...rh-mcp-tool-discovery-canonical-657-658-689.md`; exit 0.
- Result: PASS — `tools=76 probes=274 captures=233`, wrote to pinned path, exit 0 (2026-10-06)

### S2 — Unit suite runs via the wired script

- Run: `cd functions && npm run test:rh-agent-mcp-discovery`
- Expected: 130 tests, 0 failures — proving the assembler test file is wired into the script (post-remediation).
- Result: PASS — 130 tests / 0 fail via `npm run test:rh-agent-mcp-discovery`

### S3 — Coverage matrix = live tool count with reconciling statuses

- Inspect the emitted doc's coverage matrix.
- Expected: 76 matrix rows (one per live tool); statuses = 50 `probed`, 21 `missing`, 3 `error-only` (`get_crypto_orders`, `preview_crypto_order`, `run_scan`), 1 `unprobed` (`cancel_equity_order`), 1 `declined` (`place_equity_order`). Verify 3 sample statuses against `captures/` by hand.
- Result: PASS — 76 rows; statuses = 50 probed / 21 missing / 3 error-only / 1 unprobed / 1 declined — exact match to captures

### S4 — Every live tool gets a section under its domain

- Expected: 76 `###` sections under all 9 `##` domain headers (Account & Performance, Market Data & Research, Options, Crypto, Alerts, SEC Filings, Scanners, Watchlists, Orders). No `Other` section.
- Result: PASS — 76 `###` sections, all 9 domains, no `Other`

### S5 — Params tables come from the LIVE inputSchema

- Inspect `get_equity_quotes` and a union-typed param (e.g. `symbols` showing `null \| array`).
- Expected: type arrays render as escaped unions, required column correct, descriptions present.
- Result: PASS — `symbols | null \| array | yes` union type renders escaped, required column correct

### S6 — Response field trees from success captures only

- Inspect `get_equity_quotes` field tree — `results: array<object>` with nested `quote` fields and `null` unions.
- Expected: error capture payload keys (e.g. `error.code`) never appear inside success field trees.
- Result: PASS — `results: array<object>` + null unions; error payload keys absent from trees

### S7 — Capture links all resolve

- Extract every `captures/{id}.json` link; check each file exists on disk.
- Expected: 233 links, 233 resolves, zero broken.
- Result: PASS — 233 unique links, 233 files on disk, zero broken

### S8 — Full tool descriptions (post-remediation)

- Inspect `exercise_option` and `create_alert` sections.
- Expected: `exercise_option` shows the multi-paragraph confirm-first warning; `create_alert` shows the condition_type matrix — not just first lines.
- Result: PASS — `exercise_option` confirm-first warning + `create_alert` full condition/param-rules matrix present

### S9 — Status messaging correctness

- `cancel_equity_order` (status `unprobed`, 10 manifest probes) must say "probes authored but not yet executed", not "missing probes".
- `exercise_option` (status `missing`) says "missing probes".
- `place_equity_order` (status `declined`) section explains the mutation was declined.
- Result: PASS — `cancel_equity_order` says "authored but not yet executed"; `exercise_option` "missing probes"; `place_equity_order` explains declined mutation

### S10 — Drift section renders real drift JSON

- Expected: drift block shows 76 live vs 49 catalog, 27 added tools, 37 changed schemas — matching `captures/00-drift.json`.
- Result: PASS — 76 live vs 49 catalog, added + changed lists match `00-drift.json`

### S11 — No account numbers / resolved args in the doc

- Grep the doc for account-number patterns and resolved arg values (e.g. `OOMA_ORDER_ID` values, price env values).
- Expected: only masked `••••` patterns may appear; zero raw account numbers; doc contains field names/types/descriptions/notes only — never response values.
- Result: PASS — zero 8–12-digit account-like numbers; doc carries names/types/descriptions/notes only

### S12 — Safety classifications correct

- `place_equity_order` → financial mutation; `review_equity_order`/`preview_scan` → simulation; `get_equity_quotes` → read-only; spot-check 2 more.
- Result: PASS — place_equity_order=financial mutation, review_equity_order/preview_scan=simulation, get_equity_quotes=read-only

## Traceability

| #688 AC | Scenario |
|---|---|
| Coverage matrix join, gaps visible | S3, S9 |
| Per-tool: params, field tree, capture links, notes | S5, S6, S7 |
| Drift section | S10 |
| Emit to pinned filename | S1 |
| Remediated defects covered | S2, S8, S9 |

## Regression / smoke

- [x] `npm run test:rh-agent-mcp-discovery` — 130 pass (S2)
- [x] `npx tsc --noEmit` clean on diagnostics files (review step)
- [x] Doc regenerated 3× this session — identical structure/statuses each run (only generatedAt varies)
