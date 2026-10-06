**Topic:** #657 — Robinhood MCP
**Thread:** #658 — Full RH MCP Tool Discovery
**Blueprint:** #680
**Task:** #687 — BE-IMPL: Error-envelope probe session
**QA Issue:** #821
**Type:** UAT
**Status:** Complete
**Date:** 2026-10-06

# UAT — Error-envelope probe session (#687)

## Scope

Deliberate invalid calls against the live `robinhood-trading` MCP server to
capture real error shapes: invalid symbol, missing required field, `cancel_*`
on bogus `order_id`, plus adjacent failure modes (bad ids, inverted ranges,
malformed timestamps, empty/enum-invalid inputs, bogus account). Deliverables:
15 `err-matrix` manifest probes, 17 capture files, TEST-doc conformance notes.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`; inputs are committed files (manifest + captures)
- For live re-execution only: `.env.local` with `RH_ACCOUNT_NUMBER`, fresh OAuth bootstrap (`npm run probe:rh-agent-mcp-auth`), a TTY (mutation probes prompt y/n)

## Scenarios

### S1 — Manifest validates, err-matrix present

- Run: `cd functions && npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --dry-run`
- Expected: 289 probes planned, 0 errors; 15 `err-matrix` entries listed.
- Result: PASS — 289 planned, 0 errors; 15 err-matrix present (2026-10-06)

### S2 — ≥3 distinct error responses with categories (AC1)

- Inspect the 17 `captures/err-*.json`; count distinct response shapes + `rh_error_category`/`category` fields.
- Expected: ≥3 distinct shapes — actual: JSON 404 `detail` ×3, structured `missing_instruments` 404, raw HTML 404 ×2, server validation strings ×5, executor VALIDATION ×2.
- Result: PASS — 5 distinct error shape families + a success-deviation family (6 total)

### S3 — Conformance/deviation noted per tool (AC2)

- Read TEST doc §"Error-envelope session (#687)".
- Expected: shape→probe table + conformance bullets; every named deviation backed by a capture file.
- Result: PASS — table accounts for all 17 files; every named probe verified on disk

### S4 — Success-instead-of-error deviation is real

- Inspect `err-chain-bad-symbol`, `err-crypto-bad-pair`, `err-optq-bad-id`, `err-markalerts-bad-id`.
- Expected: `outcome: "success"`, `success: true` — empty results or ack echo (`marked:true`), not errors.
- Result: PASS — all 4 confirmed: chains/crypto-quotes/option-quotes empty-success; mark_alerts_read returns `marked:true` ack

### S5 — HTML-404 vs JSON-404 contrast on cancel_equity_order

- `err-cancel-bad-order` (well-formed nil UUID) → `{"detail":"Not found."}`; `err-cancel-malformed-order` (`"bogus"`) → raw HTML page.
- Result: PASS — JSON `detail` vs raw HTML `<title>Not Found</title>` confirmed, per id well-formedness

### S6 — Client-layer validation captures are honest

- `err-quote-missing-param`, `err-quote-wrong-type`: outcome error, category VALIDATION, `latencyMs: 0`, notes disclose they never reached the server (manifest runner can't express schema-invalid args).
- Result: PASS — both captures show VALIDATION + latencyMs 0 + disclosure notes

### S7 — Redaction + mutation safety

- Grep all err captures for 8-12 digit numbers — expected: only intentional nil-UUIDs; `$ENV:` placeholders intact. The 3 mutation probes used only bogus/nonexistent ids — nothing real touched (bogus alert ids, nil/fake order ids).
- Result: PASS — regex sweep finds only `00000000` nil-UUID digits; `$ENV:` placeholders intact; mutations provably no-op (ids match nothing real)

### S8 — Capture↔manifest join integrity

- Every runner capture's `id`/`tool`/`args`/`gate` matches its manifest entry; the 2 hand captures have no manifest entry (documented).
- Result: PASS — 15/15 join clean, 2 hand captures correctly manifest-absent

## Traceability

| #687 AC | Scenario |
|---|---|
| ≥3 distinct error responses captured with categories | S2, S4, S5 |
| Error envelope conformance/deviation noted per tool | S3, S5, S6 |
| Invalid symbol / missing field / cancel bogus id | S2, S5, S6 |

## Regression / smoke

- [x] Dry-run validates whole manifest including #685/#684 entries (S1)
- [x] No `err-*` capture contains account numbers or resolved env values (S7)
- [x] Discovery suite still green: `npm run test:rh-agent-mcp-discovery` (130 — 0 fail, 2026-10-06)
