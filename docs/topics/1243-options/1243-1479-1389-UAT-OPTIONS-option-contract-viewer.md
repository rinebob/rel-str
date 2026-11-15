**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1479  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1389  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12  

# UAT — #1389: Study-range bound filters plotted chart set

## Scope

The study-range brush now filters the **plotted** contract set on the
option chart — display-only: hidden series stay in the set and restore
on clear. Semantics settled in code review:

- A contract with pick dates shows when **any pick** opened within
  `[start,end]` — each pick is a separate position sharing a contract;
  only in-bound positions render (their markers + open date). In
  position mode the clip starts at the in-bound pick, not the earliest.
- Bare-ID contracts (no picks) filter by first rendered observation
  date; a contract with no date evidence yet stays visible.
- Hidden contracts keep a dimmed chip (`.bound-hidden`) — still in the
  set; hover/pin on a hidden chip never dims the visible lines.
- Generator **Send** under an active bound auto-fills `openDate =
  bound.start` unless an explicit open date is set — a brushed bare
  send would otherwise hide its whole cohort.
- The axis keeps the full plotted-set domain under a bound (deliberate;
  underlying-bar add/remove work lands next).
- No bound = no filtering. Focused drill-down is exempt.

## Prerequisites

- Repo checked out, deps installed. Dev server: `npm start`
  (project config `devServerCommand`), default port 4200.
- All scenarios use **QQQ** with these corpus-verified contracts:

  | Id | Contract | Series window (verified in prior UATs) |
  |---|---|---|
  | `QQQ261016C00710000` | $710 call, exp 2026-10-16 | 2026-03-24 → 2026-10-16 (144 obs) |
  | `QQQ261016P00710000` | $710 put, exp 2026-10-16 | ~2026-03-24 → 2026-10-16 (140 obs) |
  | `QQQ260331C00440000` | $440 call, exp 2026-03-31 | starts 2025 → 2026-03-31 |

