**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** rh-mcp-full-tool-discovery  
**Issue:** #892  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #685  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  
**Result:** PASS  

## Scenarios

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Every planned eq-matrix row has a capture (or intentional skip) | PASS | 46 manifest probes → 49 `mx-*` captures on disk (`mx-can-cleanup`/`mx-sell-flat-xh` reruns overwrite same file; 3 extra hand captures `mx-buy-lim-bid-filled`, `mx-can-bid-403-filled`, `mx-buy-lim-bid-409-refid`; `mx-can-lots` skip documented — nothing live to cancel) |
| 2 | Manifest still validates after session edits | PASS | `--dry-run`: 313 probes, 0 errors |
| 3 | Session-findings claims match captures verbatim | PASS | `mx-sell-xh-frac`: `fractional and dollar-based orders are only allowed in regular_hours`; `mx-sell-lots`: `Some of your selected lots are no longer available.`; `mx-sell-oversell`/`mx-sell-short`: identical `Not enough shares to sell.`; `mx-buy-lim-bid-409-refid`: `Reference ID must be unique.`; `mx-can-bid-403-filled`: `Order cannot be cancelled at this time.` |
| 4 | End state evidenced | PASS | `mx-pos-postflat`: OOMA 0.252705 qty / 0 held-for-sells; `mx-orders-confirmed` (post-session refresh): 0 OOMA resting orders across 22 confirmed + full unfiltered list |
| 5 | AUTOYES bypass scoped to mutation gate only | PASS | Positive: `RH_PROBE_AUTOYES=1 mx-sell-xh-frac` auto-approved the mutation gate → re-captured the verbatim reject. Negative ×2: same run's **retry** prompt went `-> 'n'` (no bypass); a second run with no env var declined at the mutation gate `-> 'n'`. Settle-timeout/checkpoint prompts untouched by the regex. |
| 6 | No secrets / unredacted identifiers | PASS | `account_number` masked `••••6245` in every response across all captures; request args store `$ENV:` placeholders. Order/ref/instrument UUIDs retained deliberately — they are evidence ids, not secrets (same convention as shipped err-* captures). |
| 7 | Residual documented, not hidden | PASS | TEST doc "Session results" records OOMA 0.252705 fractional remainder, why it persists (regular_hours-only post-close), and the finish-flat action. Review doc records the literal "ends flat" deviation under Spec. |

## Notes

- The 0.252705 fractional remainder is a **structural constraint**, not a task
  failure: fractional/dollar orders are `regular_hours`-only and the matrix
  crossed 16:00 ET mid-session. One regular-hours market sell completes flat.
- `mx-sell-xh-frac` was re-captured during QA after the negative-control run
  overwrote it with `skipped` — the verbatim reject is on disk again.
- Nothing committed; ships under the task's ship gate.
