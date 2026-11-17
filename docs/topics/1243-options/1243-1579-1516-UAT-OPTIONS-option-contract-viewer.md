**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Issue:** #1579  
**Thread Parent:** #1335  
**Topic Parent:** #1243  
**Task:** #1516  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# UAT — Clear-all control for the plotted contract set (#1516)

QA issue: #1579 — "QA: FE Task: Clear-all control for the plotted contract set"
Code review: `docs/topics/1243-options/1243-1335-1516-CODE-REVIEW-OPTIONS-option-contract-viewer.md` (PASS)

## Getting to the feature

- **Route:** `/options/chart`
- **Entry point:** Sidenav → **Option Chart** (`stacked_line_chart` icon).
- **Surface:** price chart centered; the **plotted-contracts chips panel** docks on the right edge once at least one contract is plotted (or a send produced rejections). The input is the **OCC Contract ID(s)** textarea top-left with its **Load** button — accepts bare OCC ids or `YYYY-MM-DD,ID` lines, one per line.
- **The control under test:** the chips-panel head row reads `{N} plotted` with a **Clear all** button (`title="Remove every plotted contract"`). It renders only while at least one contract is plotted — an empty panel (or a rejected-only send) shows no Clear all.

## Verified example data — copy-paste blocks

All ids below are corpus-verified from prior UAT passes on this page. Paste each block verbatim into the OCC Contract ID(s) textarea.

**SET-A — 3-contract set (primary test set):**

```text
QQQ261016C00710000
QQQ261016P00710000
QQQ261218P00645000
```

**SET-B — 8-contract set (in-flight batch test):**

```text
QQQ261016C00710000
QQQ261016P00710000
QQQ261218P00645000
QQQ260331C00440000
QQQ260331C00450000
QQQ260331P00455000
QQQ260619P00470000
QQQ261218P00676000
```

**REJECT-BLOCK — one good id + one garbage token:**

```text
QQQ261016C00710000
GARBAGE-ID
```

Expected notice: `1 entry skipped:` listing `GARBAGE-ID` with reason `not a valid contract ID`.

**WRONG-UNDERLYING — QQQ id + foreign SPY id (page on QQQ):**

```text
QQQ261016C00710000
SPY260220P00660000
```

Expected notice: `1 entry skipped:` listing `SPY260220P00660000` with reason `not a QQQ contract`.

**RESEND — dated line + bare ids (exercises the `date,id` path):**

```text
2026-06-10,QQQ260619P00470000
QQQ261016C00710000
QQQ261218P00645000
```

## Automated evidence — already green

| Check | Result |
|---|---|
| `plotted-contracts-feature.spec.ts` + `option-chart-dom.spec.ts` + `option-chart.component.spec.ts` + `option-chart-services.spec.ts` | **4/4 suites, 156/156 specs** (2026-11-16, `jest --runInBand`) |

Spec-pinned behaviors the manual run does not need to re-prove at unit level (only at UI level):

