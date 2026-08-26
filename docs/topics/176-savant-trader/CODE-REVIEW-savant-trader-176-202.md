**Topic:** Savant Trader — FE-D2a: Delete old code (agent-order page + facade)
**Issue:** #202
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-26
**Last Updated:** 2026-08-26

---

## Summary

Three-axis review of FE-D2a (#202): Delete old code (agent-order page + facade). The old `RhAgentOrderComponent` was rewritten in-place during FE-C1a/C1b/D1 as the new signal-order screen. The old `RhAgentService` facade and `/rh-agent-order` route were already removed during the S1 rename tasks. This task renames the stale `pages/agent-order/` directory to `pages/signal-order/` to align with the route, and updates the 2 import paths that referenced it.

6 files (4 renamed, 2 modified), no logic changes.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-D2a | #202 | Delete old code (agent-order page + facade) | 6_REVIEW |

**Verdict: PASS** — no critical or major findings. All acceptance criteria met.

---

## Standards

### Findings discovered and fixed

**1. Documentation references old path (MINOR → fixed)**
- **File:** `docs/topics/176-savant-trader/IMPL-savant-trader-order-placement-fe.md:161-164`
- Implementation plan section 9 still said "Delete `pages/agent-order/`" but the actual implementation renamed it.
- **Fix:** Updated section 9 to reflect the rename and note that RhAgentService was already removed during S1.

### Findings accepted (no fix needed)

**2. Component class name is generic (MINOR → accepted)**
- **File:** `src/app/features/savant-trader/pages/signal-order/order.component.ts:37`
- `OrderComponent` is generic; `SignalOrderComponent` would be more specific.
- **Resolution:** Accepted — renaming would touch many files (spec, imports, exports, template) for marginal benefit. Low priority.

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | pages/agent-order/ (or renamed equivalent) deleted | MET | Directory renamed to `pages/signal-order/` via `git mv`. Old code was already rewritten in-place during FE-C1a/C1b/D1. |
| 2 | RhAgentService facade deleted | MET | No `RhAgentService` references found in `src/`. Already removed during S1 rename tasks. |
| 3 | All consumers of RhAgentService updated | MET | No consumers remain — no `RhAgentService` imports found in `src/`. |
| 4 | Route /rh-agent-order removed | MET | `SIGNAL_ORDER = 'signal-order'` in interfaces.ts:42. No `RH_AGENT_ORDER` constant found. Already replaced in S1c. |
| 5 | FE build succeeds | MET | `ng build` — PASS (12.9s) |
| 6 | Existing tests pass | MET | 77/77 tests PASS |

---

## Thermo-nuclear

### Rename vs delete
The rename is correct. The old `RhAgentOrderComponent` was rewritten in-place during FE-C1a/C1b/D1 as the new signal-order screen. Deleting and recreating would have been unnecessary overhead. The directory rename aligns the path with the route (`/signal-order`).

### Hidden references
No hidden references found. Grep searches for `agent-order`, `RhAgentService`, `rh-agent-order`, `RhAgentOrderComponent`, `app-rh-agent-order` all returned 0 matches in `src/`.

### Directory/route alignment
`signal-order/` matches `/signal-order` route. Consistent with other savant-trader pages (`signal-review/`, `chart-review/`).

### Breakage risk
Low. Rename done via `git mv` (preserves history). All import paths updated. No stale references.

---

## Verification

- **Build:** PASS (`ng build` — 12.9s)
- **Tests:** 77/77 PASS (28 ticket + 16 queue + 15 container + 18 facade)

---

## Files changed

| File | Status | Description |
|---|---|---|
| `pages/agent-order/order.component.ts` | RENAMED → `pages/signal-order/` | Component (no content change) |
| `pages/agent-order/order.component.html` | RENAMED → `pages/signal-order/` | Template (no content change) |
| `pages/agent-order/order.component.scss` | RENAMED → `pages/signal-order/` | Styles (no content change) |
| `pages/agent-order/order.component.spec.ts` | RENAMED → `pages/signal-order/` | Tests (no content change) |
| `src/app/features/savant-trader/index.ts` | MODIFIED | Import path agent-order → signal-order |
| `src/app/core/core-routes.ts` | MODIFIED | Lazy import path agent-order → signal-order |
| `docs/topics/176-savant-trader/IMPL-savant-trader-order-placement-fe.md` | MODIFIED | Updated section 9 to reflect rename |
