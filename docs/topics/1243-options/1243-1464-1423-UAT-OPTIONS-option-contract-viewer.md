**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** options  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1464  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1423  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-11  

# UAT — Chart page layout: selector left, chips right, full-height chart (#1423)

## Scope

#1423 flipped the option-chart page to the target layout: the unified
control drawer moved to the **left**, the chart fills the center at
**full remaining height**, and a new **right-hand chips column** owns the
plotted-set chips (vertical scroll independent of the chart) plus the
rejected-token notice. On top of the flip it added the chip-interaction
layer: hover dim/bold emphasis, click-to-pin, and the series z-order
fix that carries `contractId` on each series spec.

Task acceptance criteria:

1. Chips column right of chart; scrolls vertically independent of chip
   count; the chart keeps its size while chips scroll.
2. Drawer on the left, collapses via the tune button; DOM order is
   drawer → chart → chips.
3. Mini-controls still render while a session is active (center header
   bar).
4. Narrow-width (<960px) behavior defined: drawer overlays the chart,
   chips column tightens.
5. Chip hover bolds its contract's line + span and dims all others;
   sliding between chips does not flash the full set.
6. Click-to-pin: persistent accent + pin affordance; live hover
   overrides the pin; error chips are inert (no hover, no pin).
7. Rejected-token notice is visible in the right column — including
   when every token rejects (panel mounts for notice-only content).
8. No regression: `loadPlotted` dedupe/merge, picker Send → chart,
   replay run → picker/textarea sync, focused single-contract view.

Review-round fixes this UAT also confirms at runtime (all spec-pinned):

- **Hover identity under z-order reorder** — while a contract is
  highlighted/pinned, hovering any *other* chart line must light the
  chip of the line actually hovered (was the round-1 critical: ordinal
  mapping emitted the wrong id).
- **Rejected notice clears on symbol swap** on *every* switch path
  (textarea symbol field, `?list=` deep link, list chooser, replay-run
  pick) via the `onSymbolSwitched` hook inside `onSymbolChange`.
- **Failed contract loads release hover/pin** — no stranded
  dim-everything state (spec-pinned; manual trigger noted but not
  required).
- **Underlying chip** clears contract hover and cannot be pinned.

**Descoped by user decision (2026-11-11):** the textarea-edit provenance
ACs (manual edit clears `selectedReplayRunId`; stale-run guard). The
textarea is a display/escape-hatch surface, not a working surface —
deferred, recorded here so it isn't re-flagged.

## Prerequisites

