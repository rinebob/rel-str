**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1415  
**QA:** #1452  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-08  
**Last Updated:** 2026-11-08  

# UAT — Update Stop dialog decision context (#1415)

Scope: the decision-context card inside the stop-loss dialog — story chain,
live proposed metrics, position/order context, both-peaks, the ratchet
suggestion row, and the auto-ratcheting prefill. The workflow
(submit → submitting → success → Done) and silent reconcile are unchanged
from #888/#1397 — regression-check them, don't re-litigate.

Spec basis: IMPL `219-1403-1405` Phase 4; TEST doc §"Unit Test Targets —
Dialog" + §"Edge Cases". Code review: `219-1407-1415-CODE-REVIEW-*` (PASS,
2 rounds). Reorganized after first live look: subject-grouped metrics
labels, `Cur. Stop` chain label, suggested-ratchet row + Use button,
below-ratchet close warning, auto-ratchet prefill (option B — never
loosen), `ds-btn fill` submit, `Cur. Price`/`Cur. Stop`/`Proposed Stop`
chain labels.

## Scenarios

### S1 — Story chain + auto-ratchet prefill (protected position)

- **Steps:** Equities tab → a row with a live stop → **Update Stop**. Check
  the chain: `Entry $…(+date) → Peak $…(+date) → Cur. Price $… →
  Cur. Stop $… → Proposed Stop $…`.
- **Expected:** Entry = row Avg Cost; Peak/Cur. Price/Cur. Stop match the
  table's Peak/Price/Stop cells + Open Orders. **Proposed Stop opens at
  max(Cur. Stop, 8%-below-peak)** — e.g. stop $464.60 on peak $559.15 →
  $514.42 (accented, in the form field too). Typing/stepping changes it
  live.
- **Result:**

### S2 — Metrics line sanity check

- **Steps:** Read the two metrics lines:
  `Cur. Price   — n.n% retraced from peak` and
  `Proposed Stop $x — $d (n%) below now · $d (n%) below peak · locks in ±$d (±n%) vs basis`.
- **Expected:** `retraced` = (peak−now)/peak; `below now` = |proposed−now|;
  `below peak` = |proposed−peak|; `locks in` = (proposed−avgCost)×order qty —
  hand-check one. With the ratcheted prefill, `locks in` shows a **gain**
  when the suggestion sits above basis.
- **Result:**

### S3 — Suggested row, Use button, below-ratchet warning

- **Steps:** On a normal protected row, the `Suggested $… (8% below peak)`
  line shows with a Use button — click it and confirm the form fields jump
  to the suggestion with a consistent %. On any position whose current
  price is below the 8%-below-peak level (if one exists), the row instead
  reads the close-the-position warning.
- **Expected:** Use seeds price + linked percent. Below-ratchet → warning
  text, prefill stays at the current stop (never a stop above market).
  No derivable peak → no Suggested row at all.
- **Result:**

### S4 — Position + order context, underivable/pending peak

- **Steps:** Read the meta lines (`N sh @ $avg · basis $… · value $… ·
  PnL ±$… (±n%)` and `Stop order: qty n · TIF · since date`). Open Update
  Stop on a GPRO-class underivable symbol, and (if timing allows) mid-derive
  after a reload.
- **Expected:** Values match the row + Open Orders; order line shows the
  order's own TIF. Underivable → Peak node + peak metrics `—`; pending → `…`;
  never a fabricated number.
- **Result:**

### S5 — Submit button styling + workflow regression

- **Steps:** Confirm the Update Stop submit button is a solid accent-fill
  button at rest (whole button visible, not just text) and highlights on
  hover. Submit a real update on a sacrificial stop (or cancel out):
  cancel → confirm → place → success → Done. Also cancel without submitting.
- **Expected:** Success flow identical to #888; Done → silent orders
  reconcile only (no full reload, positions untouched). Cancel-without-submit
  → no reconcile call.
- **Result:**

### S6 — Both peaks (conditional)

- **Steps:** On a symbol with fills after entry where lifetime ≠
  since-last-fill peak, check the `Since last fill: $… (date)` line.
- **Expected:** Present only when the two differ. N/A if no such position —
  spec coverage stands.
- **Result:**

## Results

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| S1 | Story chain + auto-ratchet prefill | PASS | User-verified 2026-11-08 |
| S2 | Metrics line sanity | PASS | User-verified 2026-11-08 |
| S3 | Suggested / Use / below-ratchet | PASS | User-verified 2026-11-08 |
| S4 | Context + underivable/pending | PASS | User-verified 2026-11-08 |
| S5 | Button styling + workflow | PASS | User-verified 2026-11-08 |
| S6 | Both peaks | PASS | User-verified 2026-11-08 |

## Verdict

**PASS — user-verified 2026-11-08** ("all uat passes"), after three live
polish iterations: `Cur. Price`/`Cur. Stop`/`Proposed Stop` chain labels,
`ds-btn fill` submit, `.pill-group` container chrome stripped (bare
buttons per the DS flat-variant intent).
