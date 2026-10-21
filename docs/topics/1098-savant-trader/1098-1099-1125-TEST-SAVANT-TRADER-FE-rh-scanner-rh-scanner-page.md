**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1125  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# Test Plan: RH Scanner page (FE)

Highest-value seam is the **compare engine + row parser** (pure fns over
captured wire shapes). Component specs cover render states; the verify
relay is the live tripwire.

## E2E User Journeys

1. Pick `Quality — Large Cap` → Run → table renders, every row carries a
   tracked/untracked badge, Add bucket count equals untracked rows.
2. Run `evaluateTracked` on a quality recipe → progress shows →
   Drop/Dead/No-data buckets populate; a proposal doc persists and
   appears in history.
3. Open a history entry → its buckets render read-only.
4. Session expiry → run fails → the reauthorization error card shows
   (not an empty table).

## Integration Tests (jest + TestBed)

- `scanner.component.spec` — renders picker/table; drives the
  store mock through loading/rows/error/capped states (prior art:
  `gallery-view.component.spec.ts`). The compare panel is #1141
  scope — the #1140 spec covers picker/table/status/error/empty.
- `scanner.service.spec` — rhApi seam mocked at `RobinhoodMcpClient`;
  Firestore mocked at `@angular/fire` (AGENTS.md provider pattern);
  asserts the allowlist rejects a non-`preview_scan` tool name.
- `scanner.store.spec` — run→compare→persist flow; proposal history
  ordering; in-flight cancel if a second run supersedes.

## Unit Tests

- `scanner-rows.util.spec` — parse a **real capture fixture**
  (`dep-prev-scan-01.json` row shape) verbatim; `numericColumn`/
  `percentColumn` coercion (fraction→percent, `''`→null);
  canonical-column lookup via `columnLookup`.
- `scanner-compare.util.spec` — all four buckets; dead = absent vs
  no-data = returned-but-blank distinction; `unevaluated` chunk symbols
  flagged separately from true dead; `truncated` at both caps; empty
  universe / empty results edge cases.
- `scanner-recipes` spec — every recipe's filters validate against the
  SHARED types; percent fields are expression filters with fraction
  thresholds (regression guard against enum PERCENTAGE use); every
  recipe id unique; `supportsPrune` recipes carry a `noDataPred`.
- `robinhood-mcp-client` additions — `previewScanSpec` parse on the
  fixture; batch path for `evaluateUniverse` chunks (mock
  `executeTools`, assert ≤20 calls and per-chunk rejection isolation).

## Test Seams

- **Highest (live):** `functions/scripts/verify/rh-scanner-recipes-1098.ts`
  — every catalog recipe run via `preview_scan` on the real session;
  read-only, asserts `success` + row shape.
- **Mid (fixture):** capture-fixture parse — real wire shape, no network.
- **Low (pure):** compare engine, row coercion, catalog structure.

## Existing Test Coverage / Prior Art

- `robinhood-mcp-client.service.spec.ts` — ToolSpec/executeBatch patterns
  to mirror.
- `gallery-cards.util.spec.ts`, `analysis.store.spec.ts` — pure-util +
  signalStore spec conventions.
- `shared/robinhood-mcp-contracts` types come from the SHARED blueprint.

## Edge Cases

- Column values always strings; blanks are `''` (no-data ≠ zero).
- `results` empty + `total_items: 0` renders "no matches", not error.
- `results.length === 200` or `total_items ≥ 400` → truncation warning.
- Duplicate tickers across chunks (a symbol in two batches) dedupe by
  ticker.
- `evaluateTracked` on a recipe without `supportsPrune` — action hidden.
- A compare run finishing while another is in flight — last-writer-wins
  on state; proposals are append-only docs so both persist.