- Dev server: `npm start` → http://localhost:4200.
- Signed in (contract lists / replay runs are Firestore-backed).
- A liquid symbol's contract list doc for a many-contract plotted set
  (from #1392 UAT, still valid unless docs rotated):
  - QQQ: `2026-11-06_fri_120138_manual_j9gqhh_QQQ` (csp-45-20, 212 picks)
  - SPY: `2026-11-06_fri_120138_manual_09h45m_SPY` (csp-45-20, 205 picks)
- A valid OCC id present in the partner corpus for paste-loads —
  `QQQ261218P00645000` fetched clean on 2026-11-07 (a corpus miss
  surfaces `INTERNAL`; that's #1457, a backend chore, not a UI fail).
- Browser devtools for the narrow-width scenario (device toolbar or a
  resized window under 960px).

## Getting to the feature

Route: **`/options/chart`**. Entry point: app nav → **Options → Chart**
(or the "chart" link on a backtest analysis-results row, which deep-links
`?results=`). You land on the option contract viewer:

- **Left drawer (collapsible, tune icon)** — the whole control surface:
  symbol, contract list chooser/picker, replay dropdown, catalog search,
  group generator, manual contract textarea + Load.
- **Center** — the contract chart filling the remaining viewport height;
  mini-controls in its header while a session is active.
- **Right column** — plotted-set chips (one per contract, scrollable)
  with the rejected-token notice on top; hidden when neither chips nor
  rejected entries exist.

## Automated evidence (executed this session)

- `npx jest src/app/features/savant-trader/pages/option-chart
  src/app/features/savant-trader/stores src/app/features/savant-trader/
  components/options-contract-chart` — **8 suites / 203 tests green**
  (post round-3 code).
- `npx jest` — **308 suites / 5,460 tests green** (pre round-3 delta;
  round-3 changes are store/service logic covered by the focused run).
- `npx tsc -p tsconfig.app.json --noEmit` — clean.
- `npm run build` (AOT) — clean; only the pre-existing `papaparse`
  CommonJS warning.

## Scenarios

### 1. Boot — new layout orientation

- **Feature:** three-column shell.
- **Steps:** Hard-refresh `/options/chart`.
- **Expected:** Left drawer (open or its collapsed strip) → chart
  filling the viewport height center → right chips column present only
  when a plotted set or rejected entries exist. No console errors
  beyond known noise: intermittent `getOptionsContractIndex` 500 +
  CORS-block follow-on is filed backend bug #1456 (~10% of calls, retry
  succeeds); `INTERNAL`-text errors on contract fetches are #1457.
- **Evidence/result:**

### 2. Load a small plotted set → chips right, chart stable

- **Feature:** chips column mounts beside the chart, not above it.
- **Steps:** Paste these two dated lines → Load:
  ```
  2026-10-01,QQQ261218P00645000
  2026-10-08,QQQ261218P00676000
  ```
- **Expected:** Two chips appear in the right column; the chart does not
  move or shrink vertically when they arrive; one series per contract
  with marker dots at the dates.
- **Evidence/result:**

### 3. Many chips — independent vertical scroll

- **Feature:** the column scrolls inside itself.
- **Steps:** Open the list chooser → pick the SPY doc → in the picker
  select a large contiguous range (Shift-click) or Send the full set →
  Send to chart. Scroll the chips column.
- **Expected:** Chips scroll within the right column; the chart's
  position and height never change; the page itself does not grow a
  second scrollbar for the chips.
- **Evidence/result:**

### 4. Mini-controls during an active session

- **Feature:** controls survive beside the new columns.
- **Steps:** With a plotted set loaded, read the chart header bar.
- **Expected:** The session mini-controls (e.g. picker-reopen, window
  controls) render in the center header and work — not pushed off by
  the right column.
- **Evidence/result:**

### 5. Chip hover — dim/bold, no flash between chips

- **Feature:** hover emphasis.
- **Steps:** With ≥3 contracts plotted, hover chip A → slide the pointer
  down the column through several chips → leave the column.
- **Expected:** Under the pointer: that contract's line **and** its
  entry-span bolden; every other series dims. Sliding chip-to-chip
  updates emphasis with no full-set flash (container-level leave, not a
  timer). Leaving the column restores all series.
- **Evidence/result:**

### 6. Click-to-pin

- **Feature:** pin/unpin + live override.
- **Steps:** Click chip A → move the pointer off the panel → hover chip
  B → click chip A again (unpin).
- **Expected:** Click leaves A emphasized + pin accent after the pointer
  leaves. Hovering B overrides the pinned emphasis live (B lights while
  hovered; A stays pinned underneath). Second click on A releases.
- **Evidence/result:**

### 7. Line-hover correctness while a pin is active (C1 regression)

- **Feature:** `contractId` travels on the series spec, immune to the
  z-order reorder.
- **Steps:** Pin chip A. In the chart, hover the line belonging to a
  *different* contract B (highlighted series are reordered to paint on
  top — this is exactly the broken path pre-fix).
- **Expected:** Chip **B** lights in the right column — the hovered
  contract, not the pinned one; no highlight ping-pong while moving the
  mouse over B's line.
- **Evidence/result:**

### 8. Underlying chip

- **Feature:** non-contract chip is inert to contract hover/pin.
- **Steps:** Hover the underlying chip; click it.
- **Expected:** No contract dims/boldens; no pin appears. (If a contract
  hover was active when entering the underlying chip, it clears.)
- **Evidence/result:**

### 9. Error chip is inert

- **Feature:** failed contracts can't be hovered or pinned.
- **Steps:** Produce an error chip — paste this pair → Load:
  ```
  2026-10-01,QQQ261218P00645000
  2026-10-08,QQQ260619P00470000
  ```
  `QQQ260619P00470000` parses as a valid OCC id but is absent from the
  partner corpus (upstream `404 "Time series object not found"`,
  verified via Cloud Logging on 2026-11-08) → it loads as an **error
  chip**, not a rejected token. The chip's tooltip shows `INTERNAL` —
  the known pre-existing error-flattening filed as #1457, not a #1423
  defect. Hover and click the error chip.
  Fallback if it ever lands in the corpus: any syntactically-valid
  strike that can't exist, e.g. `QQQ261218P09999000`.
- **Expected:** Nothing dims or pins off an error chip; a previously
  active emphasis releases on entering it.
- **Evidence/result:**

### 10. Rejected-token notice — right column, drawer closed

- **Feature:** notice lives where it's visible.
- **Steps:** Close the left drawer. Load A — paste:
  ```
  not-a-contract
  2026-10-01,QQQ261218P00645000
  ```
  Then Load B — clear the textarea and paste two unparseable lines:
  ```
  not-a-contract
  2026-13-99,QQQ261218P00645000
  ```
  (`not-a-contract` fails the OCC parse; `2026-13-99` is an invalid
  date — both reject, so Load B produces zero chips.)
- **Expected:** First load: the rejection notice sits at the **top of
  the right chips column** naming the bad token — visible with the
  drawer closed. Second load: the right panel still mounts for the
  notice alone (no chips needed); the stray underlying chip does not
  appear in a rejections-only panel.
- **Evidence/result:**

### 11. Symbol swap clears a stale notice

- **Feature:** `onSymbolSwitched` hook covers every switch path.
- **Steps:** Leave scenario 10's notice showing (still on QQQ), then:
  **(a)** open the drawer, change the symbol field to `SPY`, confirm —
  notice must clear; **(b)** cross-symbol path — with a fresh notice
  showing and the page on QQQ, navigate to
  `http://localhost:4200/options/chart?list=2026-11-06_fri_120138_manual_09h45m_SPY`
  — the page switches to SPY and the notice must clear before the doc
  applies. **The picker dialog opening is expected** — `?list=` opens
  the picker by design; the check is that the right column behind it
  holds no stale notice once it closes. (Optional third path: pick a
  replay run whose symbol differs from the page's.)
- **Expected:** The notice clears on each path — no notice re-rendering
  the new symbol's name against the old tokens.
- **Evidence/result:**

### 12. Narrow width (<960px)

- **Feature:** responsive overlay behavior.
- **Steps:** Shrink the window under 960px (or devtools device toolbar).
  Open the left drawer.
- **Expected:** The drawer **overlays** the chart rather than squeezing
  it; the chips column tightens to ~150px and keeps scrolling; the chart
  remains usable underneath.
- **Evidence/result:**

### 13. Regression sweep

- **Feature:** untouched flows still work.
- **Steps:** (a) Picker Send a second selection → the set **replaces**,
  doesn't merge-append; (b) pick a replay run → textarea fills and the
  slice loads; (c) Load a single undated contract id → focused
  single-contract view, no dimming; (d) generator Run → Send → chart.
- **Expected:** All four behave as before the layout change. (Known
  pre-existing: #1440 — symbol swap leaves prior contracts plotted —
  is BACKLOG, not a #1423 fail.)
- **Evidence/result:**

## Manual UI/UX refinement pass

This task *is* the UI — the pass is the substance of the UAT:

- [ ] Visual hierarchy: drawer / chart / chips read left-to-right; the
  chart is the dominant surface at desktop width
- [ ] Chips legible at both widths; pin accent distinguishable from the
  underlying chip accent
- [ ] Dimmed series still visible enough to compare shapes (~35%)
- [ ] No clipped controls at 960px boundary; drawer overlay doesn't trap
  the chart's tooltips
- [ ] Keyboard: drawer `inert` while closed (tab through the page —
  closed-drawer controls unreachable); chips focusable and leave-focus
  clears emphasis
- [ ] Both themes: dim/hover/pin states readable in light + dark

## Regression / smoke

- [ ] `/options/chain` boots (shares the stores dir)
- [ ] Backtest analysis-results "chart" link still deep-links into the
  page (`?results=` path — also exercises the notice-clear hook)

## Traceability

| Criterion | Scenario(s) |
|---|---|
| AC1 chips right / independent scroll / chart stable | 2, 3 |
| AC2 drawer left + DOM order | 1, 12 |
| AC3 mini-controls while active | 4 |
| AC4 narrow-width defined | 12 |
| AC5 hover dim/bold, no flash | 5, 7 |
| AC6 click-to-pin / override / error inert | 6, 9 |
| AC7 rejected notice right column | 10 |
| AC8 no regression | 13 + automated evidence |
| Review: hover identity under reorder | 7 |
| Review: notice clears on every symbol path | 11 |
| Review: failed load releases hover/pin | spec-pinned (9 covers the inert surface) |
| Review: underlying chip inert | 8 |

## Results log

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Boot — layout orientation | PASS | User-verified 2026-11-11 — drawer left / full-height chart / right column |
| 2 | Small set → chips right | PASS | User-verified — two dated lines, chips mount right, chart stable |
| 3 | Many chips — scroll | PASS | User-verified — picker set, column scrolls, chart never shifts |
| 4 | Mini-controls | PASS | User-verified — header controls render + work during session |
| 5 | Hover dim/bold | PASS | User-verified — line+span bold, others dim, no inter-chip flash |
| 6 | Click-to-pin | PASS | User-verified — pin persists, hover overrides live, re-click releases |
| 7 | Line-hover under pin | PASS | User-verified — hovered contract's chip lights under an active pin (C1 regression path) |
| 8 | Underlying chip | PASS | User-verified — no dim, no pin, clears active hover |
| 9 | Error chip inert | PASS | User-verified — `QQQ260619P00470000` corpus-miss → error chip, `INTERNAL` tooltip (#1457 pre-existing), inert to hover/click |
| 10 | Rejected notice | PASS | User-verified — notice top of right column, drawer closed; rejects-only paste mounts notice-alone panel |
| 11 | Symbol-swap notice clear | PASS | User-verified — symbol field swap clears; `?list=` cross-symbol path clears + picker opens by design |
| 12 | Narrow width | PASS | User-verified — <960px drawer overlays chart, chips ~150px |
| 13 | Regression sweep | PASS | User-verified — picker Send replaces, replay fills+loads, single-id focus undimmed, generator Send works |

Console noise observed during the run: intermittent
`getOptionsContractIndex` 500 → CORS-blocked follow-on = filed backend
bug #1456; `INTERNAL` tooltip text = filed chore #1457. Both
pre-existing, both recorded on the QA issue.