- Brush controls: the **Select study range** toolbar toggle (icon right
  of the chart controls; hover title "Drag across the chart to bound
  the generator alive range") arms the brush — drag across the chart to
  set the bound, Esc cancels. The **Clear study range** × button
  appears beside it while a bound exists.

## Getting to the feature

**Route:** `/options/chart` — nav: Options → Chart. The page shows a
left-side unified drawer (contract-list textarea, catalog search, group
generator panels, entry metadata), a chips column on the right of the
chart, and a full-height contract chart. The study-range brush is armed
from the chart toolbar; dragging a range renders a translucent bound
band on the chart.

## Automated acceptance (re-run for this gate)

| Check | Command | Result |
|---|---|---|
| Page projection + bound semantics (53 specs incl. position-granular, hidden-chip, axis pin) | `npx jest src/app/features/savant-trader/pages/option-chart/option-chart.component.spec.ts --coverage=false` | **PASS** — 53/53 (2026-11-12) |
| Bound predicate (util specs) | `npx jest src/app/features/savant-trader/utils/option-group-generator.utils.spec.ts --coverage=false` | **PASS** (2026-11-12) |
| Emit bound-start auto-fill + precedence | `npx jest src/app/features/savant-trader/stores/option-group-generator.store.spec.ts --coverage=false` | **PASS** — 22/22 (2026-11-12) |
| DOM (chip strip + bound-hidden class) | `npx jest src/app/features/savant-trader/pages/option-chart/option-chart-dom.spec.ts --coverage=false` | **PASS** (2026-11-12) |
| Typecheck | `npx tsc -p tsconfig.app.json` | **PASS** — clean (2026-11-12) |
| Combined gate run | 4 suites above | **PASS** — 112/112 (2026-11-12) |

## Manual scenarios

### S1 — Bound hides out-of-bound dated contracts; clear restores

1. `/options/chart`, symbol QQQ. In the left drawer's contract-list
   textarea paste this, click **Load**:

   ```
   2026-05-01,QQQ261016C00710000
   2026-06-10,QQQ261016P00710000
   ```

   Both series render; two chips show (call opened 05-01, put opened
   06-10).
2. Click **Select study range** in the chart toolbar, drag across the
   chart from **2026-06-01 to 2026-06-30** (the band covers only the
   put's open date).
   - **Known limitation:** while the brush is armed, crosshairs and
     tooltips are suppressed — you can't read the cursor's date during
     the drag. Aim between the axis gridlines, release, then nudge by
     looking at where the band landed. (Filed as #1514 — "BUG:
     Study-range brush hides crosshairs + tooltips".)
   - **Expect:** the call's series disappears; its chip stays but
     renders dimmed. The put's series stays fully drawn.
3. Click **Clear study range** (× beside the brush toggle).
   - **Expect:** the call's series reappears identical — same color, no
     reload flash, no refetch.
- **Result:** PASS (2026-11-12, user-run) — hide + restore verified;
  usability defect filed as #1514

### S2 — Bare-ID contracts filter by first rendered observation

1. Clear the textarea, paste two **bare** ids (no date prefix), Load:

   ```
   QQQ260331C00440000
   QQQ261016C00710000
   ```

   - **Setup note:** the March contract's line starts back in 2025; the
     Oct contract's first mark is **2026-03-24** (check the axis if
     unsure which is which — March expires 03-31).
2. Arm the brush and drag **2026-03-01 → 2026-04-30**.
   - **Expect:** `QQQ261016C00710000` stays (first obs 03-24 is
     in-bound); `QQQ260331C00440000` hides (first obs is months before
     the bound) with a dimmed chip.
- **Result:** PASS (2026-11-12, user-run)

### S3 — Hidden-chip hover/pin cannot dim the visible set

1. Return to the S1 state (both dated contracts loaded, bound
   `2026-06-01 → 2026-06-30` active, call hidden). Hover the call's
   dimmed chip.
   - **Expect:** the put's line does NOT dim — the stranded highlight
     id is gated off.
2. **Clear** the bound, click the call's chip to **pin** it (pin icon
   shows), then re-drag `2026-06-01 → 2026-06-30`.
   - **Expect:** the pin suppresses while the call is hidden — the
     put's line stays at full opacity (no all-dim).
3. Clear the bound again.
   - **Expect:** the pin re-engages on the returning line.
   - **Pin semantics note:** pin's *intended* role is a chip-strip
     bookmark (mark your position while scrolling) — it should never
     highlight the series or dim others at all. Current builds DO dim
     on pin — pre-existing defect filed as #1515 — "BUG: Pinned chip
     dims other series". This scenario only verifies #1389's slice:
     a pin on a *bound-hidden* contract can't dim what's visible.
- **Result:** PASS (2026-11-12, user-run) — hidden-chip pin/hover can't
  all-dim; pin-dims-intent defect filed as #1515

### S4 — Multi-pick contract: only the in-bound position shows

1. Clear the textarea, paste the SAME contract on two dates, Load:

   ```
   2026-05-01,QQQ261016C00710000
   2026-06-10,QQQ261016C00710000
   ```

   One chip, two pick-day dots on the line (05-01 and 06-10).
2. Drag bound **2026-06-01 → 2026-06-30**.
   - **Expect:** the contract stays visible; only the **06-10** marker
     dot renders; the chip's open-date label reads **2026-06-10** (not
     05-01).
3. Toggle **Clip to entry** (position mode).
   - **Expect:** the line clips at 2026-06-10 — the 05-01 position's
     span does not draw.
- **Result:** PASS (2026-11-12, user-run)

### S5 — Generator send under an active bound auto-fills the open date

1. Clear the plotted set (remove chips). Drag bound
   **2026-06-01 → 2026-06-30**. Open the drawer's **group generator**
   panel.
2. Run a query guaranteed to hit the verified contract — Type = Call,
   expiration start **2026-10-16** AND expiration end **2026-10-16**
   (both fields required), strike range **700–720** → results include
   `QQQ261016C00710000`.
3. Leave the generator's **Open date** field empty, click **Send**.
   - **Expect:** the textarea fills with `2026-06-01,QQQ261016C00710000`
     style lines — bound.start as the open date — and the sent cohort
     plots immediately (not hidden by the bound it was brushed under).
4. Now set Open date explicitly to **2026-05-01** and Send again.
   - **Expect:** lines carry `2026-05-01` (explicit wins); those
     contracts plot but hide under the June bound — chips dim.
- **Result:** PASS (2026-11-12, user-run, corrected doc)

### S6 — Focused view exempt; axis keeps full domain

**Terminology:** the *set view* = the chart showing every plotted
contract's series (what you've been looking at). The *focused view* =
the single-contract render entered by loading one contract id — a
chip click only pins, there is no chip→focused gesture (see Findings).

1. With the S1 bound active (call hidden), clear the textarea and load
   the hidden contract as a single id — paste `QQQ261016C00710000`,
   **Load**.
   - **Expect:** the focused single-contract view shows the call —
     the bound does not apply to it.
