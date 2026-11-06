**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** options  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1438  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1420  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# UAT — #1420 FE Task: Timeline selection shading + click-to-toggle

Verifies the #1420 timeline work: ticks shade by `selection` (any op —
stride/random/range/checks — lights the matching days across ALL
chunks, closing the "invisible selection" gap), and a tick click is a
chunk-granular tri-state toggle + cursor jump in one atomic op. Also
under test: the sanctioned deltas — empty-default selection, solid
mint cursor band, and the Remove-chunk button.

Supersedes two earlier expectations:

- **#1363 UAT** described ticks as a cursor/jump surface only — ticks
  now shade by selection and clicking changes selection (chunk-wise).
- **#1353 PRD / prior UATs** described "first 10 rows pre-selected" on
  load — a fresh list now opens with **nothing checked** (restored
  sessions still re-apply saved keys).

Still held: **nothing emits while the dialog is open** — Send is the only
plot path (#1419 contract).

## Prerequisites

- Dev server at `http://localhost:4200` (`npm start`)
- List doc: `2026-11-06_fri_120138_manual_j9gqhh_QQQ` — QQQ, template
  `csp-45-20`, 212 picks / 0 misses, 2026-01-02 → 2026-11-05. (The
  original fixture `2026-11-01_sun_105552_manual_anjw5z_QQQ` was deleted
  during #1439 delete-run testing; contract lists are 1:1 with runs and
  cascade-delete. If this id is also gone, the chooser row's `row-id`
  line shows current ids — the whole row is the select button, so
  highlight-copy the id text without clicking.)
- Open the picker via:

  `http://localhost:4200/options/chart?list=2026-11-06_fri_120138_manual_j9gqhh_QQQ`

- **Fresh-default caveat:** an existing saved session restores itself
  (correct). For S1's fresh path, clear Local Storage
  (DevTools → Application) or use a never-opened list.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Empty default on fresh list | Open the picker on a list with no saved session | Zero rows checked; "0 rows selected"; **Send disabled**; no solid-accent ticks — only the mint band on chunk 1 | |
| S2 | Selection shading across all chunks | Rows → stride 10 → apply → Chunks tab | Every ~10th tick solid accent across ALL chunks — not just the cursor's. Step `▶`: shaded ticks stay put while the mint band moves | |
| S3 | Chunk-toggle + cursor jump | Chunks → click a tick in an unselected chunk; again; then in a partially-selected chunk | Click 1: whole chunk's ticks go accent + band lands there + readout jumps. Click 2: chunk clears. Partial chunk → FILLS (tri-state) | |
| S4 | Rows/readout mirror | After S3 → flip to Rows tab | Same days checked; readout count matches; Lines tab shows the `date,contractId` pairs | |
| S5 | Cursor vs selection distinct | Mixed selection → step cursor across chunks | Solid **mint** band = cursor position; solid **accent** ticks = selected days. Distinguishable in both themes (swap + recheck if you run one) | |
| S6 | Add/Remove chunk + gating | On unselected chunk; then on a full chunk | `Add` fills it; `Remove` **disabled** when nothing in chunk. On full chunk: `Remove` clears only that chunk — other chunks' selections survive; `Add` **disabled** | |
| S7 | No emit while dialog open | Step, tick-click, Add/Remove — observe chart behind dialog | Chart does **not** change; only Send plots (#1419) | |
| S8 | Persistence — symbol swap | **Explicit steps:** ① With QQQ's list open: select a chunk or two + a stray day, move the cursor mid-list → **Close** (not Send). ② Change the chart **symbol** to SPY (the page symbol field — the picker session for QQQ ends). ③ Change the symbol back to **QQQ** → `setSymbol('QQQ')` restores `rs-optlist:QQQ` — it reloads the saved doc + selection + cursor. ④ Reopen the picker if it didn't auto-open | QQQ's checks + cursor return exactly. **By-design caveat:** persistence is one blob per symbol holding that symbol's ACTIVE session — picking a *different list doc for the same symbol* in the chooser starts a fresh empty selection and overwrites the blob (not a bug; per-doc history isn't the model). This scenario tests the *symbol* swap only | |
| R1 | Rows ops regression | all / none / invert / stride / random / date-range / contains | Ops check expected rows; `—` marker rows stay disabled; ↻n repeat badges select all the contract's dates | |
| R2 | Lines preview + Copy | Lines tab | Preview mirrors selection exactly; Copy writes `date,id` lines | |
| R3 | Send → >50 confirm | `All` → Send → confirm on clean page → Load; then re-trigger → Cancel | Picker closes first, confirm over page; Load writes textarea + plots; Cancel changes neither | |

## Refinement pass

- Band readability: solid mint fill visible behind ticks; mint vs
  accent distinguishable at a glance (both themes if handy)
- Toggle discoverability: the hint ("click a tick to select/clear its
  chunk") matches what actually happens — no dead zones suggested
- Empty-default feel: opening a workspace with nothing pre-chosen —
  does it read as "ready to build" rather than "broken/empty"?
- Chunk-toggle granularity: is chunk-per-click the right unit, or do
  you miss day-level clicks on the timeline (Rows owns per-day)?
- Add/Remove disabled states: do they telegraph why they're off?

## Findings raised (out of #1420 scope)

- **#1440 — BUG: symbol swap leaves prior symbol's contracts/chips
  plotted.** `onSymbolChange` never calls `clearPlotted()` — old
  contracts render over the new underlying. Routed as its own task
  (chart blueprint #1261); the pairs-textarea clear is an in-scope
  decision there.

## Traceability

| AC | Scenarios |
|---|---|
| AC1 — selected days visually distinct, both themes | S2, S5 |
| AC2 — click toggles containing chunk in `selection` | S3, S6 |
| AC3 — Rows checks + readout update to match | S4 |
| AC4 — cursor/jump semantics preserved or documented | S3 (jump in same click), IMPL doc |
| AC5 — click no longer emits; Send is the boundary | S7, R3 |
| AC6 — specs cover shading + toggle paths | Automated evidence |
| Delta — empty default on fresh list | S1, S8 |
| Delta — Remove-chunk button + gating | S6 |
| Delta — mint band distinct from selected | S5 |

## Automated evidence

- Review PASS doc (2 rounds): `1243-1359-1420-CODE-REVIEW-OPTIONS-option-contract-viewer.md`
- Focused sweep: 9 suites / 129 tests green; full suite 301/5,261 green; AOT clean
- Key specs: `toggleChunkAt` tri-state + atomic cursor jump + no-emit; tick `.selected` shading incl. `.selected:not(.in-chunk)`; Rows-mirror DOM spec; empty default + disabled Send; `removeChunkFromSelection` + canAdd/canRemove gating

## Results log

| # | Result | Notes |
|---|---|---|
| S1 | PASS — user-verified live, 2026-11-06 | |
| S2 | PASS — user-verified live, 2026-11-06 | |
| S3 | PASS — user-verified live, 2026-11-06 | |
| S4 | PASS — user-verified live, 2026-11-06 | |
| S5 | PASS — user-verified live, 2026-11-06 | |
| S6 | PASS — user-verified live, 2026-11-06 | |
| S7 | PASS — user-verified live, 2026-11-06 | |
| S8 | PASS — user-verified live, 2026-11-06 | |
| R1 | PASS — user-verified live, 2026-11-06 | |
| R2 | PASS — user-verified live, 2026-11-06 | |
| R3 | PASS — user-verified live, 2026-11-06 | |
