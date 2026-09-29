**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** full-tool-discovery  
**Issue:** #675  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Domain:** RH-MCP  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# TEST — BE: Full RH MCP Tool Discovery

Most of this Thread's "test surface" is the probe harness (pure/verifiable) plus the doc-coverage verify script. Live probes are gated manual sessions, not automated tests.

## E2E User Journeys

- **Harness dry-run:** `run-probe-manifest.ts --dry-run` prints the ordered probe list + gate classification without calling MCP → operator confirms coverage before the session.
- **Discovery session:** operator runs the manifest group-by-group; mutation probes prompt per call; captures land under `docs/topics/657-rh-mcp/captures/`.
- **Doc check:** verify script passes once every catalog tool has a doc section with params + ≥1 response block.

## Integration Tests

- **Runner → `executeObservationTool`:** mock the executor; assert sequential order, capture write shape, `redactFields` passthrough, gate prompt on `mutation` entries, skip/abort bookkeeping.
- **Pacing behavior:** post-fill settle poll waits for order to leave `new`/`queued`/`confirmed` before the next probe (timeout → operator prompt); `read` auto-pause on `success:false` and 429/Retry-After backoff; between-group checkpoint pause; `abort` prints the recovery checklist.
- **Drift checker:** fixture live `tools/list` vs fixture bundled catalog → expected added/removed/changed-schema output.
- **Doc assembler:** fixture manifest + fixture captures → emitted sections contain the tool name, a params table from the fixture schema, a response field-tree derived from the capture, and a coverage-matrix row.

## Unit Tests

- **Manifest loader/validator** — unknown tool → error naming it; duplicate id → error; missing gate → error; enum of gate values enforced.
- **Drift diff** — pure function: added/removed/renamed/schema-changed classifications on small fixtures.
- **Field-tree summarizer** (reuse `summarizeShape` approach from `option-quote-discovery-function.ts`) — nested objects, arrays, nullability, depth cap.
- **Coverage matrix join** — manifest×captures produces probed/skipped/missing rows.
- **Capture redaction check** — sample capture contains no account-number-shaped values.

## Test Seams

- **Highest seam:** `executeObservationTool` boundary — mock it for all harness tests; no MCP needed in CI.
- **Verify script seam:** reads the doc + catalog JSON from disk — no credentials, CI-safe (same pattern as `workflows-template-647.ts`).
- Live probes themselves are manual (US8 gating) — never automated.

## Edge Cases

- Tool returns `success: false` → capture records error + category, probe marked failed (not silently absent).
- `next_cursor` empty on first page → pagination probe marked single-page.
- Capture write fails mid-run → runner stops (no partial-overwrite ambiguity).
- Manifest references a tool removed upstream → validator fails the sweep, not just that probe.
- `--only <id>` rerun overwrites that capture cleanly (idempotent probe ids).

## Existing Coverage

- `run-tool-observation.ts` + `executeObservationTool` + `robinhood-response-redactor.ts` are already exercised in production paths — reused, not re-tested here.
- `option-quote-discovery-function.ts` shows the capture/summarize pattern this generalizes.
