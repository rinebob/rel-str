**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #438  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Task:** #706  
**Domain:** SIGNAL-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# Code Review — #706 Anchor→current→%Δ queue rows

## Scope

| File | Change |
|---|---|
| `services/order-ticket.types.ts` | `OrderTicketSignalContext.signalPrice?: number` — price at signal generation |
| `stores/signal-review.facade.ts` | `buildSignalOrderTickets` captures `signal.closePrice` → `signalContext.signalPrice` (key omitted when absent) |
| `components/order-queue/order-queue.component.ts` | `anchorFor` (precedence: At signal → Avg cost [FILLED only] → Stop → Limit; OPTION excluded), `pctFor` (1dp %Δ), `pctClassFor` (direction coloring) |
| `order-queue.component.html` | `.item-anchor` + `.item-pct` always-rendered fixed columns |
| `order-queue.component.scss` | anchor/pct styles, column-width rebalance, `.item-date` hidden <1200px |
| `order-queue.component.spec.ts` | 10 new specs: precedence, status gate, labels, missing-data, direction, options |
| `signal-review.facade.spec.ts` | closePrice→signalPrice propagation + key-omission |

## Verdict: PASS — CONVERGED (3 rounds)

Spec: **PASS** — all 6 ACs met with DOM-level test coverage.
Standards: **clean** — no critical/major.
Thermo-nuclear: **CONVERGED** — 2 MEDIUM fixed in round 1, 1 MEDIUM + 2 LOW in round 2, round 3 clean.

## Findings

| Sev | Finding | Disposition |
|---|---|---|
| MEDIUM | `'Avg cost'` label lied on non-filled rows — `mergeWithRhOrder` writes the order's *limit* price into `result.fillPrice` for SUBMITTED/RESTING tickets | **Fixed** — fill anchor gated on `status === FILLED`; non-filled rows fall through to Stop/Limit with honest labels. Spec added. |
| MEDIUM | Column budget overflow — anchor+pct (~90px) pushed a row to ~486-496px vs the 480px queue column (420px <1200px) | **Fixed** — tightened column widths (−24px) and `.item-date` hides below the 1200px breakpoint (−~64px). |
| MEDIUM | PROTECTED badge / Requeue button inside `.item-line-1` overflowed the row — protected FILLED rows hit ~528px at the 480px breakpoint (regression from new columns) | **Fixed** — badges/actions moved to a conditional `.item-line-2`; line-1 budget verified at both breakpoints (~78px slack @480, ~18px @420). |
| MINOR | Redundant `'stopPrice' in ticket` narrowing — OPTION early-return already narrows the union | **Fixed** — direct field access. |
| LOW | Anchor labels were tooltip-only and unasserted — the mislabel bug would have survived specs | **Fixed** — specs assert `anchorFor().label` per tier; labels stay tooltip-only by design. |
| LOW | `signalPrice <= 0` and signalContext-without-signalPrice fallthrough untested | **Fixed** — fallthrough specs added. |
| LOW | ≥$1000 prices (`$1,234.56` = ~54px) overflowed 44px cells | **Fixed** — prices ≥1000 render `1.0-0` (`$1,235` ≈36px); `overflow:hidden` backstop. |
| LOW | `'Avg cost'` label wrong on sell-side fills (it's the proceeds price) | **Fixed** — sell fills label `'Fill'`. |
| LOW | FILLED row with no fill data untested | **Fixed** — spec added (falls to Stop/Limit/null). |
| NIT | Spec indentation inconsistent with file convention | **Fixed** — reindented to 4-space `it` / 6-space body. |

## Accepted / deferred (documented, not blockers)

- `anchorFor` runs ~3×/row/CD cycle — pure arithmetic under OnPush, consistent with the existing `priceFor`/`sharesFor` pattern; a row view-model computed is the refactor if row count ever makes it matter.
- Conditional spread at staging is redundant with the service's recursive `undefined` strip — kept anyway: the spec asserts literal key absence and the in-memory object stays clean.
- `updateTicket` nested-`undefined` asymmetry (pre-existing): a partial `signalContext` update would strip rather than delete a nested field — no caller does this today; flagging for future "edit signal context" work.
- Detail pane (`order-ticket.component`) doesn't surface `signalPrice` — out of scope; candidate for a future row-detail pass.
- Legacy staged tickets lack `signalPrice` → fall through to Stop/Limit anchors — intended backward-compat behavior.
- `order-queue.component.ts` is at ~380 lines (over the 300 guideline, under the 400 smell threshold) — noted for the next touch.

## Evidence

- Focused: order-queue 51/51, signal-order + signal-review.facade green (102 across the three suites).
- Full suite: **161/161 suites, 2254 tests** green.
- Anchors verified end-to-end: `signal.service.ts` maps run-doc `close` → `StSignalItem.closePrice`; `buildSignalOrderTickets` is the sole `signalContext` producer; requeue preserves `signalContext` via partial update.