2. Return to the set view (re-**Load** the S1 two-line block — the
   set load releases focus). Note where the axis starts/ends, then
   click **Clear study range** (×) — the band disappears — and re-drag
   `2026-06-01 → 2026-06-30`.
   - **Expect:** the axis domain does NOT change when the bound hides
     contracts — the hidden call's dates/expiration stay on the axis
     (deliberate; bar-trimming is follow-up work).
- **Result:** PASS (2026-11-12, user-run, corrected doc)

### S7 — Negative/boundary checks

1. S1 set loaded (`05-01` call + `06-10` put). Drag a bound entirely
   before both opens — **2026-01-05 → 2026-02-27**.
   - **Expect:** both series hide, both chips dim, the pane stays in
     set view (no flicker to single-contract view). Clearing restores
     both.
2. Drag a bound ending exactly **on** the put's open — **2026-05-15 →
   2026-06-10**.
   - **Expect:** the put stays visible (inclusive end boundary); the
     call hides.
3. Drag a bound starting exactly **on** the put's open — **2026-06-10 →
   2026-07-15**.
   - **Expect:** the put stays visible (inclusive start).
- **Result:** PASS (2026-11-12, user-run)

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Bound hides out-of-range open dates; clearing restores | S1, S7 |
| Bare-id → first-observation proxy | S2 |
| Series survive unchanged; no unload/refetch | S1 (color/data identity) |
| Marker dots + clip-to-entry apply to visible series | S4 |
| Filter composes with clip-to-entry | S4.3 |
| Hidden chips stay but dim; hover/pin can't all-dim | S3 |
| Any-pick-within position semantics | S4 |
| Generator send bound-start auto-fill + explicit precedence | S5 |
| Focused-view exemption | S6.1 |
| Full-domain axis (deliberate) | S6.2 |
| Boundary inclusivity; all-hidden resilience | S7 |

## Regression smoke

- [x] Textarea `date,id` + bare-id paste/load unchanged without a bound — PASS (user-run)
- [x] Clip-to-entry toggle behavior unchanged with no bound — PASS (user-run)
- [x] Picker send (Selection Replay Wednesday rows) still plots markers — PASS (user-run)
- [x] Underlying chip + underlying bars unaffected by a bound — PASS (user-run)
- [x] Symbol swap still clears the session (#1440 behavior intact) — PASS (user-run)

## Findings

- **#1514 — "BUG: Study-range brush hides crosshairs + tooltips — no
  date feedback while picking the range"** (`4_BACKLOG`, FEATURE,
  NOT STARTED) — surfaced by S1. Brush-armed suppresses the cursor's
  date readout exactly when it's needed.
- **#1515 — "BUG: Pinned chip dims other series — pin should be a chip
  bookmark, not a chart highlight"** (`4_BACKLOG`) — surfaced by S3.
  Pre-existing: `highlightedContractId` falls back to `pinnedContractId`
  in `plotted-contracts-feature.ts`; per user, pin is a chip bookmark
  only. Fix reworks #1389's `chartHighlight` pin branch + one spec.
- **#1516 — "FE Task: Clear-all control for the plotted contract set"**
  (`4_BACKLOG`) — user side note; removing chips one-by-one per scenario
  is the pain point. Natural sibling to #1321's plotted-set controls.
- **#1517 — "FE Task: Reset control for the group generator"**
  (`4_BACKLOG`) — user side note; store `clear()` may already cover the
  function — implementer to verify discoverability vs. missing reset of
  drawer-local fields.

## Results log

- 2026-11-12 — UAT doc created. Automated legs: 112/112 green across
  the 4 gate suites (component 53, store 22, utils, DOM) + tsc clean.
- 2026-11-12 — User UAT run: **S1 PASS** (defect #1514 filed), **S2
  PASS**, **S3 PASS** (pin-intent defect #1515 filed), **S4 PASS**,
  **S7 PASS**, **regression smoke PASS**. S5 + S6 legs hit doc errors
  (missing expiration-end field; nonexistent chip→focused gesture;
  vague "set view"/"toggle" language) — doc corrected, awaiting
  re-verification. Feature asks filed: #1516 (clear-all), #1517
  (generator reset).
- 2026-11-12 — **QA CLOSEOUT — PASS.** S5 + S6 re-verified on the
  corrected doc (user-run). All scenarios + regression smoke green.
  Findings routed to backlog: #1514, #1515, #1516, #1517 — none are
  #1389 regressions.