- `Clear all empties the whole set in one click — chips, bookmark, panel` (DOM spec)
- `Clear all renders while drilled and clears the focused contract too` — incl. a focused-only chip with no plotted set (#1579 UAT finding)
- `Clear all clears the textarea and the skip notice along with the set` (#1579 UAT finding)
- `clearPlotted empties the set and clears hover`
- `clearPlotted keeps the display-window preference — a view setting, not set membership`
- `clearPlotted resets focus along with the set`
- `clearPlotted clears the focused contract's data — an empty set must not repaint it`
- `clearPlotted orphans an in-flight focused load — its late response is dropped`
- In-flight foreign load still lands for a surviving sibling after single-chip remove (`QQQ_PUT` removed, `QQQ_CALL` remains, `SPY250718C00550000` in flight)

**Post-finding remediation (2026-11-16, first tester pass):** the head row rendered only while `plottedList() > 0`, so a drilled view with an empty set showed a chip with no clear affordance — the head row now renders whenever `chipContracts() > 0`. The Clear all click also now resets the visible textarea (`page.occIdInput` — the store's `occIdInput` is a shadow field the textarea never binds) and the `N entries skipped` notice (`rejectedEntries` lives on the load service, unreachable from the store).

## Scenarios

Record each as **PASS / FAIL / BLOCKED** with a one-line observation in the Results log.

---

### S1 — Clear all empties every plotted chip in one click (set view)

- **Confirms:** one click removes the whole plotted set — no per-chip × clicking.
- **Starting state:** `/options/chart`, no contracts plotted.
- **Steps:**
  1. Paste **SET-A** into the OCC Contract ID(s) textarea. Click **Load**.
  2. Wait for all 3 chips to render in the right-hand chips panel (`3 plotted` in the head row).
  3. Click **Clear all** once.
- **Expected:** all 3 chips disappear immediately; the chips panel collapses away (nothing plotted, no rejections); the chart clears its plotted series.
- **Cleanup:** none — panel is already empty.
- **Result:** ___  **Evidence:** ___

---

### S2 — Clear all while drilled into a contract clears set + focus

- **Confirms:** Clear all removes the plotted set **and** the focused single-contract view — no ghost line. The `{N} plotted / Clear all` head row stays rendered in every drilled state — including a focused chip with no plotted set behind it.
- **Starting state:** SET-A plotted (repeat S1 steps 1–2).
- **Steps:**
  1. Paste the single bare id `QQQ261016C00710000` into the textarea. Click **Load** — this opens the focused single-contract view (the chips panel narrows to the focused chip; the head row should still read `2 plotted`-style count of the underlying set, or the set count you loaded).
  2. Confirm the chart shows the single contract and the **Clear all** button is present in the chips-panel head row.
  3. Click **Clear all**.
- **Expected:** chips panel empties and collapses; the focused contract's series is cleared from the chart — no leftover line; the textarea is emptied; page returns to the empty view.
- **Variant (focused-only):** with nothing plotted, load `QQQ261016C00710000` alone → a single focused chip appears **with** a `0 plotted / Clear all` head row → Clear all clears the focused chip and the panel unmounts.
- **Cleanup:** none.
- **Result:** ___  **Evidence:** ___

---

### S3 — Clear all while a batch load is in flight

- **Confirms:** clearing mid-load is safe — late-arriving responses do not resurrect chips and no progress indicator sticks.
- **Starting state:** `/options/chart`, nothing plotted.
- **Steps:**
  1. Paste **SET-B** (8 contracts) into the textarea. Click **Load**.
  2. While chips are still appearing / loading (spinners on chips), click **Clear all**.
  3. Wait ~10 seconds for any in-flight responses to land.
- **Expected:** no chips reappear after the responses land; the panel settles empty; no spinner or progress text stuck in the head row; no console error needed to verify — visual only.
- **Cleanup:** if any chip did resurrect (a FAIL), click its × to remove, and note the id in Evidence.
- **Result:** ___  **Evidence:** ___

---

### S4 — A pinned chip's bookmark dies with the set

- **Confirms:** pin state is set membership — it clears with the set; the next load starts hover/pin-clean.
- **Starting state:** SET-A plotted.
- **Steps:**
  1. Click the `QQQ261016C00710000` chip once — it pins (push-pin icon shows; the chart locks its hover line to that contract).
  2. Click **Clear all**.
  3. Re-load just `QQQ261016C00710000` (bare, single line) → Load.
- **Expected:** after Clear all, the pinned chip and its pin state are gone. On the fresh load, the contract renders **unpinned** — no push-pin icon, no pre-locked hover line; hover behaves as a clean first load.
- **Cleanup:** click **Clear all** to empty, or leave the single contract plotted for the next scenario.
- **Result:** ___  **Evidence:** ___

---

### S5 — Display-window toggle survives Clear all

- **Confirms:** the **Clip to entry / Full History** display-window toggle is a view preference, not set membership — it persists across a clear.
- **Starting state:** SET-A plotted.
- **Steps:**
  1. Set the display-window toggle to **Full History** (if already there, flip to **Clip to entry** first, then back).
  2. Click **Clear all**.
  3. Observe the toggle.
- **Expected:** the toggle still reads the same setting after the clear — it does not snap back to a default.
- **Cleanup:** reset the toggle to your preferred default.
- **Result:** ___  **Evidence:** ___

---

### S6 — Rejected-token notice and textarea clear with the set

- **Confirms:** Clear all clears the whole set surface — chips **and** the `N entries skipped` notice **and** the textarea contents. (Changed 2026-11-16 per UAT finding: the notice previously lingered after the set was gone; the textarea previously kept the last send because `clearPlotted` wrote a store shadow field the textarea never binds.)
- **Starting state:** `/options/chart`, nothing plotted.
- **Steps:**
  1. Paste **REJECT-BLOCK** (`QQQ261016C00710000` + `GARBAGE-ID`). Click **Load**.
  2. Confirm the chips panel shows: `1 entry skipped:` with `GARBAGE-ID — not a valid contract ID`, plus 1 plotted chip and a `1 plotted / Clear all` head row.
  3. Click **Clear all**.
- **Expected:** the chip, the head row, **and the rejection notice** are all gone — the whole chips panel unmounts; the OCC textarea is empty.
- **Cleanup:** none.
- **Result:** ___  **Evidence:** ___

---

### S7 — Re-send after Clear all reloads cleanly

- **Confirms:** the set reloads correctly after being cleared — no stale-state poisoning.
- **Starting state:** SET-A plotted, then cleared (or simply empty panel).
- **Steps:**
  1. Paste **RESEND** (includes the dated line `2026-06-10,QQQ260619P00470000`). Click **Load**.
  2. Wait for all 3 chips.
- **Expected:** `3 plotted` head row; all 3 chips render with normal labels (the dated entry's chip reflects its 2026-06-10 open date); chart shows the set.
- **Cleanup:** click **Clear all**.
- **Result:** ___  **Evidence:** ___

---

### S8 — Refinement: head row legibility + no orphaned panel state

- **Confirms:** the `{N} plotted / Clear all` head row is discoverable and readable at the top of the chips column; clearing produces no flicker or orphaned panel chrome.
- **Starting state:** SET-B plotted (8 contracts) — a set large enough that the chips column scrolls.
- **Steps:**
  1. Confirm the head row sits at the **top** of the chips panel and reads `8 plotted` next to **Clear all** — legible, not clipped, not buried under the chips.
  2. Scroll the chips column — the head row should remain findable (note whether it scrolls away or stays pinned; either is acceptable, record what you see).
  3. Click **Clear all** while scrolled — watch for flicker, layout jump, or a lingering empty panel frame.
- **Expected:** control is clear at the top of the column; after clearing, the panel closes cleanly — no empty bordered shell, no flash of stale chips.
- **Cleanup:** none.
- **Result:** ___  **Evidence:** ___

---

## Negative / boundary checks

### N1 — Empty state has no Clear all

- **Steps:** with nothing plotted and no rejections, confirm the chips panel is absent entirely — no head row, no Clear all button.
- **Expected:** panel hidden.
- **Result:** ___  **Evidence:** ___

### N2 — Rejected-only send shows notice without Clear all

- **Steps:** paste a block that is entirely invalid:

```text
GARBAGE-ID
ALSO-NOT-REAL
```

  Click **Load**.
- **Expected:** `2 entries skipped:` notice renders in the panel; **no** `N plotted / Clear all` head row appears (nothing plotted); nothing is plotted on the chart.
- **Cleanup:** next valid send replaces the notice, or leave it — it clears on the next send.
- **Result:** ___  **Evidence:** ___

## Regression smoke — adjacent option-chart behavior

Quick sanity that the clear-all work did not regress neighboring controls:

| # | Check | Steps | Expected | Result |
|---|---|---|---|---|
| R1 | Single bare-id load | Paste `QQQ261016C00710000` → Load | Focused single view renders | ___ |
| R2 | Single-chip × remove | Plot SET-A → click × on the `QQQ261016P00710000` chip | That chip alone is removed; `2 plotted` head row | ___ |
| R3 | Pin toggle | Click a plotted chip twice | Pin icon toggles on then off | ___ |
| R4 | Wrong-underlying reject label | On the QQQ page, paste **WRONG-UNDERLYING** → Load | `1 entry skipped:` — `SPY260220P00660000 — not a QQQ contract` | ___ |
| R5 | Chip hover highlight | Hover a plotted chip | Its series highlights on the chart; mouseleave restores | ___ |

## Traceability

| QA issue #1579 acceptance criterion | Scenario(s) |
|---|---|
| Clear all removes every plotted chip in one click from set view | S1 |
| Clear all while drilled clears the set + focused contract; no ghost line; empty view | S2 |
| Clear all while a batch load is in flight is safe — no resurrected chips, no stuck progress | S3 |
| Pinned chip's bookmark disappears with the set; hover/pin state clean on next load | S4 |
| Display-window toggle (Clip to entry / Full History) survives Clear all | S5 |
| Send with rejected tokens + Clear all clears the notice along with the set | S6, N2 |
| Re-sending a set after Clear all reloads cleanly | S7 |
| Refinement: "N plotted / Clear all" head row clear at top of chips column | S8 |
| Refinement: no flicker or orphaned panel state after clearing | S8, S1–S3 observation |
| Empty-state safety | N1 |
| No regression to pin/remove/hover/single-load | R1–R5 |

## Results log

| Date | Tester | Result | Notes |
|---|---|---|---|
| 2026-11-16 | automated (jest) | PASS | 4/4 suites, 156/156 specs — see Automated evidence |
| 2026-11-16 | manual pass 1 | 2 FINDINGS | S1–S8 minus S2 pass; **S2 FAIL** (Clear all absent while drilled — head row gated on `plottedList() > 0`); **S6 finding** (notice lingered + textarea not cleared — `page.occIdInput` shadow-field desync + `rejectedEntries` on load service). Both remediated same-day; S2/S6 re-verify pending |
| 2026-11-16 | manual pass 2 | **PASS** | All confirmed by tester: S2 drilled + set clear, S2 focused-only variant (`0 plotted / Clear all`), S6 notice + textarea clear. Cosmetic nit same pass: redundant `Loading contract data…` chart spinner removed (focused chip already carries its own spinner) |
